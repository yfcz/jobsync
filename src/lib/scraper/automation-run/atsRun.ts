import type {
  Automation,
  FunnelStage,
} from "@/models/automation.model";
import { JOBSCZ_SEARCH_MODE_LABELS, isCzechJobBoard } from "@/models/automation.model";
import type { AtsProvider } from "../ats/types";
import { runAtsPipeline } from "../ats/pipeline";
import type { ScoredJob } from "../ats/pipeline";
import { buildIdf, passesFloor, scoreJob } from "../ats/rank";
import { APP_CONSTANTS } from "@/lib/constants";
import { dedupeJobs, jobDedupeKey } from "../utils";
import { getExistingJobDedupeMap } from "@/lib/jobs/jobDedupe";
import { automationLogger } from "@/lib/automation-logger";
import { log } from "@/lib/telemetry";
import type { BoardFailure, RunnerResult, ResumeWithSections } from "./types";
import {
  getAutomationMatchLimit,
  getDefaultModelForProvider,
  getUserAiSettings,
} from "./aiSettings";
import { parseAutomationConfig } from "./config";
import { extractResumeSkills } from "./resumeText";
import { buildSkillTerms } from "./skillTags";
import { persistDiscoveredJob, scalePrerank } from "./persist";
import { matchJobToResume } from "./match";
import { finalizeRun } from "./finalize";

export async function runAtsRun(
  automation: Automation,
  provider: AtsProvider,
  runId: string,
  resume: ResumeWithSections,
  signal?: AbortSignal,
): Promise<RunnerResult> {
  const label = `[${provider.label}]`;
  const config = parseAutomationConfig(automation.sourceConfig, automation.jobBoard);

  const missingConfig =
    !config ||
    (config.kind === "ats" && config.companies.length === 0) ||
    (config.kind !== "ats" && config.queries.length === 0);
  if (missingConfig) {
    const errorCode = isCzechJobBoard(automation.jobBoard) ? "no_queries" : "no_companies";
    automationLogger.log(
      automation.id,
      "error",
      `${label} No ${isCzechJobBoard(automation.jobBoard) ? "search queries" : "companies"} configured`,
    );
    automationLogger.endRun(automation.id);
    return await finalizeRun(runId, {
      status: "failed",
      errorMessage: errorCode,
      jobsSearched: 0,
      jobsDeduplicated: 0,
      jobsProcessed: 0,
      jobsMatched: 0,
      jobsSaved: 0,
    });
  }

  try {
    automationLogger.log(
      automation.id,
      "info",
      config.kind !== "ats"
        ? `${label} Search mode: ${JOBSCZ_SEARCH_MODE_LABELS[config.searchMode]} (${config.searchMode}). Fetching up to ${config.maxResults} public listings for ${config.queries.join(", ")}...`
        : `${label} Fetching ${config.companies.length} companies...`,
    );

    const searchResult = await provider.search(config, signal);
    const {
      jobs,
      errors,
      totalScopes,
      skipped = 0,
      rejected = [],
    } = searchResult;
    const fetchedCount = searchResult.fetchedCount ?? jobs.length;
    const startup = config.kind === "startupjobs.cz";
    const duplicates = [...(searchResult.duplicates ?? [])];
    const preAiRejected: NonNullable<FunnelStage["details"]> = [];
    const lowAiRejected: NonNullable<FunnelStage["details"]> = [];
    const startupStats = (analyzed = 0, saved = 0): string | undefined => startup ? JSON.stringify([
      { key: "fetched", label: "Fetched details", count: fetchedCount },
      { key: "duplicates", label: "Duplicates removed", count: duplicates.length, details: duplicates },
      { key: "location_rejected", label: "Location/workplace rejected", count: rejected.filter((r) => r.category === "location").length, details: rejected.filter((r) => r.category === "location") },
      { key: "source_rejected", label: "Invalid/nonmatching details", count: rejected.filter((r) => r.category !== "location").length, details: rejected.filter((r) => r.category !== "location") },
      { key: "pre_ai_rejected", label: "Pre-AI rejected", count: preAiRejected.length, details: preAiRejected },
      { key: "analyzed", label: "AI analyzed", count: analyzed },
      { key: "below_threshold", label: "Below AI threshold", count: lowAiRejected.length, details: lowAiRejected },
      { key: "saved", label: "Saved", count: saved },
    ] satisfies FunnelStage[]) : undefined;
    const logRejection = (rejection: { key: string; name: string; reason: string }) => {
      automationLogger.log(automation.id, "info", `${label} Rejected '${rejection.name}' [${rejection.key}]: ${rejection.reason}`, rejection);
    };
    if (startup) {
      automationLogger.log(automation.id, "info", `${label} Public sitemap discovery matches OR terms in URL titles; portal full-text search coverage is unavailable`);
      duplicates.forEach(logRejection);
    }

    for (const err of errors) {
      automationLogger.log(
        automation.id,
        "warning",
        `${label} '${err.name}' ${err.reason} — skipped`,
      );
    }

    const boardErrors: BoardFailure[] = errors.map((e) => ({
      token: e.key,
      name: e.name,
      reason: e.reason,
    }));
    const total = totalScopes;
    const scopeLabel = config.kind !== "ats" ? "search" : "boards";

    if (errors.length > 0 && errors.length >= total && fetchedCount === 0) {
      const message = config.kind !== "ats"
        ? `${provider.label} search unavailable`
        : `All ${total} boards unreachable`;
      automationLogger.log(automation.id, "error", `${label} ${message}`);
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        status:
          config.kind !== "ats" &&
          errors.some((error) => error.kind === "rate_limited")
            ? "rate_limited"
            : config.kind !== "ats" && errors.some((error) => error.kind === "blocked") ? "blocked" : "failed",
        errorMessage: startup ? `${message}: ${errors.map((e) => e.reason).join("; ")}` : message,
        blockedReason: errors.find((e) => e.kind === "blocked")?.reason,
        funnelStats: startupStats(),
        boardErrors,
        jobsSearched: 0,
        jobsDeduplicated: 0,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    const boardNote =
      errors.length > 0
        ? config.kind !== "ats"
          ? `${errors.length} ${provider.label} listing request(s) failed`
          : `${errors.length} of ${total} boards unreachable`
        : null;
    // One place decides the terminal status for every completed path below.
    const outcome = (aiError: string | null) => ({
      status: aiError || boardNote ? ("completed_with_errors" as const) : ("completed" as const),
      // Joined only for Run History; notifications read aiError directly.
      errorMessage: [aiError, boardNote].filter(Boolean).join("; ") || undefined,
      aiError: aiError ?? undefined,
      boardErrors,
    });

    const jobsSearched = fetchedCount;
    automationLogger.log(
      automation.id,
      "success",
      `${label} Fetched ${jobsSearched} jobs across ${total} ${scopeLabel}; ${jobs.length} passed source filters`,
      { jobsSearched },
    );
    if (rejected.length > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} Rejected ${rejected.length} job(s) by location/workplace filters`,
      );
      for (const rejection of (config.kind === "startupjobs.cz" ? rejected : rejected.slice(0, 5))) {
        automationLogger.log(
          automation.id,
          "info",
          `${label} Rejected '${rejection.name}' [${rejection.key}]: ${rejection.reason}`,
        );
      }
      if (config.kind !== "startupjobs.cz" && rejected.length > 5) {
        automationLogger.log(
          automation.id,
          "info",
          `${label} ${rejected.length - 5} additional rejection(s) omitted from the log`,
        );
      }
    }
    if (skipped > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} Skipped ${skipped} listing(s) without a public server-rendered description`,
      );
    }

    if (config.kind !== "ats" && jobs.length === 0 && jobsSearched > 0) {
      automationLogger.log(
        automation.id,
        "warning",
        `${label} No fetched listings matched the selected ${JOBSCZ_SEARCH_MODE_LABELS[config.searchMode]} location/workplace rules`,
      );
      automationLogger.log(automation.id, "info", `${label} Saved 0 jobs`);
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        ...outcome(null),
        funnelStats: startupStats() ?? JSON.stringify([
          { key: "fetched", label: "Fetched", count: jobsSearched },
          { key: "eligible", label: "In search mode", count: 0 },
        ] satisfies FunnelStage[]),
        jobsSearched,
        jobsDeduplicated: 0,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    // Dedup against existing jobs and within this batch.
    const existingKeys = await getExistingJobDedupeMap(automation.userId);
    const dedupedJobs = dedupeJobs(jobs, existingKeys);
    const jobsDeduplicated = dedupedJobs.length;
    if (startup) {
      const acceptedKeys = new Set(dedupedJobs.map(jobDedupeKey));
      const seen = new Set<string>();
      for (const job of jobs) {
        const key = jobDedupeKey(job);
        if (!acceptedKeys.has(key) || seen.has(key)) {
          const rejection = { key: job.sourceId ?? job.url, name: job.title, reason: existingKeys.has(key) ? "already saved in an earlier run" : "duplicate within this run" };
          duplicates.push(rejection);
          logRejection(rejection);
        }
        seen.add(key);
      }
    }

    automationLogger.log(
      automation.id,
      "info",
      `${label} ${jobsDeduplicated} new jobs after dedup`,
      { jobsDeduplicated },
    );

    if (jobsDeduplicated === 0) {
      automationLogger.log(
        automation.id,
        "info",
        jobs.length === 0
          ? `${label} No listings passed the source filters — nothing to process`
          : `${label} All accepted jobs already saved — nothing new to process`,
      );
      automationLogger.log(automation.id, "info", `${label} Saved 0 jobs`);
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        ...outcome(null),
        funnelStats: startupStats(),
        jobsSearched,
        jobsDeduplicated: 0,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    const resumeSkills = extractResumeSkills(resume);
    const skillTerms = buildSkillTerms(resume);

    // The distinct pool scoreJob actually ranks against. Surfacing it makes a
    // thin search visible instead of showing up only as an unexplained zero.
    const termCount = new Set(
      [...config.keywords, ...resumeSkills]
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ).size;
    automationLogger.log(
      automation.id,
      "info",
      `${label} Ranking against ${termCount} search term(s) (${config.keywords.length} keyword(s) + ${resumeSkills.length} resume skill(s))`,
    );

    const pipeline = runAtsPipeline(dedupedJobs, config, resumeSkills, {
      corpus: jobs,
      k: config.topK,
    });
    if (startup) {
      const retained = new Set([...pipeline.toAnalyze, ...(config.saveUnanalyzed ? pipeline.toSaveUnanalyzed : [])].map((s) => jobDedupeKey(s.job)));
      const additional = new Set(pipeline.toSaveUnanalyzed.map((s) => jobDedupeKey(s.job)));
      const idf = buildIdf(jobs);
      for (const job of dedupedJobs) {
        if (retained.has(jobDedupeKey(job))) continue;
        const scored = scoreJob(job, config.targetTitles, config.keywords, resumeSkills, config.locations, idf);
        const reason = additional.has(jobDedupeKey(job))
          ? `outside top ${config.topK} AI budget; saving additional listings is disabled`
          : !passesFloor(scored.components)
            ? "no target title or keyword/resume skill overlap"
            : scored.score < APP_CONSTANTS.ATS_MIN_PRERANK_SCORE
              ? `pre-ranking score ${scored.score.toFixed(3)} below minimum ${APP_CONSTANTS.ATS_MIN_PRERANK_SCORE}`
              : `outside listing cap ${APP_CONSTANTS.ATS_LISTING_CAP}`;
        const rejection = { key: job.sourceId ?? job.url, name: job.title, reason };
        preAiRejected.push(rejection);
        logRejection(rejection);
      }
    }

    if (config.strictLocation && config.locations.length > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} ${pipeline.funnel.located} jobs remaining after strict location filter`,
      );
    }

    const capped =
      pipeline.funnel.floorSurvivors > pipeline.funnel.relevant
        ? ` (capped to ${pipeline.funnel.relevant})`
        : "";
    automationLogger.log(
      automation.id,
      "info",
      `${label} ${pipeline.funnel.floorSurvivors} jobs cleared the relevance floor${capped}`,
    );
    if (pipeline.funnel.scoreCut > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} ${pipeline.funnel.scoreCut} of them too weakly related to analyze — skipped`,
      );
    }

    const buildFunnel = (analyzed: number, highlighted: number, saved = 0): string => {
      const stats = startupStats(analyzed, saved);
      if (stats) return stats;
      const stages: FunnelStage[] = [
        { key: "fetched", label: "Fetched", count: jobsSearched },
      ];
      if (rejected.length > 0) {
        stages.push({
          key: "eligible",
          label: "In search mode",
          count: jobs.length,
        });
      }
      stages.push({ key: "dedup", label: "New", count: jobsDeduplicated });
      if (pipeline.funnel.located !== null) {
        stages.push({
          key: "located",
          label: "In location",
          count: pipeline.funnel.located,
        });
      }
      stages.push({
        key: "floor",
        label: "Relevant",
        count: pipeline.funnel.relevant,
      });
      stages.push({ key: "analyzed", label: "Analyzed", count: analyzed });
      stages.push({
        key: "highlighted",
        label: "Strong match",
        count: highlighted,
      });
      return JSON.stringify(stages);
    };

    if (pipeline.funnel.relevant === 0) {
      // Re-rank the pre-dedup corpus so an exhausted board (everything that
      // matches is already saved) reads differently from a search that matches
      // nothing at all. Only pays for itself on this zero path.
      const beforeDedup = runAtsPipeline(jobs, config, resumeSkills, {
        corpus: jobs,
        k: config.topK,
      });
      let reason: string;
      if (beforeDedup.funnel.relevant > 0) {
        reason = `all ${beforeDedup.funnel.relevant} matching job(s) on these boards are already in your list — no new postings since the last run`;
      } else if (pipeline.funnel.located === 0) {
        reason = `none of the ${jobsDeduplicated} new job(s) matched your location filter (${config.locations.join(", ")})`;
      } else {
        const checked = pipeline.funnel.located ?? jobsDeduplicated;
        reason = `none of the ${checked} job(s) checked contained any of your ${termCount} search term(s)`;
      }
      automationLogger.log(
        automation.id,
        "warning",
        `${label} No relevant jobs found — ${reason}. Run complete.`,
      );
      automationLogger.log(automation.id, "info", `${label} Saved 0 jobs`);
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        ...outcome(null),
        funnelStats: buildFunnel(0, 0),
        jobsSearched,
        jobsDeduplicated,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    const aiSettings = await getUserAiSettings(automation.userId);
    const modelName =
      aiSettings.model || getDefaultModelForProvider(aiSettings.provider);
    const limit = getAutomationMatchLimit(aiSettings.provider);

    let jobsSaved = 0;
    let jobsTagged = 0;
    let analyzed = 0;
    let highlighted = 0;
    let belowThreshold = 0;
    let aiError: string | null = null;

    // Save the un-analyzed tier (floor survivors beyond the top-K).
    if (signal?.aborted) {
      automationLogger.log(
        automation.id,
        "warning",
        `${label} Run aborted by user`,
      );
    }
    if (config.saveUnanalyzed) {
      for (const scored of pipeline.toSaveUnanalyzed) {
        if (signal?.aborted) break;
        try {
          const { saved, tagsApplied } = await persistDiscoveredJob(
            automation,
            scored.job,
            scalePrerank(scored.score),
            {
              prerankScore: scored.score,
              prerankComponents: scored.components,
              analyzed: false,
            },
            skillTerms,
          );
          if (saved) {
            jobsSaved++;
            if (tagsApplied > 0) jobsTagged++;
          }
        } catch (err) {
          log.error("[ATS] Failed to save listing", {
            "automation.id": automation.id,
            provider: provider.label,
            error: String(err),
          });
        }
      }
    }

    // LLM-analyze the top-K.
    const totalToAnalyze = pipeline.toAnalyze.length;
    automationLogger.log(
      automation.id,
      "info",
      `${label} Running LLM analysis on top ${totalToAnalyze}...`,
    );

    const analyzeJob = async (scored: ScoredJob): Promise<void> => {
      // Queued tasks bail silently as slots free; the abort is logged once
      // after all dispatched tasks settle.
      if (signal?.aborted) return;

      const saveUnanalyzed = async () => {
        try {
          const { saved, tagsApplied } = await persistDiscoveredJob(
            automation,
            scored.job,
            scalePrerank(scored.score),
            {
              prerankScore: scored.score,
              prerankComponents: scored.components,
              analyzed: false,
            },
            skillTerms,
          );
          if (saved) {
            jobsSaved++;
            if (tagsApplied > 0) jobsTagged++;
          }
        } catch (err) {
          log.error("[ATS] Failed to save listing", {
            "automation.id": automation.id,
            provider: provider.label,
            error: String(err),
          });
        }
      };

      if (aiError) {
        await saveUnanalyzed();
        return;
      }

      automationLogger.log(
        automation.id,
        "info",
        `${label} Analyzing: ${scored.job.title} at ${scored.job.company}`,
      );

      const matchResult = await matchJobToResume(
        scored.job,
        resume,
        automation.jobBoard,
        aiSettings,
        automation.userId,
        signal,
      );

      // Abort may have fired mid-call; bail before saving this job. This
      // check must come before the failure branch below, since an aborted
      // match resolves as a non-ai_unavailable failure and would otherwise
      // incorrectly saveUnanalyzed() a cancelled run's job.
      if (signal?.aborted) return;

      if (!matchResult.success) {
        if (matchResult.error === "ai_unavailable") {
          // Only the first concurrent task to fail logs; siblings stay quiet.
          if (!aiError) {
            aiError = `AI provider (${aiSettings.provider}) is not available.`;
            automationLogger.log(automation.id, "error", aiError);
          }
        } else {
          automationLogger.log(
            automation.id,
            "warning",
            `${label} LLM match failed: ${matchResult.error}`,
          );
        }
        await saveUnanalyzed();
        return;
      }

      analyzed++;
      const isStrong = matchResult.score >= automation.matchThreshold;
      if (isStrong) highlighted++;
      else belowThreshold++;

      automationLogger.log(
        automation.id,
        isStrong ? "success" : "info",
        `${label} Analyzed ${analyzed}/${totalToAnalyze}: ${scored.job.title} — ${matchResult.score}%${isStrong ? "" : ` (below ${automation.matchThreshold}% threshold — not saved)`}`,
        { score: matchResult.score, threshold: automation.matchThreshold },
      );

      if (!isStrong) {
        if (startup) {
          const rejection = { key: scored.job.sourceId ?? scored.job.url, name: scored.job.title, reason: `AI score ${matchResult.score}% below threshold ${automation.matchThreshold}%` };
          lowAiRejected.push(rejection);
          logRejection(rejection);
        }
        return;
      }

      try {
        const { saved, tagsApplied } = await persistDiscoveredJob(
          automation,
          scored.job,
          matchResult.score,
          {
            ...matchResult.data,
            resumeId: resume.id,
            resumeTitle: resume.title,
            matchedAt: new Date().toISOString(),
            provider: aiSettings.provider,
            model: modelName,
            prerankScore: scored.score,
            prerankComponents: scored.components,
            analyzed: true,
          },
          skillTerms,
        );
        if (saved) {
          jobsSaved++;
          if (tagsApplied > 0) jobsTagged++;
        }
      } catch (err) {
        log.error("[ATS] Failed to save analyzed job", {
          "automation.id": automation.id,
          provider: provider.label,
          error: String(err),
        });
      }
    };

    await Promise.allSettled(
      pipeline.toAnalyze.map((scored) => limit(() => analyzeJob(scored))),
    );

    if (signal?.aborted) {
      automationLogger.log(
        automation.id,
        "warning",
        `${label} Run aborted by user`,
      );
    }

    automationLogger.log(
      automation.id,
      "success",
      `${label} LLM analysis complete (${analyzed}/${pipeline.toAnalyze.length} succeeded)`,
    );

    if (belowThreshold > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} ${belowThreshold} analyzed job(s) scored below your ${automation.matchThreshold}% threshold and were not saved`,
      );
    }

    if (jobsSaved > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} Tagged ${jobsTagged} of ${jobsSaved} saved job(s) with skills from your resume`,
      );
    }
    automationLogger.log(
      automation.id,
      "success",
      `${label} Saved ${jobsSaved} job(s)`,
      { jobsSaved },
    );

    automationLogger.endRun(automation.id);

    return await finalizeRun(runId, {
      ...(signal?.aborted ? { status: "cancelled" as const } : outcome(aiError)),
      funnelStats: buildFunnel(analyzed, highlighted, jobsSaved),
      jobsSearched,
      jobsDeduplicated,
      jobsProcessed: analyzed,
      jobsMatched: highlighted,
      jobsSaved,
    });
  } catch (error) {
    // An abort surfaces here as an AbortError; finalize as cancelled, not failed.
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      automationLogger.log(automation.id, "warning", `${label} Run aborted by user`);
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        status: "cancelled",
        jobsSearched: 0,
        jobsDeduplicated: 0,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    automationLogger.log(
      automation.id,
      "error",
      `${label} Run failed: ${message}`,
    );
    automationLogger.endRun(automation.id);
    log.error("[ATS] Run failed", {
      "automation.id": automation.id,
      "run.id": runId,
      provider: provider.label,
      error: message,
    });
    return await finalizeRun(runId, {
      status: "failed",
      errorMessage: message,
      jobsSearched: 0,
      jobsDeduplicated: 0,
      jobsProcessed: 0,
      jobsMatched: 0,
      jobsSaved: 0,
    });
  }
}

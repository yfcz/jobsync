import type { AtsProvider } from "../ats/types";
import type { ScraperError } from "../types";
import { APP_CONSTANTS } from "@/lib/constants";
import { errorReason } from "../utils";
import { fetchStartupJobsText } from "./http";
import { matchesStartupJobsQueries, parseStartupJobsDetail, parseStartupJobsSearch, parseStartupJobsSitemapIndex, STARTUPJOBS_ORIGIN } from "./parser";
import { startupJobsRejectionReason } from "./filter";

export type { StartupJobsRunConfig } from "./types";

export const searchStartupJobs: AtsProvider["search"] = async (config, signal) => {
  const result: Awaited<ReturnType<AtsProvider["search"]>> = {
    jobs: [], errors: [], totalScopes: 1, fetchedCount: 0, rejected: [], duplicates: [],
  };
  const failure = (key: string, name: string, error: ScraperError) => {
    const retry = error.type === "rate_limited" && error.retryAfter !== undefined ? `; retry after ${error.retryAfter}s` : "";
    result.errors.push({ key, name, reason: errorReason(error) + retry, kind: error.type });
  };
  if (config.kind !== "startupjobs.cz") {
    failure("config", "Configuration", { type: "parse", message: "Invalid StartupJobs source configuration" });
    return result;
  }
  const robots = await fetchStartupJobsText(`${STARTUPJOBS_ORIGIN}/robots.txt`, signal);
  if (!robots.success) { failure("robots", "StartupJobs robots.txt", robots.error); return result; }
  const index = await fetchStartupJobsText(`${STARTUPJOBS_ORIGIN}/sitemap_index.xml`, signal, robots.data);
  if (!index.success) { failure("index", "StartupJobs sitemap index", index.error); return result; }
  try {
    const sitemap = await fetchStartupJobsText(parseStartupJobsSitemapIndex(index.data), signal, robots.data);
    if (!sitemap.success) { failure("sitemap", "StartupJobs offers sitemap", sitemap.error); return result; }
    const candidates = parseStartupJobsSearch(sitemap.data, config.queries);
    const seen = new Set<string>();
    const unique = candidates.filter((listing) => {
      if (seen.has(listing.id)) {
        result.duplicates!.push({ key: listing.id, name: listing.title, reason: "duplicate source identifier in search results" });
        return false;
      }
      seen.add(listing.id);
      return true;
    });
    const cap = Math.min(APP_CONSTANTS.STARTUPJOBS_MAX_RESULTS, Math.max(1, Math.trunc(config.maxResults)));
    for (const listing of unique.slice(0, cap)) {
      signal?.throwIfAborted();
      const detail = await fetchStartupJobsText(listing.url, signal, robots.data);
      if (!detail.success) {
        failure(listing.id, listing.title, detail.error);
        if (detail.error.type === "blocked" || detail.error.type === "rate_limited") break;
        continue;
      }
      result.fetchedCount!++;
      try {
        const job = parseStartupJobsDetail(detail.data, listing);
        const locationReason = startupJobsRejectionReason(job, config.searchMode);
        const reason = locationReason ??
          (matchesStartupJobsQueries(`${job.title} ${job.description}`, config.queries) ? null : "no search query matched the published listing");
        if (reason) result.rejected!.push({ key: listing.id, name: job.title, reason, category: locationReason ? "location" : "content" });
        else result.jobs.push(job);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Invalid StartupJobs detail";
        result.rejected!.push({ key: listing.id, name: listing.title, reason, category: "content" });
        // Expiry is a normal race with the sitemap. Other failures must surface
        // in Run History instead of silently reporting a successful empty run.
        if (!reason.startsWith("Listing is not published")) failure(listing.id, listing.title, { type: "parse", message: reason });
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    failure("sitemap", "StartupJobs public data", { type: "parse", message: error instanceof Error ? error.message : "Invalid public data" });
  }
  return result;
};

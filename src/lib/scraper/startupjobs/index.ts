import type { AtsProvider } from "../ats/types";
import type { ScraperError } from "../types";
import { APP_CONSTANTS } from "@/lib/constants";
import { errorReason } from "../utils";
import { fetchStartupJobsText, robotsAllows } from "./http";
import { parseStartupJobsDetail, parseStartupJobsSearchPage, STARTUPJOBS_ORIGIN } from "./parser";
import { buildStartupJobsSearchRequest, STARTUPJOBS_SEARCH_ORIGIN } from "./search";
import { startupJobsRejectionReason } from "./filter";
import type { StartupJobsListing } from "./types";

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
  const webRobots = await fetchStartupJobsText(`${STARTUPJOBS_ORIGIN}/robots.txt`, signal);
  if (!webRobots.success) {
    failure("robots", "StartupJobs robots.txt", webRobots.error);
    return result;
  }
  if (!robotsAllows(webRobots.data, `${STARTUPJOBS_ORIGIN}/nabidka/1/check`)) {
    failure("robots", "StartupJobs robots.txt", { type: "blocked", reason: "StartupJobs robots.txt does not permit offer details" });
    return result;
  }
  const searchRobots = await fetchStartupJobsText(`${STARTUPJOBS_SEARCH_ORIGIN}/robots.txt`, signal);
  if (!searchRobots.success) {
    failure("search-robots", "StartupJobs search robots.txt", searchRobots.error);
    return result;
  }

  const cap = Math.min(APP_CONSTANTS.STARTUPJOBS_MAX_RESULTS, Math.max(1, Math.trunc(config.maxResults)));
  const queries = [...new Map(config.queries.map((query) => [query.trim().toLocaleLowerCase("cs"), query.trim()])).values()];
  const pools = queries.map((query) => ({ query, listings: [] as StartupJobsListing[], nextPage: 1 as number | undefined }));
  // Separate portal searches give OR semantics. Preserve each query's server
  // ranking and interleave results so the first query cannot use all details.
  // No URL-title or literal-word gate is applied to native search results.
  for (let round = 0; round < APP_CONSTANTS.STARTUPJOBS_MAX_SEARCH_PAGES; round++) {
    for (const pool of pools) {
      if (!pool.nextPage) continue;
      const page = pool.nextPage;
      pool.nextPage = undefined;
      try {
        const request = buildStartupJobsSearchRequest(pool.query, config.searchMode, page);
        const search = await fetchStartupJobsText(request.url, signal, searchRobots.data, request.body);
        if (!search.success) {
          failure(pool.query, `StartupJobs search '${pool.query}'`, search.error);
          if (search.error.type === "blocked" || search.error.type === "rate_limited") return result;
          continue;
        }
        const parsed = parseStartupJobsSearchPage(search.data, page);
        pool.listings.push(...parsed.listings);
        pool.nextPage = parsed.nextPage;
      } catch (error) {
        if (signal?.aborted) throw error;
        failure(pool.query, `StartupJobs search '${pool.query}'`, {
          type: "parse", message: error instanceof Error ? error.message : "Invalid search response",
        });
      }
    }
    const unique = new Set(pools.flatMap((pool) => pool.listings.map((listing) => listing.id)));
    if (unique.size >= cap || pools.every((pool) => !pool.nextPage)) break;
  }

  const candidates: StartupJobsListing[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...pools.map((pool) => pool.listings.length));
  for (let index = 0; index < longest; index++) {
    for (const pool of pools) {
      const listing = pool.listings[index];
      if (!listing) continue;
      if (seen.has(listing.id)) {
        result.duplicates!.push({ key: listing.id, name: listing.title, reason: "duplicate source identifier across search results" });
      } else {
        seen.add(listing.id);
        candidates.push(listing);
      }
    }
  }
  for (const listing of candidates.slice(0, cap)) {
    signal?.throwIfAborted();
    const detail = await fetchStartupJobsText(listing.url, signal, webRobots.data);
    if (!detail.success) {
      failure(listing.id, listing.title, detail.error);
      if (detail.error.type === "blocked" || detail.error.type === "rate_limited") break;
      continue;
    }
    result.fetchedCount!++;
    try {
      const job = parseStartupJobsDetail(detail.data, listing);
      const reason = startupJobsRejectionReason(job, config.searchMode);
      if (reason) result.rejected!.push({ key: listing.id, name: job.title, reason, category: "location" });
      else result.jobs.push(job);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Invalid StartupJobs detail";
      result.rejected!.push({ key: listing.id, name: listing.title, reason, category: "content" });
      if (!reason.startsWith("Listing is not published")) {
        failure(listing.id, listing.title, { type: "parse", message: reason });
      }
    }
  }
  return result;
};

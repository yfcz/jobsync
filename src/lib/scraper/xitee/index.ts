import type { AtsProvider } from "../ats/types";
import type { ScraperError } from "../types";
import { errorReason } from "../utils";
import { fetchXiteeText } from "./http";
import { XITEE_LISTING_URL, XITEE_ORIGIN } from "./urls";
import { parseXiteeDetail, parseXiteeListing } from "./parser";

export const searchXiteeJobs: AtsProvider["search"] = async (config, signal) => {
  const result: Awaited<ReturnType<AtsProvider["search"]>> = {
    jobs: [], errors: [], totalScopes: 1, listingCount: 0, fetchedCount: 0, rejected: [],
  };
  const failure = (key: string, name: string, error: ScraperError) => {
    const retry = error.type === "rate_limited" && error.retryAfter !== undefined ? `; retry after ${error.retryAfter}s` : "";
    result.errors.push({ key, name, reason: errorReason(error) + retry, kind: error.type });
  };
  if (config.kind !== "xitee") {
    failure("config", "Configuration", { type: "parse", message: "Invalid xitee source configuration" });
    return result;
  }
  const robots = await fetchXiteeText(`${XITEE_ORIGIN}/robots.txt`, signal);
  if (!robots.success) { failure("robots", "xitee robots.txt", robots.error); return result; }
  const page = await fetchXiteeText(XITEE_LISTING_URL, signal, robots.data);
  if (!page.success) { failure("listing", "xitee vacancy list", page.error); return result; }
  try {
    const listings = parseXiteeListing(page.data);
    result.listingCount = listings.length;
    // Sequential detail fetching bounds memory and stops immediately on rate
    // limits/access denial. All actual vacancy links are considered.
    for (const listing of listings) {
      signal?.throwIfAborted();
      const detail = await fetchXiteeText(listing.url, signal, robots.data);
      if (!detail.success) {
        failure(listing.url, listing.title, detail.error);
        if (detail.error.type === "blocked" || detail.error.type === "rate_limited") break;
        continue;
      }
      try {
        result.jobs.push(parseXiteeDetail(detail.data, listing));
        result.fetchedCount!++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid xitee detail";
        failure(listing.url, listing.title, { type: "parse", message });
        result.rejected!.push({ key: listing.url, name: listing.title, reason: message, category: "content" });
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    failure("listing", "xitee vacancy list", { type: "parse", message: error instanceof Error ? error.message : "Invalid xitee listing" });
  }
  return result;
};

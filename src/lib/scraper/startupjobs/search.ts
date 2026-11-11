import { APP_CONSTANTS } from "@/lib/constants";
import type { JobsCzSearchMode } from "@/models/automation.model";
import type { StartupJobsSearchCriteria } from "./types";

export const STARTUPJOBS_SEARCH_ORIGIN = "https://back.startupjobs.cz";

// Verified against the public form's search client on 2026-11-11. These place
// IDs also appear in the structured workplace data of public offer details.
const CITY_LOCATIONS = {
  brno: "ChIJEVE_wDqUEkcRsLEUZg-vAAQ",
  praha: "ChIJi3lwCZyTC0cRkEAWZg-vAAQ",
} as const;

export function buildStartupJobsSearchRequest(
  query: string,
  mode: JobsCzSearchMode,
  page = 1,
): { url: string; body: StartupJobsSearchCriteria } {
  const term = query.trim();
  if (!term || term.length > 100 || !Number.isInteger(page) || page < 1 ||
      page > APP_CONSTANTS.STARTUPJOBS_MAX_SEARCH_PAGES) {
    throw new Error("Invalid StartupJobs search query or page");
  }
  const body: StartupJobsSearchCriteria = { query: term };
  if (mode === "remote_cz") {
    // No city restriction. Czech eligibility is verified on public details.
    body.locationPreferences = ["remote"];
  } else {
    body.locations = [{ locationId: CITY_LOCATIONS[mode], radiusKm: 0 }];
  }
  return { url: `${STARTUPJOBS_SEARCH_ORIGIN}/api/search-offers?page=${page}`, body };
}

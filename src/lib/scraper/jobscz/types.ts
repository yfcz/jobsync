import type { JobDetails } from "../types";
import type { ScraperError } from "../types";
import type { JobsCzSearchMode } from "@/models/automation.model";

export interface JobsCzSearchListing {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  workplaceType?: "REMOTE" | "HYBRID";
}

export interface JobsCzRunConfig {
  kind: "jobs.cz";
  searchMode: JobsCzSearchMode;
  queries: string[];
  targetTitles: string[];
  keywords: string[];
  locations: string[];
  strictLocation: boolean;
  topK: number;
  saveUnanalyzed: boolean;
  maxResults: number;
}

export interface JobsCzSearchResult {
  jobs: JobDetails[];
  errors: {
    key: string;
    name: string;
    reason: string;
    kind?: ScraperError["type"];
  }[];
  totalScopes: number;
  skipped: number;
  fetchedCount: number;
  rejected: {
    key: string;
    name: string;
    reason: string;
  }[];
}

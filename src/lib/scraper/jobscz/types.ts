import type { JobDetails } from "../types";
import type { ScraperError } from "../types";

export interface JobsCzSearchListing {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
}

export interface JobsCzRunConfig {
  kind: "jobs.cz";
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
}

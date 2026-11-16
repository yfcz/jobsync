export interface JobDetails {
  sourceId?: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  postedDate?: string;
  salary?: string;
  employmentType?: string;
  isRemote?: boolean;
  workplaceType?: string;
  applicationUrl?: string;
  // Publisher-provided equivalents only; never fetched as part of discovery.
  dedupeUrls?: string[];
}

export type ScraperError =
  | { type: "blocked"; reason: string }
  | { type: "rate_limited"; retryAfter?: number }
  | { type: "network"; message: string }
  | { type: "parse"; message: string };

export type ScraperResult<T> =
  | { success: true; data: T }
  | { success: false; error: ScraperError };

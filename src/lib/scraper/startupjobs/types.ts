import type { JobsCzRunConfig } from "../jobscz/types";
import type { JobDetails } from "../types";

export interface StartupJobsRunConfig extends Omit<JobsCzRunConfig, "kind"> {
  kind: "startupjobs.cz";
}

export interface StartupJobsListing {
  id: string;
  url: string;
  title: string;
}

export interface StartupJobsJob extends JobDetails {
  sourceId: string;
  cities: string[];
  countries: string[];
  workplaces: { city: string; country: string }[];
  collaborations: string[];
  skills: string[];
  sourceDescription: string;
}

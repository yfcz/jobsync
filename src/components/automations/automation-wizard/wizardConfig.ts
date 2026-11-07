import { APP_CONSTANTS } from "@/lib/constants";
import type { CreateAutomationInput } from "@/models/automation.schema";
import type { AtsConfigValue } from "../AtsSearchStep";
import type { JobBoard, JobsCzSourceConfig } from "@/models/automation.model";

export type SourceKey = JobBoard;
export type SearchConfigValue = AtsConfigValue | JobsCzSourceConfig;

export const EMPTY_ATS: AtsConfigValue = {
  companies: [],
  targetTitles: [],
  keywords: [],
  locations: [],
  strictLocation: false,
  topK: APP_CONSTANTS.MAX_JOBS_PER_RUN,
  saveUnanalyzed: true,
};

export const EMPTY_JOBSCZ: JobsCzSourceConfig = {
  queries: ["java", "backend"],
  targetTitles: ["Java Developer", "Backend Developer"],
  keywords: ["Java", "Spring", "Spring Boot", "backend"],
  locations: ["Brno"],
  strictLocation: true,
  topK: APP_CONSTANTS.MAX_JOBS_PER_RUN,
  saveUnanalyzed: true,
  maxResults: APP_CONSTANTS.JOBSCZ_MAX_RESULTS,
};

export const STEPS = [
  { id: "basics", title: "Basics", description: "Name your automation" },
  { id: "search", title: "Search", description: "Configure search criteria" },
  { id: "resume", title: "Resume", description: "Select resume for matching" },
  { id: "matching", title: "Matching", description: "Set match threshold" },
  { id: "schedule", title: "Schedule", description: "When to run" },
  { id: "review", title: "Review", description: "Confirm settings" },
];

export const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i.toString().padStart(2, "0")}:00`,
}));

export function parseEditSourceConfig(
  sc?: string | null,
): CreateAutomationInput["sourceConfig"] | undefined {
  if (!sc) return undefined;
  try {
    const parsed = JSON.parse(sc);
    return parsed?.greenhouse || parsed?.lever || parsed?.ashby || parsed?.["jobs.cz"]
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

export interface WizardResume {
  id: string;
  title: string;
  sectionCount: number;
}

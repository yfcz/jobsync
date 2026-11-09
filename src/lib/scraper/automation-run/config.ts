import { APP_CONSTANTS } from "@/lib/constants";
import {
  jobsCzSearchMode,
  type JobBoard,
} from "@/models/automation.model";
import type { JobsCzRunConfig } from "../jobscz";

export interface AtsRunConfig {
  kind: "ats";
  companies: { name: string; token: string; host?: "default" | "eu" }[];
  targetTitles: string[];
  keywords: string[];
  locations: string[];
  strictLocation: boolean;
  topK: number;
  saveUnanalyzed: boolean;
}

export type AutomationRunConfig = AtsRunConfig | JobsCzRunConfig;

export function parseAutomationConfig(
  sourceConfig: string | null | undefined,
  jobBoard: JobBoard,
): AutomationRunConfig | null {
  if (!sourceConfig) return null;
  try {
    const parsed = JSON.parse(sourceConfig);
    const cfg = parsed?.[jobBoard];
    if (jobBoard === "jobs.cz") {
      if (!cfg || !Array.isArray(cfg.queries) || cfg.queries.length === 0) {
        return null;
      }
      const searchMode = jobsCzSearchMode(cfg.searchMode);
      return {
        kind: "jobs.cz",
        searchMode,
        queries: cfg.queries
          .filter((value: unknown): value is string => typeof value === "string")
          .map((value: string) => value.trim())
          .filter(Boolean)
          .slice(0, 3),
        targetTitles: Array.isArray(cfg.targetTitles) ? cfg.targetTitles : [],
        keywords: Array.isArray(cfg.keywords) ? cfg.keywords : [],
        locations:
          searchMode === "brno"
            ? ["Brno"]
            : searchMode === "praha"
              ? ["Praha", "Prague", "Hlavní město Praha"]
              : [],
        strictLocation: searchMode !== "remote_cz",
        topK:
          typeof cfg.topK === "number" && cfg.topK > 0
            ? cfg.topK
            : APP_CONSTANTS.MAX_JOBS_PER_RUN,
        saveUnanalyzed: cfg.saveUnanalyzed !== false,
        maxResults:
          typeof cfg.maxResults === "number" && cfg.maxResults > 0
            ? Math.min(cfg.maxResults, APP_CONSTANTS.JOBSCZ_MAX_RESULTS)
            : APP_CONSTANTS.JOBSCZ_MAX_RESULTS,
      };
    }
    if (!cfg || !Array.isArray(cfg.companies)) return null;
    return {
      kind: "ats",
      companies: cfg.companies,
      targetTitles: Array.isArray(cfg.targetTitles) ? cfg.targetTitles : [],
      keywords: Array.isArray(cfg.keywords) ? cfg.keywords : [],
      locations: Array.isArray(cfg.locations) ? cfg.locations : [],
      strictLocation: !!cfg.strictLocation,
      topK:
        typeof cfg.topK === "number" && cfg.topK > 0
          ? cfg.topK
          : APP_CONSTANTS.MAX_JOBS_PER_RUN,
      saveUnanalyzed: cfg.saveUnanalyzed !== false,
    };
  } catch {
    return null;
  }
}

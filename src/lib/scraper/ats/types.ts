import type { JobBoard } from "@/models/automation.model";
import type { JobDetails } from "../types";
import type { ScraperError } from "../types";
import type { AutomationRunConfig } from "../automation-run/config";

// `host` is optional and Lever-only (Greenhouse ignores it); it's persisted
// once a company is resolved so runtime fetches never re-probe regions.
export type AtsHost = "default" | "eu";

export interface AtsProvider {
  id: JobBoard;
  label: string; // display name shown in the wizard/detail UI
  // Fetch a watchlist with bounded concurrency + per-token isolation.
  search(
    config: AutomationRunConfig,
    signal?: AbortSignal,
  ): Promise<{
    jobs: JobDetails[];
    errors: {
      key: string;
      name: string;
      reason: string;
      kind?: ScraperError["type"];
    }[];
    totalScopes: number;
    skipped?: number;
    fetchedCount?: number;
    rejected?: {
      key: string;
      name: string;
      reason: string;
    }[];
  }>;
}

import type { JobBoard } from "@/models/automation.model";
import { searchGreenhouseJobs } from "../greenhouse";
import { searchLeverJobs } from "../lever";
import { searchAshbyJobs } from "../ashby";
import { searchJobsCzJobs } from "../jobscz";
import type { AtsProvider } from "./types";
import type { AutomationRunConfig } from "../automation-run/config";

type AtsSearch = (
  companies: { name: string; token: string; host?: "default" | "eu" }[],
) => Promise<{
  jobs: import("../types").JobDetails[];
  errors: { token: string; reason: string }[];
}>;

function adaptAtsSearch(search: AtsSearch): AtsProvider["search"] {
  return async (config: AutomationRunConfig) => {
    if (config.kind !== "ats") {
      return {
        jobs: [],
        errors: [{ key: "config", name: "Configuration", reason: "invalid source configuration" }],
        totalScopes: 1,
      };
    }
    const result = await search(config.companies);
    const names = new Map(config.companies.map((company) => [company.token, company.name]));
    return {
      jobs: result.jobs,
      errors: result.errors.map((error) => ({
        key: error.token,
        name: names.get(error.token) ?? error.token,
        reason: error.reason,
      })),
      totalScopes: config.companies.length,
    };
  };
}

// Server-only: imports the real network-calling search fns (fetch, p-limit).
// Never import this from client-bundled code — use ATS_BOARDS from
// automation.model.ts for the plain, dependency-free board list.
export const ATS_PROVIDERS: Partial<Record<JobBoard, AtsProvider>> = {
  greenhouse: {
    id: "greenhouse",
    label: "Greenhouse",
    search: adaptAtsSearch(searchGreenhouseJobs),
  },
  lever: { id: "lever", label: "Lever", search: adaptAtsSearch(searchLeverJobs) },
  ashby: { id: "ashby", label: "Ashby", search: adaptAtsSearch(searchAshbyJobs) },
  "jobs.cz": { id: "jobs.cz", label: "Jobs.cz", search: searchJobsCzJobs },
};

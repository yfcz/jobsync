// Automation types and interfaces

export type AutomationStatus = "active" | "paused";
export type AutomationRunStatus =
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "completed_with_errors"
  | "blocked"
  | "rate_limited"
  | "cancelled";
export type DiscoveryStatus = "new" | "accepted" | "dismissed";
export type CzechJobBoard = "jobs.cz" | "startupjobs.cz";
export type JobBoard = "greenhouse" | "lever" | "ashby" | CzechJobBoard;
export type AtsBoard = Exclude<JobBoard, CzechJobBoard>;
export function isCzechJobBoard(board: string): board is CzechJobBoard {
  return board === "jobs.cz" || board === "startupjobs.cz";
}
export const JOBSCZ_SEARCH_MODES = ["brno", "praha", "remote_cz"] as const;
export type JobsCzSearchMode = (typeof JOBSCZ_SEARCH_MODES)[number];

export const JOBSCZ_SEARCH_MODE_LABELS: Record<JobsCzSearchMode, string> = {
  brno: "Brno",
  praha: "Prague",
  remote_cz: "Remote – Czech Republic",
};

export function jobsCzSearchMode(
  value: unknown,
): JobsCzSearchMode {
  return JOBSCZ_SEARCH_MODES.includes(value as JobsCzSearchMode)
    ? (value as JobsCzSearchMode)
    : "brno";
}

export interface GreenhouseCompany {
  name: string;
  token: string;
}

export interface GreenhouseSourceConfig {
  companies: GreenhouseCompany[];
  targetTitles?: string[];
  keywords?: string[];
  locations?: string[];
  strictLocation?: boolean;
  topK?: number;
  saveUnanalyzed?: boolean;
}

export type LeverHost = "default" | "eu";

export interface LeverCompany {
  name: string;
  token: string;
  host?: LeverHost; // absent/"default" = the common case
}

// Field-identical to Greenhouse except `companies` carries the extra `host`.
export interface LeverSourceConfig
  extends Omit<GreenhouseSourceConfig, "companies"> {
  companies: LeverCompany[];
}

// Ashby has a single global host, so its company entries are the plain
// {name, token} shape — no `host`, unlike Lever.
export interface AshbyCompany {
  name: string;
  token: string;
}

export interface AshbySourceConfig
  extends Omit<GreenhouseSourceConfig, "companies"> {
  companies: AshbyCompany[];
}

export interface JobsCzSourceConfig {
  // Jobs.cz accepts repeated q[] parameters. Keeping these separate lets the
  // UI express the intended Java/backend OR search without inventing a
  // company-board token.
  queries: string[];
  // Optional for backward compatibility. Legacy Jobs.cz configurations are
  // Brno searches and are interpreted as such by the UI and runner.
  searchMode?: JobsCzSearchMode;
  targetTitles?: string[];
  keywords?: string[];
  locations?: ("Brno" | "Praha")[];
  strictLocation?: boolean;
  topK?: number;
  saveUnanalyzed?: boolean;
  // Bounds both detail HTTP requests and in-memory work for this source.
  maxResults?: number;
}

export interface SourceConfig {
  greenhouse?: GreenhouseSourceConfig;
  lever?: LeverSourceConfig;
  ashby?: AshbySourceConfig;
  "jobs.cz"?: JobsCzSourceConfig;
  "startupjobs.cz"?: StartupJobsSourceConfig;
}

export interface StartupJobsSourceConfig extends JobsCzSourceConfig {
  searchMode: JobsCzSearchMode;
}

// Plain, dependency-free board list. Do NOT import this from ats/registry.ts
// (that pulls the network-calling search fns into client bundles). Both the
// client-imported schema and the scheduler import it here.
export const ATS_BOARDS: AtsBoard[] = ["greenhouse", "lever", "ashby"];
export const AUTOMATION_BOARDS: JobBoard[] = [...ATS_BOARDS, "jobs.cz", "startupjobs.cz"];

// Boards that used to exist and were removed. Their Automation rows stay in
// the database; the UI marks them retired and only offers pause/delete.
export const RETIRED_BOARDS = ["jsearch"];
export function isRetiredBoard(board: string): boolean {
  return RETIRED_BOARDS.includes(board);
}

export interface Automation {
  id: string;
  userId: string;
  name: string;
  jobBoard: JobBoard;
  keywords: string;
  location: string;
  sourceConfig?: string | null;
  resumeId: string;
  matchThreshold: number;
  scheduleHour: number;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  status: AutomationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationWithResume extends Automation {
  resume: {
    id: string;
    title: string;
  };
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  details?: { key: string; name: string; reason: string }[];
}

export interface AutomationRun {
  id: string;
  automationId: string;
  jobsSearched: number;
  jobsDeduplicated: number;
  jobsProcessed: number;
  jobsMatched: number;
  jobsSaved: number;
  status: AutomationRunStatus;
  errorMessage: string | null;
  blockedReason: string | null;
  funnelStats: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface DiscoveredJob {
  id: string;
  userId: string;
  automationId: string;
  automation?: {
    id: string;
    name: string;
  };
  jobUrl: string | null;
  description: string;
  jobType: string;
  workplaceType?: string | null;
  createdAt: Date;
  jobTitleId: string;
  companyId: string;
  locationId: string | null;
  matchScore: number;
  matchData: string | null;
  discoveryStatus: DiscoveryStatus;
  discoveredAt: Date;
  JobTitle: { label: string };
  Company: { label: string };
  Location?: { label: string } | null;
}

export interface ScrapedJobData {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string;
  sourceBoard: JobBoard;
  employmentType?: string;
  isRemote?: boolean;
  workplaceType?: string;
}

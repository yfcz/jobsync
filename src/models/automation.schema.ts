import { z } from "zod";
import { APP_CONSTANTS } from "@/lib/constants";
import { isCzechJobBoard } from "./automation.model";
// Deep-import (NOT the barrel) — utils.ts is pure; the barrel pulls scraper
// network code into the client bundle via this file's client consumers.
import { ATS_TOKEN_REGEX } from "@/lib/scraper/utils";

export const JobBoardSchema = z.enum([
  "greenhouse",
  "lever",
  "ashby",
  "jobs.cz",
  "startupjobs.cz",
]);

export const AutomationStatusSchema = z.enum(["active", "paused"]);

export const AutomationRunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "completed_with_errors",
  "blocked",
  "rate_limited",
]);

export const DiscoveryStatusSchema = z.enum(["new", "accepted", "dismissed"]);

export const GreenhouseCompanySchema = z.object({
  name: z.string().min(1).max(200),
  token: z.string().min(1).max(80),
});

export const GreenhouseSourceConfigSchema = z.object({
  companies: z
    .array(GreenhouseCompanySchema)
    .max(APP_CONSTANTS.ATS_MAX_COMPANIES),
  targetTitles: z.array(z.string().min(1).max(100)).optional(),
  keywords: z.array(z.string().min(1).max(100)).optional(),
  locations: z.array(z.string().min(1).max(100)).optional(),
  strictLocation: z.boolean().optional(),
  topK: z.number().int().min(1).max(APP_CONSTANTS.ATS_LISTING_CAP).optional(),
  saveUnanalyzed: z.boolean().optional(),
});

// Override `token` with the allowlist regex so a directly-POSTed Lever config
// can't smuggle a malformed token past the save boundary.
export const LeverCompanySchema = GreenhouseCompanySchema.extend({
  token: z.string().regex(ATS_TOKEN_REGEX),
  host: z.enum(["default", "eu"]).optional(),
});

// Same fields/MAX/cap as Greenhouse, `companies` swapped to LeverCompanySchema.
export const LeverSourceConfigSchema = GreenhouseSourceConfigSchema.extend({
  companies: z
    .array(LeverCompanySchema)
    .max(APP_CONSTANTS.ATS_MAX_COMPANIES),
});

// Same token allowlist as Lever (rejects path/query injection at the save
// boundary); no `host` — Ashby is single-host.
export const AshbyCompanySchema = GreenhouseCompanySchema.extend({
  token: z.string().regex(ATS_TOKEN_REGEX),
});

export const AshbySourceConfigSchema = GreenhouseSourceConfigSchema.extend({
  companies: z
    .array(AshbyCompanySchema)
    .max(APP_CONSTANTS.ATS_MAX_COMPANIES),
});

export const JobsCzSourceConfigSchema = z.object({
  queries: z
    .array(z.string().trim().min(1).max(100))
    .min(1, "Add at least one Jobs.cz search query")
    .max(3),
  searchMode: z.enum(["brno", "praha", "remote_cz"]).optional(),
  targetTitles: z.array(z.string().trim().min(1).max(100)).optional(),
  keywords: z.array(z.string().trim().min(1).max(100)).optional(),
  // Retained for legacy serialized configurations. Runtime location scope is
  // derived from searchMode so mismatched client input cannot widen a search.
  locations: z.array(z.enum(["Brno", "Praha"])).max(1).optional(),
  strictLocation: z.boolean().optional(),
  topK: z.number().int().min(1).max(APP_CONSTANTS.ATS_LISTING_CAP).optional(),
  saveUnanalyzed: z.boolean().optional(),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(APP_CONSTANTS.JOBSCZ_MAX_RESULTS)
    .optional(),
});

export const StartupJobsSourceConfigSchema = JobsCzSourceConfigSchema.extend({
  queries: z.array(z.string().trim().min(1).max(100).refine((value) => /[\p{L}\p{N}]/u.test(value), "Use a search term with letters or numbers")).min(1, "Add at least one StartupJobs.cz search query").max(3),
  searchMode: z.enum(["brno", "praha", "remote_cz"]),
  maxResults: z.number().int().min(1).max(APP_CONSTANTS.STARTUPJOBS_MAX_RESULTS).optional(),
});

export const SourceConfigSchema = z.object({
  greenhouse: GreenhouseSourceConfigSchema.optional(),
  lever: LeverSourceConfigSchema.optional(),
  ashby: AshbySourceConfigSchema.optional(),
  "jobs.cz": JobsCzSourceConfigSchema.optional(),
  "startupjobs.cz": StartupJobsSourceConfigSchema.optional(),
});

export const CreateAutomationSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100),
    jobBoard: JobBoardSchema,
    keywords: z.string().max(200).optional(),
    location: z.string().max(100).optional(),
    sourceConfig: SourceConfigSchema.optional(),
    resumeId: z.string().uuid("Invalid resume"),
    matchThreshold: z.number().min(0).max(100),
    scheduleHour: z.number().min(0).max(23),
  })
  .superRefine((data, ctx) => {
    if (isCzechJobBoard(data.jobBoard)) {
      const queries = data.sourceConfig?.[data.jobBoard]?.queries ?? [];
      if (queries.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceConfig", data.jobBoard, "queries"],
          message: "Add at least one search query",
        });
      }
      return;
    }
    const companies = data.sourceConfig?.[data.jobBoard]?.companies ?? [];
    if (companies.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceConfig", data.jobBoard, "companies"],
        message: "Select at least one company",
      });
    }
  });

export const UpdateAutomationSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    jobBoard: JobBoardSchema.optional(),
    keywords: z.string().max(200).optional(),
    location: z.string().max(100).optional(),
    sourceConfig: SourceConfigSchema.optional(),
    resumeId: z.string().uuid("Invalid resume").optional(),
    matchThreshold: z.number().min(0).max(100).optional(),
    scheduleHour: z.number().min(0).max(23).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.jobBoard) return;
    if (isCzechJobBoard(data.jobBoard)) {
      const queries = data.sourceConfig?.[data.jobBoard]?.queries ?? [];
      if (queries.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceConfig", data.jobBoard, "queries"],
          message: "Add at least one search query",
        });
      }
      return;
    }
    const companies = data.sourceConfig?.[data.jobBoard]?.companies ?? [];
    if (companies.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceConfig", data.jobBoard, "companies"],
        message: "Select at least one company",
      });
    }
  });

export type CreateAutomationInput = z.infer<typeof CreateAutomationSchema>;
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationSchema>;
export type SourceConfigInput = z.infer<typeof SourceConfigSchema>;
export type GreenhouseSourceConfigInput = z.infer<
  typeof GreenhouseSourceConfigSchema
>;
export type JobsCzSourceConfigInput = z.infer<
  typeof JobsCzSourceConfigSchema
>;

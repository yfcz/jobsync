import type { JobsCzSearchMode } from "@/models/automation.model";
import { hasAttendanceContradiction, isBrnoLocation, isPragueLocation } from "../jobscz/filter";
import { normalizeSearchText } from "./parser";
import type { StartupJobsJob } from "./types";
import { flattenHtml } from "../html";

function isCzechCountry(country: string): boolean {
  return ["cz", "cesko", "ceska republika", "czechia", "czech republic"].includes(normalizeSearchText(country));
}

function requiresAttendance(job: StartupJobsJob): boolean {
  // A genuine remote option may be offered alongside optional office work.
  // Remove only explicit alternative-mode phrases; mandatory days/attendance
  // elsewhere in the text still trigger the shared contradiction checks.
  const text = normalizeSearchText(flattenHtml(`${job.title} ${job.sourceDescription}`))
    .replace(/(?:remote|prace na dalku)\s+(?:prace\s+)?(?:nebo|or)\s+(?:on ?site|hybridni|hybrid)/g, "remote choice")
    .replace(/(?:on ?site|hybridni|hybrid)\s+(?:nebo|or)\s+(?:fully\s+)?remote/g, "remote choice");
  return hasAttendanceContradiction({ ...job, title: "", description: text });
}

export function startupJobsRejectionReason(job: StartupJobsJob, mode: JobsCzSearchMode): string | null {
  if (mode === "brno") return job.workplaces.some((l) => isBrnoLocation(l.city) && isCzechCountry(l.country)) ? null : "outside Brno (structured workplace location)";
  if (mode === "praha") return job.workplaces.some((l) => isPragueLocation(l.city) && isCzechCountry(l.country)) ? null : "outside Prague (structured workplace location)";
  if (!job.collaborations.includes("remote")) return "not marked fully remote (home office or hybrid alone is insufficient)";
  if (requiresAttendance(job)) return "hybrid or on-site attendance required";
  // A company address, job title or mention of Czechia in the description does
  // not establish remote eligibility. Require a structured Czech workplace.
  if (!job.countries.some(isCzechCountry)) {
    return "not confirmed available in the Czech Republic";
  }
  return null;
}

import type { JobsCzSearchMode } from "@/models/automation.model";
import type { JobDetails } from "../types";

export type JobsCzFilterRejectionReason =
  | "outside Brno"
  | "outside Prague"
  | "not marked fully remote"
  | "hybrid or on-site attendance required"
  | "not confirmed available in the Czech Republic";

export interface JobsCzFilterRejection {
  job: JobDetails;
  reason: JobsCzFilterRejectionReason;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("cs")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasTerm(value: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(value);
}

export function isBrnoLocation(location: string): boolean {
  const normalized = normalize(location);
  if (/brno\s*[-–—]\s*venkov/.test(normalized)) return false;
  return hasTerm(normalized, "brno");
}

export function isPragueLocation(location: string): boolean {
  const normalized = normalize(location);
  if (/praha\s*[-–—]\s*(?:vychod|zapad)/.test(normalized)) {
    return false;
  }
  return hasTerm(normalized, "praha") || hasTerm(normalized, "prague");
}

const CZECH_LOCATION_TERMS = [
  "ceska republika",
  "czech republic",
  "czechia",
  "cesko",
  "cr",
  "praha",
  "prague",
  "brno",
  "ostrava",
  "plzen",
  "pilsen",
  "liberec",
  "olomouc",
  "ceske budejovice",
  "hradec kralove",
  "pardubice",
  "usti nad labem",
  "zlin",
  "jihlava",
  "karlovy vary",
  "kladno",
  "most",
  "opava",
  "frydek-mistek",
  "karvina",
  "havirov",
  "mlada boleslav",
  "prostejov",
  "prerov",
  "teplice",
  "decin",
  "chomutov",
  "jablonec nad nisou",
  "jihomoravsky kraj",
  "stredocesky kraj",
  "moravskoslezsky kraj",
  "plzensky kraj",
  "liberecky kraj",
  "olomoucky kraj",
  "jihocesky kraj",
  "kralovehradecky kraj",
  "pardubicky kraj",
  "ustecky kraj",
  "zlinsky kraj",
  "kraj vysocina",
];

function hasCzechLocationEvidence(job: JobDetails): boolean {
  const location = normalize(job.location);
  if (CZECH_LOCATION_TERMS.some((term) => hasTerm(location, term))) {
    return true;
  }

  // A location consisting only of "remote" is ambiguous. In that one case,
  // accept an explicit country statement from the posting body. Description
  // text is never used as evidence for Brno/Prague or for remote work itself.
  if (
    !location ||
    /^(remote|fully remote|work from home|anywhere)$/.test(location)
  ) {
    const description = normalize(job.description);
    return [
      "ceska republika",
      "czech republic",
      "czechia",
      "cesko",
      "cr",
    ].some((term) => hasTerm(description, term));
  }

  return false;
}

function hasAttendanceContradiction(job: JobDetails): boolean {
  const content = normalize(`${job.title} ${job.description}`);
  return [
    /hybrid\w* (?:rezim|prace|model|spoluprace)/,
    /hybrid (?:work|working|role|position|schedule|model)/,
    /(?:work|working|role|position|schedule|model) is hybrid/,
    /\bon[- ]?site\b/,
    /moznost obcasne prace z domova/,
    /kombinace (?:home office|prace z domova).{0,40}(?:kancelar|pracovist)/,
    /(?:alespon|nejmene|minimalne) \d+.{0,20}(?:dny|dni).{0,20}(?:kancelar|pracovist)/,
    /\d+.{0,10}(?:dny|dni).{0,20}(?:v kancelar|na pracovist)/,
    /(?:jednou|dvakrat|trikrat).{0,15}tydn.{0,20}(?:kancelar|pracovist)/,
    /\d+ days?.{0,20}(?:in the office|on[- ]?site)/,
    /pravideln.{0,20}dochazk.{0,20}(?:kancelar|pracovist)/,
    /regular.{0,20}(?:office|on[- ]?site) attendance/,
  ].some((pattern) => pattern.test(content));
}

export function jobsCzRejectionReason(
  job: JobDetails,
  mode: JobsCzSearchMode,
): JobsCzFilterRejectionReason | null {
  if (mode === "brno") {
    return isBrnoLocation(job.location) ? null : "outside Brno";
  }
  if (mode === "praha") {
    return isPragueLocation(job.location) ? null : "outside Prague";
  }
  if (job.workplaceType !== "REMOTE") {
    return "not marked fully remote";
  }
  if (hasAttendanceContradiction(job)) {
    return "hybrid or on-site attendance required";
  }
  if (!hasCzechLocationEvidence(job)) {
    return "not confirmed available in the Czech Republic";
  }
  return null;
}

export function filterJobsCzJobs(
  jobs: JobDetails[],
  mode: JobsCzSearchMode,
): { accepted: JobDetails[]; rejected: JobsCzFilterRejection[] } {
  const accepted: JobDetails[] = [];
  const rejected: JobsCzFilterRejection[] = [];
  for (const job of jobs) {
    const reason = jobsCzRejectionReason(job, mode);
    if (reason) rejected.push({ job, reason });
    else accepted.push(job);
  }
  return { accepted, rejected };
}

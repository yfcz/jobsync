import { setTimeout as delay } from "node:timers/promises";
import pLimit from "p-limit";
import { APP_CONSTANTS } from "@/lib/constants";
import type { ScraperError, ScraperResult } from "../types";
import { allowedStartupJobsUrl } from "./parser";
import type { StartupJobsSearchCriteria } from "./types";

// Shared across all automations in this process, including redirects. No retries.
const connection = pLimit(1);
let lastRequestAt = 0;

export function robotsAllows(text: string, value: string): boolean {
  if (/<html|<!doctype/i.test(text)) return false;
  const groups: { agents: string[]; rules: { path: string; allow: boolean }[]; delay: number }[] = [];
  let current: (typeof groups)[number] | undefined;
  let hasRules = false;
  for (const line of text.split(/\r?\n/)) {
    const match = line.replace(/#.*$/, "").trim().match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (!current || hasRules) { current = { agents: [], rules: [], delay: 0 }; groups.push(current); hasRules = false; }
      current.agents.push(value.toLowerCase());
    } else if (current && ["allow", "disallow", "crawl-delay"].includes(key)) {
      hasRules = true;
      if (key === "crawl-delay") current.delay = Number(value) || 0;
      else if (value) current.rules.push({ path: value, allow: key === "allow" });
    }
  }
  const specificity = (group: (typeof groups)[number]) => Math.max(0, ...group.agents.filter((a) => a !== "*" && "jobsync".startsWith(a)).map((a) => a.length));
  const longest = Math.max(0, ...groups.map(specificity));
  const applicable = longest ? groups.filter((g) => specificity(g) === longest) : groups.filter((g) => g.agents.includes("*"));
  // Refuse rather than violate a publisher's slower crawl requirement.
  if (applicable.some((g) => g.delay * 1000 > APP_CONSTANTS.STARTUPJOBS_REQUEST_INTERVAL_MS)) return false;
  const target = new URL(value);
  const path = target.pathname + target.search;
  const matches = applicable.flatMap((g) => g.rules).filter((rule) => {
    const pattern = rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    return new RegExp(`^${pattern}`).test(path);
  }).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matches[0]?.allow ?? true;
}

async function readLimited(response: Response): Promise<string> {
  const max = APP_CONSTANTS.STARTUPJOBS_MAX_RESPONSE_BYTES;
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new Error("StartupJobs response exceeds size limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > max) { await reader.cancel(); throw new Error("StartupJobs response exceeds size limit"); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

export async function fetchStartupJobsText(
  url: string,
  parentSignal?: AbortSignal,
  robots?: string,
  criteria?: StartupJobsSearchCriteria,
): Promise<ScraperResult<string>> {
  return connection(async () => {
    const controller = new AbortController();
    const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!allowedStartupJobsUrl(url)) {
        return { success: false, error: { type: "blocked", reason: "StartupJobs URL is not permitted" } };
      }
      const origin = new URL(url).origin;
      const search = new URL(url).pathname === "/api/search-offers";
      if (search !== Boolean(criteria)) {
        return { success: false, error: { type: "parse", message: "StartupJobs search requires a POST search body" } };
      }
      let next = url;
      for (let hop = 0; hop <= 3; hop++) {
        signal.throwIfAborted();
        if (!allowedStartupJobsUrl(next) || (robots !== undefined && !robotsAllows(robots, next))) {
          return { success: false, error: { type: "blocked", reason: "StartupJobs URL or robots.txt does not permit this request" } };
        }
        const wait = Math.max(0, lastRequestAt + APP_CONSTANTS.STARTUPJOBS_REQUEST_INTERVAL_MS - Date.now());
        if (wait) await delay(wait, undefined, { signal });
        lastRequestAt = Date.now();
        timer = setTimeout(() => controller.abort(), APP_CONSTANTS.STARTUPJOBS_FETCH_TIMEOUT_MS);
        const response = await fetch(next, {
          signal,
          redirect: "manual",
          credentials: "omit",
          method: search ? "POST" : "GET",
          ...(criteria ? { body: JSON.stringify(criteria) } : {}),
          headers: {
            "user-agent": "JobSync/1.2 personal job-search automation",
            accept: search
              ? "application/ld+json,application/json"
              : "text/html,application/xhtml+xml,text/plain",
            ...(search ? { "content-type": "application/ld+json" } : {}),
          },
        });
        const cancel = () => response.body?.cancel();
        if (response.status === 429) {
          const raw = response.headers.get("retry-after");
          const numeric = raw ? Number(raw) : NaN;
          const date = raw ? Date.parse(raw) : NaN;
          const retryAfter = Number.isFinite(numeric) ? Math.max(0, numeric) : Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
          await cancel();
          return { success: false, error: { type: "rate_limited", retryAfter } };
        }
        if (response.status === 401 || response.status === 403) {
          await cancel();
          return { success: false, error: { type: "blocked", reason: `StartupJobs returned HTTP ${response.status}; no further requests will be made` } };
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await cancel();
          if (search) {
            return { success: false, error: { type: "blocked", reason: "StartupJobs search POST redirect was refused" } };
          }
          if (!location) throw new Error("StartupJobs redirect has no location");
          next = new URL(location, next).toString();
          if (new URL(next).origin !== origin) {
            return { success: false, error: { type: "blocked", reason: "StartupJobs cross-origin redirect was refused" } };
          }
          clearTimeout(timer);
          continue;
        }
        if (!response.ok) { await cancel(); throw new Error(`StartupJobs returned HTTP ${response.status}`); }
        const type = response.headers.get("content-type");
        const expectedType = search
          ? /^application\/(?:ld\+json|json)(?:;|$)/i
          : /^(?:text\/(?:html|plain)|application\/xhtml\+xml)(?:;|$)/i;
        if (type && !expectedType.test(type)) {
          await cancel();
          return { success: false, error: { type: "parse", message: "Unexpected StartupJobs response content type" } };
        }
        const data = await readLimited(response);
        if (!data.trim()) return { success: false, error: { type: "parse", message: "Empty StartupJobs response" } };
        return { success: true, data };
      }
      throw new Error("StartupJobs redirected too many times");
    } catch (error) {
      if (parentSignal?.aborted) throw error;
      const failure: ScraperError = { type: "network", message: controller.signal.aborted ? "StartupJobs request timed out" : error instanceof Error ? error.message : "StartupJobs request failed" };
      return { success: false, error: failure };
    } finally { if (timer) clearTimeout(timer); }
  });
}

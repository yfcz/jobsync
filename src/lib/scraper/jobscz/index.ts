import pLimit from "p-limit";
import { APP_CONSTANTS } from "@/lib/constants";
import type { ScraperError, ScraperResult } from "../types";
import { parseJobsCzDetailPage, parseJobsCzSearchPage } from "./parser";
import type { JobsCzRunConfig, JobsCzSearchResult } from "./types";

export { parseJobsCzDetailPage, parseJobsCzSearchPage } from "./parser";
export type { JobsCzRunConfig, JobsCzSearchListing } from "./types";

function allowedJobsCzUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "jobs.cz" || url.hostname.endsWith(".jobs.cz"))
    );
  } catch {
    return false;
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(raw);
  return Number.isNaN(date)
    ? undefined
    : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

async function readLimitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declared) &&
    declared > APP_CONSTANTS.JOBSCZ_MAX_HTML_BYTES
  ) {
    response.body?.cancel();
    throw new Error("response exceeds the HTML size limit");
  }

  if (!response.body) {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > APP_CONSTANTS.JOBSCZ_MAX_HTML_BYTES) {
      throw new Error("response exceeds the HTML size limit");
    }
    return body;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > APP_CONSTANTS.JOBSCZ_MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("response exceeds the HTML size limit");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchHtml(
  url: string,
  parentSignal?: AbortSignal,
): Promise<ScraperResult<string>> {
  if (!allowedJobsCzUrl(url)) {
    return {
      success: false,
      error: { type: "blocked", reason: "redirected outside jobs.cz" },
    };
  }

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(),
    APP_CONSTANTS.JOBSCZ_FETCH_TIMEOUT_MS,
  );

  try {
    let currentUrl = url;
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "JobSync/1.2 personal job-search automation",
        },
      });
      if (response.status < 300 || response.status >= 400) break;

      const location = response.headers.get("location");
      response.body?.cancel();
      if (!location) {
        return {
          success: false,
          error: { type: "network", message: "Jobs.cz redirect had no location" },
        };
      }
      const nextUrl = new URL(location, currentUrl).toString();
      if (!allowedJobsCzUrl(nextUrl)) {
        return {
          success: false,
          error: { type: "blocked", reason: "redirected outside jobs.cz" },
        };
      }
      currentUrl = nextUrl;
      response = null;
    }

    if (!response) {
      return {
        success: false,
        error: { type: "network", message: "Jobs.cz redirected too many times" },
      };
    }

    if (response.status === 429) {
      response.body?.cancel();
      return {
        success: false,
        error: {
          type: "rate_limited",
          retryAfter: retryAfterSeconds(response),
        },
      };
    }
    if (response.status === 401 || response.status === 403) {
      response.body?.cancel();
      return {
        success: false,
        error: {
          type: "blocked",
          reason: `Jobs.cz returned ${response.status}`,
        },
      };
    }
    if (!response.ok) {
      response.body?.cancel();
      return {
        success: false,
        error: {
          type: "network",
          message: `Jobs.cz returned ${response.status}`,
        },
      };
    }
    return { success: true, data: await readLimitedText(response) };
  } catch (error) {
    if (parentSignal?.aborted) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: { type: "network", message: "Jobs.cz request timed out" },
      };
    }
    return {
      success: false,
      error: {
        type: "network",
        message: error instanceof Error ? error.message : "Jobs.cz fetch failed",
      },
    };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

export function buildJobsCzSearchUrl(config: JobsCzRunConfig): string {
  const url = new URL(
    APP_CONSTANTS.JOBSCZ_SEARCH_PATH,
    APP_CONSTANTS.JOBSCZ_BASE_URL,
  );
  url.searchParams.set("locality[code]", APP_CONSTANTS.JOBSCZ_LOCATION_CODE);
  url.searchParams.set("locality[label]", APP_CONSTANTS.JOBSCZ_LOCATION_LABEL);
  url.searchParams.set("locality[coords]", APP_CONSTANTS.JOBSCZ_LOCATION_COORDS);
  url.searchParams.set("locality[radius]", "0");
  url.searchParams.set("page", "1");
  for (const query of config.queries) url.searchParams.append("q[]", query);
  return url.toString();
}

function describeError(error: ScraperError): string {
  if (error.type === "blocked") return error.reason;
  if (error.type === "rate_limited") {
    return error.retryAfter
      ? `rate limited; retry after ${error.retryAfter}s`
      : "rate limited";
  }
  return error.message;
}

export async function searchJobsCzJobs(
  config: JobsCzRunConfig,
  signal?: AbortSignal,
): Promise<JobsCzSearchResult> {
  const search = await fetchHtml(buildJobsCzSearchUrl(config), signal);
  if (!search.success) {
    return {
      jobs: [],
      errors: [
        {
          key: "jobs.cz",
          name: "Jobs.cz search",
          reason: describeError(search.error),
          kind: search.error.type,
        },
      ],
      totalScopes: 1,
      skipped: 0,
    };
  }

  const listings = parseJobsCzSearchPage(search.data).slice(0, config.maxResults);
  if (listings.length === 0) {
    return { jobs: [], errors: [], totalScopes: 1, skipped: 0 };
  }

  const limit = pLimit(APP_CONSTANTS.JOBSCZ_DETAIL_CONCURRENCY);
  let stopAfterRateLimit = false;
  let skipped = 0;
  const errors: JobsCzSearchResult["errors"] = [];

  const settled = await Promise.all(
    listings.map((listing) =>
      limit(async () => {
        if (stopAfterRateLimit || signal?.aborted) return null;
        const detail = await fetchHtml(listing.url, signal);
        if (!detail.success) {
          if (detail.error.type === "rate_limited") stopAfterRateLimit = true;
          errors.push({
            key: listing.id,
            name: listing.title,
            reason: describeError(detail.error),
            kind: detail.error.type,
          });
          return null;
        }
        const job = parseJobsCzDetailPage(detail.data, listing);
        if (!job) skipped++;
        return job;
      }),
    ),
  );

  return {
    jobs: settled.filter((job): job is NonNullable<typeof job> => !!job),
    errors,
    totalScopes: 1,
    skipped,
  };
}

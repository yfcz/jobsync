import { setTimeout as delay } from "node:timers/promises";
import pLimit from "p-limit";
import type { ScraperResult } from "../types";
import { robotsAllows } from "../robots";
import { allowedXiteeUrl } from "./urls";

export const XITEE_REQUEST_INTERVAL_MS = 1000;
export const XITEE_TIMEOUT_MS = 15_000;
export const XITEE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// Bound memory and request frequency across concurrent automations. No retries.
const connection = pLimit(1);
let lastRequestAt = 0;
let rateLimitedUntil = 0;

async function readLimited(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > XITEE_MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("xitee response exceeds size limit");
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
      if (bytes > XITEE_MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("xitee response exceeds size limit"); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

export async function fetchXiteeText(url: string, parentSignal?: AbortSignal, robots?: string): Promise<ScraperResult<string>> {
  return connection(async () => {
    const controller = new AbortController();
    const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      signal.throwIfAborted();
      if (!allowedXiteeUrl(url)) return { success: false, error: { type: "blocked", reason: "xitee URL is not permitted" } };
      if (Date.now() < rateLimitedUntil) {
        return { success: false, error: { type: "rate_limited", retryAfter: Math.ceil((rateLimitedUntil - Date.now()) / 1000) } };
      }
      const robotsRequest = /\/robots\.txt\/?$/.test(new URL(url).pathname);
      let next = url;
      for (let hop = 0; hop <= 3; hop++) {
        signal.throwIfAborted();
        if (!allowedXiteeUrl(next) || (robots !== undefined && !robotsAllows(robots, next, XITEE_REQUEST_INTERVAL_MS)) ||
            (robotsRequest !== /\/robots\.txt\/?$/.test(new URL(next).pathname))) {
          return { success: false, error: { type: "blocked", reason: "xitee URL, redirect or robots.txt does not permit this request" } };
        }
        const wait = Math.max(0, lastRequestAt + XITEE_REQUEST_INTERVAL_MS - Date.now());
        if (wait) await delay(wait, undefined, { signal });
        signal.throwIfAborted();
        lastRequestAt = Date.now();
        timer = setTimeout(() => controller.abort(), XITEE_TIMEOUT_MS);
        const response = await fetch(next, {
          signal, redirect: "manual", credentials: "omit",
          headers: { "user-agent": "JobSync/1.2 personal job-search automation", accept: "text/html,text/plain,application/xhtml+xml" },
        });
        const cancel = () => response.body?.cancel();
        if (response.status === 429) {
          const raw = response.headers.get("retry-after");
          const numeric = raw ? Number(raw) : NaN;
          const date = raw ? Date.parse(raw) : NaN;
          const retryAfter = Number.isFinite(numeric) ? Math.max(0, numeric) : Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
          rateLimitedUntil = Date.now() + Math.max(1, retryAfter ?? 60) * 1000;
          await cancel();
          return { success: false, error: { type: "rate_limited", retryAfter } };
        }
        if (response.status === 401 || response.status === 403) {
          await cancel();
          return { success: false, error: { type: "blocked", reason: `xitee returned HTTP ${response.status}; no further requests will be made` } };
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await cancel();
          if (!location) throw new Error("xitee redirect has no location");
          next = new URL(location, next).href;
          clearTimeout(timer);
          continue;
        }
        // RFC 9309: a missing robots file permits public crawling. An HTML
        // error returned with 200 is NOT a robots file and fails closed below.
        if (robotsRequest && [404, 410].includes(response.status)) {
          await cancel();
          return { success: true, data: "" };
        }
        if (!response.ok) { await cancel(); throw new Error(`xitee returned HTTP ${response.status}`); }
        const type = response.headers.get("content-type");
        if (type && !/^(?:text\/(?:html|plain)|application\/xhtml\+xml)(?:;|$)/i.test(type)) {
          await cancel();
          return { success: false, error: { type: "parse", message: "Unexpected xitee response content type" } };
        }
        const data = await readLimited(response);
        if ((!robotsRequest && !data.trim()) || (robotsRequest && /<html|<!doctype/i.test(data))) {
          return { success: false, error: { type: "parse", message: "Empty or invalid xitee response" } };
        }
        return { success: true, data };
      }
      throw new Error("xitee redirected too many times");
    } catch (error) {
      if (parentSignal?.aborted) throw error;
      return { success: false, error: { type: "network", message: controller.signal.aborted ? "xitee request timed out" : error instanceof Error ? error.message : "xitee request failed" } };
    } finally { if (timer) clearTimeout(timer); }
  });
}

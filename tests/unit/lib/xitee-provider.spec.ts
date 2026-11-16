import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseXiteeListing, parseXiteeDetail } from "@/lib/scraper/xitee/parser";
import { canonicalXiteeUrl, allowedXiteeUrl, XITEE_LISTING_URL, XITEE_ORIGIN } from "@/lib/scraper/xitee/urls";
import { searchXiteeJobs } from "@/lib/scraper/xitee";
import { fetchXiteeText, XITEE_MAX_RESPONSE_BYTES, XITEE_TIMEOUT_MS } from "@/lib/scraper/xitee/http";
import { dedupeJobs, jobDedupeKey, jobDedupeKeys } from "@/lib/scraper/utils";
import { robotsAllows } from "@/lib/scraper/robots";
import type { XiteeRunConfig } from "@/lib/scraper/automation-run/config";

vi.mock("node:timers/promises", () => {
  const setTimeout = vi.fn().mockResolvedValue(undefined);
  return { setTimeout, default: { setTimeout } };
});
const fixture = (name: string) => readFileSync(join(process.cwd(), "__tests__/fixtures", `xitee-${name}.html`), "utf8");
const listing = fixture("listing");
const cs = fixture("detail-cs");
const en = fixture("detail-en");
const vacancies = parseXiteeListing(listing);
const config: XiteeRunConfig = { kind: "xitee", targetTitles: [], keywords: [], locations: [], strictLocation: false, topK: 5, saveUnanalyzed: true };
const response = (text: string, status = 200, headers: Record<string, string> = {}) => new Response(text, { status, headers });
const policies = () => vi.fn().mockResolvedValueOnce(response("not found", 404));

describe("xitee captured public HTML", () => {
  let testTime = Date.now();
  beforeEach(() => {
    // Isolate process-wide rate-limit state without exporting test-only reset hooks.
    testTime += 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(testTime);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("discovers all actual vacancy links, independently of titles, queries and navigation", () => {
    expect(vacancies.map((v) => v.title)).toEqual(["Controlling Specialist", "Senior QA Lead / QA Manager"]);
    expect(vacancies.every((v) => v.url.startsWith(XITEE_LISTING_URL))).toBe(true);
    const changed = listing.replaceAll("Controlling Specialist", "Náborář / Recruiter");
    expect(parseXiteeListing(changed)[0].title).toBe("Náborář / Recruiter");
  });

  it("parses Czech responsibilities/requirements without shared content or inferred offices/home-office", () => {
    const job = parseXiteeDetail(cs, vacancies[0]);
    expect(job).toMatchObject({ title: "Controlling Specialist", company: "xitee", sourceId: "1376", employmentType: "FULL_TIME", location: "" });
    expect(job.description).toContain("Projektový controlling");
    expect(job.description).toContain("Co od tebe očekáváme?");
    expect(job.description).toContain("MS Excel");
    expect(job.description).toContain("Pracovní poměr na dobu určitou");
    for (const boilerplate of ["Proč xitee", "Sick days", "Multisport", "Nadpis pro danou aktivitu", "Vyplnit formulář", "Cookie", "Kontaktní údaje"]) expect(job.description).not.toContain(boilerplate);
    expect(job.workplaceType).toBeUndefined();
    expect(job.isRemote).toBeUndefined();
    expect(job.salary).toBeUndefined();
    expect(job.postedDate).toBeUndefined();
    expect(job.applicationUrl).toContain("advId=2001537506");
    expect(job.dedupeUrls).toContain("https://www.jobs.cz/rpd/2001537506/");
  });

  it("preserves English content and explicit hybrid evidence without inferring location/employment", () => {
    const job = parseXiteeDetail(en, vacancies[1]);
    expect(job.description).toContain("Lead and coordinate a team");
    expect(job.description).toContain("Requirements");
    expect(job.description).toContain("Must have");
    expect(job.description).toContain("CI/CD");
    expect(job.description).toContain("Hybrid work from home and from office");
    expect(job.description).not.toContain("Bonus system");
    expect(job.description).not.toContain("Modern offices");
    expect(job).toMatchObject({ workplaceType: "HYBRID", location: "" });
    expect(job.employmentType).toBeUndefined();
    expect(job.isRemote).toBeUndefined();
  });

  it("extracts explicit role metadata, without borrowing anything from surrounding sections", () => {
    const updated = cs.replace("Co bude tvou náplní práce?", "Co bude tvou náplní práce?</h2><p>Location: Ostrava</p><p>Salary: 50 000–70 000 Kč</p><p>Posted: 2026-11-10</p><h2>Responsibilities");
    expect(parseXiteeDetail(updated, vacancies[0])).toMatchObject({ location: "Ostrava", salary: "50 000–70 000 Kč", postedDate: "2026-11-10" });
  });

  it.each([["Hybrid work from home and from office", "Fully remote", "REMOTE"], ["Hybrid work from home and from office", "On-site", "ONSITE"]])("uses role-specific %s -> %s evidence", (from, to, expected) => {
    expect(parseXiteeDetail(en.replace(from, to), vacancies[1]).workplaceType).toBe(expected);
  });

  it("recognizes an empty post loop, while changed/malformed structures fail visibly", () => {
    const empty = listing.replace(/<article\b[\s\S]*?<\/article>/g, "");
    expect(parseXiteeListing(empty)).toEqual([]);
    expect(() => parseXiteeListing(empty.replaceAll("bde-post-loop", "changed-loop"))).toThrow(/structure changed/);
    expect(() => parseXiteeListing(listing.replaceAll("/cs/volna-mista/controlling-specialist/", "/cs/contact/"))).toThrow(/card/);
    expect(() => parseXiteeListing("<html>Access challenge</html>")).toThrow();
    expect(() => parseXiteeDetail(en.replaceAll("bde-rich-text", "changed-description"), vacancies[1])).toThrow(/structure changed/);
    expect(() => parseXiteeDetail("<html>Not found</html>", vacancies[0])).toThrow();
  });

  it("canonicalizes language, query, fragment and slash variants and deduplicates across sources", () => {
    const job = parseXiteeDetail(cs, vacancies[0]);
    const variant = { ...job, url: job.url.replace("/cs/", "/en/") + "?campaign=abc#apply" };
    expect(canonicalXiteeUrl(variant.url)).toBe(job.url);
    expect(dedupeJobs([job, variant], new Set())).toHaveLength(1);
    expect(dedupeJobs([variant], new Set([jobDedupeKey(job)]))).toEqual([]);
    expect(dedupeJobs([job], new Set([jobDedupeKey({ url: "https://www.jobs.cz/rpd/2001537506/?anything=true" })]))).toEqual([]);
    expect(dedupeJobs([job, { ...job, url: `${XITEE_LISTING_URL}another-role/`, sourceId: "999999", dedupeUrls: [] }], new Set())).toHaveLength(2);
  });

  it("uses the publisher post ID for renamed or translated slugs, without title-based deduplication", () => {
    const job = parseXiteeDetail(cs, vacancies[0]);
    const renamed = { ...job, url: `${XITEE_LISTING_URL}prejmenovana-pozice/`, dedupeUrls: [] };
    expect(dedupeJobs([renamed], new Set(jobDedupeKeys(job)))).toEqual([]);
    expect(dedupeJobs([job, { ...renamed, sourceId: "999999" }], new Set())).toHaveLength(2);
  });

  it("does not interpret hybrid technology requirements as a hybrid workplace", () => {
    const updated = en.replace("Hybrid work from home and from office", "Experience with hybrid cloud architectures");
    expect(parseXiteeDetail(updated, vacancies[1]).workplaceType).toBeUndefined();
  });

  it.each(["http://career.xitee.com/cs/volna-mista/role/", "https://career.xitee.com.evil.test/cs/volna-mista/role/", "https://user:secret@career.xitee.com/cs/volna-mista/role/", "https://127.0.0.1/cs/volna-mista/role/", "https://career.xitee.com/cs/volna-mista/role/?url=http://localhost", "https://career.xitee.com/wp-json/"])("refuses unsafe network URLs: %s", (url) => {
    expect(allowedXiteeUrl(url)).toBe(false);
  });

  it("fetches one listing and only its two vacancies, with no application-site requests", async () => {
    const fetchMock = policies().mockResolvedValueOnce(response(listing)).mockResolvedValueOnce(response(cs)).mockResolvedValueOnce(response(en));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchXiteeJobs(config);
    expect(result).toMatchObject({ errors: [], listingCount: 2, fetchedCount: 2 });
    expect(result.jobs).toHaveLength(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${XITEE_ORIGIN}/robots.txt`, XITEE_LISTING_URL, ...vacancies.map((v) => v.url)]);
    expect(fetchMock.mock.calls.every(([, options]) => options.redirect === "manual")).toBe(true);
  });

  it("accepts the observed same-origin robots redirect ending in 404", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response("", 301, { location: "/cs/robots.txt/" })).mockResolvedValueOnce(response("missing", 404));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchXiteeText(`${XITEE_ORIGIN}/robots.txt`)).toEqual({ success: true, data: "" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts an empty successful robots file, while rejecting HTML access challenges", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response("")).mockResolvedValueOnce(response("<html>Access challenge</html>")));
    expect(await fetchXiteeText(`${XITEE_ORIGIN}/robots.txt`)).toEqual({ success: true, data: "" });
    expect(await fetchXiteeText(`${XITEE_ORIGIN}/robots.txt`)).toMatchObject({ success: false, error: { type: "parse" } });
  });

  it("stops on robots directives, including scoped rules and slower crawl delays", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("User-agent: *\nDisallow: /cs/volna-mista/")));
    expect((await searchXiteeJobs(config)).errors[0].kind).toBe("blocked");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(robotsAllows("User-agent: *\nDisallow: /\nUser-agent: JobSync\nAllow: /cs/volna-mista/", XITEE_LISTING_URL, 1000)).toBe(true);
    expect(robotsAllows("User-agent: *\nCrawl-delay: 10", XITEE_LISTING_URL, 1000)).toBe(false);
  });

  it.each([403, 429, 500, 503])("reports HTTP %s and stops on access/rate failures", async (status) => {
    vi.stubGlobal("fetch", policies().mockResolvedValueOnce(response(listing)).mockResolvedValueOnce(response("error", status, { "retry-after": "30" })));
    const result = await searchXiteeJobs(config);
    expect(result.errors[0]).toMatchObject({ name: vacancies[0].title, kind: status === 403 ? "blocked" : status === 429 ? "rate_limited" : "network" });
    expect(result.fetchedCount).toBe(0);
    if (status < 500) expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("honors Retry-After across automations without sleeping or sending another request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("slow down", 429, { "retry-after": "30" })));
    expect(await fetchXiteeText(XITEE_LISTING_URL)).toMatchObject({ success: false, error: { type: "rate_limited", retryAfter: 30 } });
    expect(await fetchXiteeText(XITEE_LISTING_URL)).toMatchObject({ success: false, error: { type: "rate_limited", retryAfter: 30 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retains successful details when a different page cannot be parsed", async () => {
    vi.stubGlobal("fetch", policies().mockResolvedValueOnce(response(listing)).mockResolvedValueOnce(response(cs)).mockResolvedValueOnce(response("changed")));
    const result = await searchXiteeJobs(config);
    expect(result).toMatchObject({ listingCount: 2, fetchedCount: 1 });
    expect(result.jobs).toHaveLength(1);
    expect(result.errors[0].kind).toBe("parse");
    expect(result.rejected![0].name).toBe(vacancies[1].title);
  });

  it("distinguishes empty lists from changed pages", async () => {
    vi.stubGlobal("fetch", policies().mockResolvedValueOnce(response(listing.replace(/<article\b[\s\S]*?<\/article>/g, ""))));
    expect(await searchXiteeJobs(config)).toMatchObject({ listingCount: 0, fetchedCount: 0, errors: [] });
    vi.stubGlobal("fetch", policies().mockResolvedValueOnce(response("<h1>Maintenance</h1>")));
    expect((await searchXiteeJobs(config)).errors[0].kind).toBe("parse");
  });

  it.each(["http://localhost/private", "https://evil.test/role", "/cs/contact/", "/cs/robots.txt/"])("does not follow unsafe or unrelated vacancy redirects (%s)", async (location) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("", 302, { location })));
    expect(await fetchXiteeText(vacancies[0].url)).toMatchObject({ success: false, error: { type: "blocked" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized responses using both content-length and streamed bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("body", 200, { "content-length": String(XITEE_MAX_RESPONSE_BYTES + 1) })));
    expect(await fetchXiteeText(XITEE_LISTING_URL)).toMatchObject({ success: false, error: { message: expect.stringContaining("size limit") } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("a".repeat(XITEE_MAX_RESPONSE_BYTES + 1))));
    expect(await fetchXiteeText(XITEE_LISTING_URL)).toMatchObject({ success: false, error: { message: expect.stringContaining("size limit") } });
  });

  it("times out requests and propagates user cancellation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))));
    const timed = fetchXiteeText(XITEE_LISTING_URL);
    await vi.advanceTimersByTimeAsync(XITEE_TIMEOUT_MS + 1);
    expect(await timed).toMatchObject({ success: false, error: { message: "xitee request timed out" } });
    const controller = new AbortController();
    const cancelled = fetchXiteeText(XITEE_LISTING_URL, controller.signal);
    const rejection = expect(cancelled).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejection;
  });
});

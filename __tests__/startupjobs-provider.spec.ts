import { readFileSync } from "node:fs";
import { join } from "node:path";
import { searchStartupJobs } from "@/lib/scraper/startupjobs";
import { allowedStartupJobsUrl, matchesStartupJobsQueries, parseStartupJobsDetail, parseStartupJobsSearch, parseStartupJobsSitemapIndex } from "@/lib/scraper/startupjobs/parser";
import { startupJobsRejectionReason } from "@/lib/scraper/startupjobs/filter";
import { fetchStartupJobsText, robotsAllows } from "@/lib/scraper/startupjobs/http";
import { dedupeJobs, jobDedupeKey } from "@/lib/scraper/utils";
import type { StartupJobsRunConfig } from "@/lib/scraper/startupjobs/types";

vi.mock("node:timers/promises", async (original) => {
  const actual = await original<typeof import("node:timers/promises")>();
  const setTimeout = vi.fn().mockResolvedValue(undefined);
  return { ...actual, setTimeout, default: { ...actual, setTimeout } };
});

const fixture = (name: string) => readFileSync(join(process.cwd(), "__tests__/fixtures", name), "utf8");
const detail = fixture("startupjobs-detail.html");
const sitemap = fixture("startupjobs-offers.xml");
const index = fixture("startupjobs-sitemap-index.xml");
const robots = fixture("startupjobs-robots.txt");
const listing = { id: "108443", title: "java fintech developer", url: "https://www.startupjobs.cz/nabidka/108443/java-fintech-developer" };
const config: StartupJobsRunConfig = { kind: "startupjobs.cz", queries: ["java", "backend"], searchMode: "brno", targetTitles: ["Java Developer"], keywords: ["Java"], locations: [], strictLocation: false, topK: 5, saveUnanalyzed: true, maxResults: 2 };

// Variants change fields in the captured public Nuxt offer graph, preserving
// the actual devalue layout rather than inventing a different feed schema.
function withOffer(patch: Record<string, unknown>): string {
  const table = JSON.parse(detail.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]);
  const offer = table.find((entry: Record<string, unknown>) => entry && typeof entry === "object" && "createdAt" in entry && "collaborations" in entry);
  function encode(value: unknown): number {
    const i = table.length; table.push(null);
    table[i] = Array.isArray(value) ? value.map(encode) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) : value;
    return i;
  }
  for (const [key, value] of Object.entries(patch)) offer[key] = encode(value);
  return `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(table).replaceAll("<", "\\u003C")}</script>`;
}
const location = (place: string, country = "Česko") => ({ name: { cs: `${place}, ${country}` }, place: { cs: place }, country: { cs: country } });
const response = (body: string, status = 200) => new Response(body, { status });

describe("StartupJobs public data", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("parses captured sitemap search results using OR, newest IDs first", () => {
    expect(parseStartupJobsSitemapIndex(index)).toBe("https://www.startupjobs.cz/sitemap/offers.xml");
    const listings = parseStartupJobsSearch(sitemap, ["java", "backend"]);
    expect(listings).toHaveLength(11);
    expect(listings[0].id).toBe("109091");
    expect(listings).toContainEqual(listing);
    expect(matchesStartupJobsQueries("javascript", ["java"])).toBe(false);
    expect(matchesStartupJobsQueries("Back-end vývojář", ["back end"])).toBe(true);
    expect(parseStartupJobsSearch(sitemap, ["nonexistent"])).toEqual([]);
    expect(() => parseStartupJobsSearch("<html>challenge</html>", ["java"])).toThrow();
    expect(() => parseStartupJobsSearch('<!DOCTYPE xml [<!ENTITY x "x">]><urlset/>', ["java"])).toThrow();
  });

  it("parses a real public detail, preserving structured fields and skills", () => {
    const job = parseStartupJobsDetail(detail, listing);
    expect(job).toMatchObject({ sourceId: "108443", title: "Java Fintech Developer", company: "Luxonit s.r.o.", location: "Brno, Česko", cities: ["Brno"], countries: ["Česko"], workplaceType: "HYBRID", employmentType: "Full-time" });
    expect(job.skills).toContain("Java");
    expect(job.description).toContain("Java (21+)");
    expect(job.description).toContain("Technologies / skills:");
    expect(() => parseStartupJobsDetail(detail, { ...listing, id: "1" })).toThrow(/identity/);
    expect(() => parseStartupJobsDetail("<html>captcha</html>", listing)).toThrow(/missing/);
    expect(() => parseStartupJobsDetail(fixture("startupjobs-expired.html"), { ...listing, id: "106101" })).toThrow(/not published/);
  });

  it.each(["remote", "hybrid", "onsite"])("maps structured %s without treating a homeoffice benefit as remote", (mode) => {
    const job = parseStartupJobsDetail(withOffer({ collaborations: [mode] }), listing);
    expect(job.workplaceType).toBe(mode.toUpperCase());
    expect(job.isRemote).toBe(mode === "remote");
  });

  it("preserves published salary and part time options in existing job data", () => {
    const job = parseStartupJobsDetail(withOffer({ salary: { minimum: 50000, maximum: 80000, currency: "CZK", measure: "monthly" }, shifts: [80] }), listing);
    expect(job.salary).toBe("50000–80000 CZK monthly");
    expect(job.description).toContain("Published salary: 50000–80000 CZK monthly");
    expect(job.employmentType).toBe("Part-time");
  });

  it("parses a captured genuine remote listing with published compensation", () => {
    const job = parseStartupJobsDetail(fixture("startupjobs-remote-salary.html"), { id: "40052", title: "Senior PHP", url: "https://www.startupjobs.cz/nabidka/40052/senior-vyvojar-ka-esales-platformy-php-remote-130-160-000-kc" });
    expect(job.salary).toBe("130000–160000 CZK monthly");
    expect(job.collaborations).toContain("remote");
    expect(job.workplaceType).toBe("REMOTE");
    expect(startupJobsRejectionReason(job, "remote_cz")).toBeNull();
  });

  it.each(["remote", "hybrid", "onsite"])("accepts a structured Brno workplace with %s and multiple locations", (mode) => {
    const job = parseStartupJobsDetail(withOffer({ collaborations: [mode], locations: [location("Praha"), location("Brno")] }), listing);
    expect(startupJobsRejectionReason(job, "brno")).toBeNull();
    expect(startupJobsRejectionReason(job, "praha")).toBeNull();
  });

  it("rejects wrong/unknown city data without trusting the title or description", () => {
    const job = parseStartupJobsDetail(withOffer({ locations: [], name: { cs: "Remote Java Brno Praha" } }), listing);
    expect(startupJobsRejectionReason(job, "brno")).toContain("outside Brno");
    expect(startupJobsRejectionReason(job, "praha")).toContain("outside Prague");
    const outside = parseStartupJobsDetail(withOffer({ locations: [location("Brno-venkov"), location("Praha-východ")] }), listing);
    expect(startupJobsRejectionReason(outside, "brno")).toContain("outside");
    expect(startupJobsRejectionReason(outside, "praha")).toContain("outside");
  });

  it.each(["Brno", "Praha", "Ostrava", "Liberec"])("accepts genuine remote with structured Czech eligibility in %s", (city) => {
    const job = parseStartupJobsDetail(withOffer({ collaborations: ["remote"], locations: [location(city)], description: { cs: "Java development. Work from anywhere in Czechia." } }), listing);
    expect(startupJobsRejectionReason(job, "remote_cz")).toBeNull();
  });

  it("allows explicit remote/office choices while retaining mandatory attendance checks", () => {
    const patch = { collaborations: ["remote", "hybrid", "onsite"], description: { cs: "Java. Remote práce nebo on-site v Praze, je to na tobě." } };
    expect(startupJobsRejectionReason(parseStartupJobsDetail(withOffer(patch), listing), "remote_cz")).toBeNull();
    patch.description.cs += " Required: 2 days in the office every week.";
    expect(startupJobsRejectionReason(parseStartupJobsDetail(withOffer(patch), listing), "remote_cz")).toContain("attendance required");
  });

  it.each([
    { collaborations: ["hybrid"], description: { cs: "Java. Home office benefit." } },
    { collaborations: ["onsite"] },
    { collaborations: ["remote"], description: { cs: "Java. 2 days in the office every week." } },
    { collaborations: ["remote"], locations: [location("Berlin", "Germany")] },
    { collaborations: ["remote"], locations: [], name: { cs: "Remote Czech Java" }, description: { cs: "Java in Czech Republic" } },
  ])("rejects hybrid, attendance requirements and ambiguous geography %#", (patch) => {
    expect(startupJobsRejectionReason(parseStartupJobsDetail(withOffer(patch), listing), "remote_cz")).not.toBeNull();
  });

  it("deduplicates IDs across title/slug changes, tracking, and previous runs", () => {
    const job = parseStartupJobsDetail(detail, listing);
    const edited = { ...job, url: listing.url.replace("java-fintech-developer", "java-developer-new-title") + "?utm_source=test" };
    expect(dedupeJobs([job, edited], new Set())).toHaveLength(1);
    expect(dedupeJobs([edited], new Set([jobDedupeKey(job)]))).toEqual([]);
  });

  it("fetches robots, the published sitemap pair and only the detail cap", async () => {
    const one = `<urlset><url><loc>${listing.url}</loc></url><url><loc>${listing.url}</loc></url></urlset>`;
    const fetchMock = vi.fn().mockResolvedValueOnce(response(robots)).mockResolvedValueOnce(response(index)).mockResolvedValueOnce(response(one)).mockResolvedValueOnce(response(detail));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchStartupJobs({ ...config, maxResults: 1 });
    expect(result.jobs).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.fetchedCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.every(([, options]) => options.redirect === "manual")).toBe(true);
  });

  it.each([403, 429])("stops all detail requests after HTTP %s without retrying", async (status) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(robots)).mockResolvedValueOnce(response(index)).mockResolvedValueOnce(response(sitemap)).mockResolvedValueOnce(new Response("Stop", { status, headers: { "retry-after": "120" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchStartupJobs(config);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.errors[0].kind).toBe(status === 403 ? "blocked" : "rate_limited");
    if (status === 429) expect(result.errors[0].reason).toContain("retry after 120s");
  });

  it("refuses a changed robots policy before fetching sitemaps", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response("User-agent: *\nDisallow: /"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchStartupJobs(config);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.errors[0].kind).toBe("blocked");
    expect(robotsAllows("User-agent: *\nAllow: /\nUser-agent: JobSync\nDisallow: /sitemap/", "https://www.startupjobs.cz/sitemap/offers.xml")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /*\nAllow: /sitemap/offers.xml$", "https://www.startupjobs.cz/sitemap/offers.xml")).toBe(true);
    expect(robotsAllows("User-agent: *\nCrawl-delay: 10", listing.url)).toBe(false);
  });

  it.each(["https://example.com/private", "http://www.startupjobs.cz/sitemap/offers.xml", "https://www.startupjobs.cz:8443/sitemap/offers.xml", "https://user:password@www.startupjobs.cz/sitemap/offers.xml", "https://back.startupjobs.cz/api/offers", "https://www.startupjobs.cz/admin/", "https://www.startupjobs.cz/nabidka/108443/java?secret=x"])("refuses unsafe URL or redirect %s", async (url) => {
    expect(allowedStartupJobsUrl(url)).toBe(false);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: url } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchStartupJobsText(listing.url);
    expect(result.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports malformed pages, empty responses, content types, oversize and network errors", async () => {
    for (const value of [response(""), new Response("{}", { headers: { "content-type": "application/json" } }), new Response("x", { headers: { "content-length": "2000001" } }), response("x".repeat(2000001))]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(value));
      expect((await fetchStartupJobsText(listing.url)).success).toBe(false);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("DNS failure")));
    const result = await fetchStartupJobsText(listing.url);
    expect(result).toMatchObject({ success: false, error: { type: "network", message: "DNS failure" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(robots)).mockResolvedValueOnce(response("<html>challenge</html>")));
    expect((await searchStartupJobs(config)).errors[0].kind).toBe("parse");
  });

  it("times out an unresponsive request and propagates cancellation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))));
    const pending = fetchStartupJobsText(listing.url);
    await vi.advanceTimersByTimeAsync(12001);
    expect(await pending).toMatchObject({ success: false, error: { message: "StartupJobs request timed out" } });
    const controller = new AbortController(); controller.abort();
    await expect(fetchStartupJobsText(listing.url, controller.signal)).rejects.toThrow();
  });
});

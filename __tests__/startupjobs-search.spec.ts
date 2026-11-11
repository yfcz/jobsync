import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allowedStartupJobsUrl, parseStartupJobsSearchPage } from "@/lib/scraper/startupjobs/parser";
import { buildStartupJobsSearchRequest, STARTUPJOBS_SEARCH_ORIGIN } from "@/lib/scraper/startupjobs/search";

const fixture = (name: string) => readFileSync(join(process.cwd(), "__tests__/fixtures", name), "utf8");
const java = fixture("startupjobs-search-brno-java.json");

describe("StartupJobs native portal search", () => {
  it.each([
    ["brno", { query: "java", locations: [{ locationId: "ChIJEVE_wDqUEkcRsLEUZg-vAAQ", radiusKm: 0 }] }],
    ["praha", { query: "java", locations: [{ locationId: "ChIJi3lwCZyTC0cRkEAWZg-vAAQ", radiusKm: 0 }] }],
    ["remote_cz", { query: "java", locationPreferences: ["remote"] }],
  ] as const)("builds the verified %s POST request without inventing web query parameters", (mode, body) => {
    expect(buildStartupJobsSearchRequest(" java ", mode)).toEqual({ url: `${STARTUPJOBS_SEARCH_ORIGIN}/api/search-offers?page=1`, body });
  });

  it("bounds page requests and query length", () => {
    expect(buildStartupJobsSearchRequest("backend", "brno", 2).url).toBe(`${STARTUPJOBS_SEARCH_ORIGIN}/api/search-offers?page=2`);
    for (const page of [0, -1, 1.5, 3, NaN, Infinity]) {
      expect(() => buildStartupJobsSearchRequest("java", "brno", page)).toThrow();
    }
    expect(() => buildStartupJobsSearchRequest(" ", "brno")).toThrow();
    expect(() => buildStartupJobsSearchRequest("x".repeat(101), "brno")).toThrow();
  });

  it.each(["brno-java", "brno-backend", "praha-java", "remote-java", "empty"])("parses the captured %s response", (key) => {
    const raw = fixture(`startupjobs-search-${key}.json`);
    const original = JSON.parse(raw);
    const page = parseStartupJobsSearchPage(raw);
    expect(page.totalItems).toBe(original.totalItems);
    expect(page.listings).toHaveLength(original.member.length);
    expect(page.listings.every((listing) => allowedStartupJobsUrl(listing.url))).toBe(true);
  });

  it("preserves portal ranking and retains matches whose URL has no query term", () => {
    const page = parseStartupJobsSearchPage(java);
    expect(page.listings[0]).toEqual({ id: "108443", title: "Java Fintech Developer", url: "https://www.startupjobs.cz/nabidka/108443/java-fintech-developer" });
    expect(page.listings[1]).toMatchObject({ id: "46096", title: "C# / .NET Desktop UI Developer pro Fintech Platformu" });
    expect(page.listings[1].url).not.toContain("java");
    expect(page.listings[2].id).toBe("109277");
    expect(page.nextPage).toBe(2);
    const second = parseStartupJobsSearchPage(fixture("startupjobs-search-brno-java-page2.json"), 2);
    expect(second.nextPage).toBe(3); // Valid metadata; the caller never fetches beyond its cap.
  });

  it.each([
    "<html>challenge</html>", "not json", "{}",
    '{"@type":"Collection","@id":"/api/search-offers","totalItems":0}',
    '{"@type":"Collection","@id":"/api/search-offers","totalItems":-1,"member":[]}',
    '{"@type":"Collection","@id":"/api/search-offers","totalItems":1.5,"member":[]}',
  ])("rejects invalid responses instead of reporting an empty successful search %#", (raw) => {
    expect(() => parseStartupJobsSearchPage(raw)).toThrow();
  });

  it.each([
    { id: "../private" }, { id: 1.5 }, { slug: { cs: "../private" } },
    { slug: { cs: "https://evil.example/job" } }, { name: {} }, { "@id": "/api/offers/1" },
  ])("rejects invalid offer identities and unsafe slugs %#", (patch) => {
    const value = JSON.parse(java);
    Object.assign(value.member[0], patch);
    expect(() => parseStartupJobsSearchPage(JSON.stringify(value))).toThrow(/listing/);
  });

  it.each([
    "https://evil.example/api/search-offers?page=2", "https://user:password@back.startupjobs.cz/api/search-offers?page=2",
    "https://back.startupjobs.cz:8443/api/search-offers?page=2", "/api/offers?page=2",
    "/api/search-offers?page=1", "/api/search-offers?page=3", "/api/search-offers?page=2&target=private",
  ])("refuses unsafe or non-sequential pagination %s", (next) => {
    const value = JSON.parse(java); value.view.next = next;
    expect(() => parseStartupJobsSearchPage(JSON.stringify(value))).toThrow(/next page/);
  });

  it.each([
    `${STARTUPJOBS_SEARCH_ORIGIN}/api/search-offers?page=0`,
    `${STARTUPJOBS_SEARCH_ORIGIN}/api/search-offers?page=3`,
    `${STARTUPJOBS_SEARCH_ORIGIN}/api/search-offers?page=1&url=https://example.com`,
    `${STARTUPJOBS_SEARCH_ORIGIN}/api/search-offers`,
    `${STARTUPJOBS_SEARCH_ORIGIN}/api/offers/108443`,
    "https://www.startupjobs.cz/sitemap_index.xml",
    "https://www.startupjobs.cz/sitemap/offers.xml",
  ])("keeps the HTTP URL allowlist narrow: %s", (url) => {
    expect(allowedStartupJobsUrl(url)).toBe(false);
  });
});

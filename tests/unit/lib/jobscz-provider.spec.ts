import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildJobsCzSearchUrl,
  parseJobsCzDetailPage,
  parseJobsCzSearchPage,
  searchJobsCzJobs,
  type JobsCzRunConfig,
} from "@/lib/scraper/jobscz";

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "__tests__", "fixtures", name), "utf8");

const searchHtml = fixture("jobscz-search.html");
const detailHtml = fixture("jobscz-detail.html");
const loaderHtml = fixture("jobscz-loader.html");

const config: JobsCzRunConfig = {
  kind: "jobs.cz",
  searchMode: "brno",
  queries: ["java", "backend"],
  targetTitles: ["Java Developer", "Backend Developer"],
  keywords: ["Java", "Spring"],
  locations: ["Brno"],
  strictLocation: true,
  topK: 5,
  saveUnanalyzed: true,
  maxResults: 2,
};

describe("Jobs.cz HTML provider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds one bounded Brno search with repeated query parameters", () => {
    const url = new URL(buildJobsCzSearchUrl(config));
    expect(url.origin).toBe("https://www.jobs.cz");
    expect(url.pathname).toBe("/prace/brno/");
    expect(url.searchParams.get("locality[label]")).toBe("Brno");
    expect(url.searchParams.get("locality[radius]")).toBe("0");
    expect(url.searchParams.getAll("q[]")).toEqual(["java", "backend"]);
    expect(url.searchParams.get("page")).toBe("1");
  });

  it("builds the verified Prague locality search", () => {
    const url = new URL(
      buildJobsCzSearchUrl({ ...config, searchMode: "praha" }),
    );
    expect(url.pathname).toBe("/prace/praha/");
    expect(url.searchParams.get("locality[code]")).toBe("R200000");
    expect(url.searchParams.get("locality[label]")).toBe("Praha");
    expect(url.searchParams.get("locality[coords]")).toBe(
      "50.08455,14.41778",
    );
    expect(url.searchParams.get("locality[radius]")).toBe("0");
  });

  it("builds a nationwide search with the native remote-work filter", () => {
    const url = new URL(
      buildJobsCzSearchUrl({ ...config, searchMode: "remote_cz" }),
    );
    expect(url.pathname).toBe("/prace/");
    expect(url.searchParams.get("arrangement")).toBe(
      "work-mostly-from-home",
    );
    expect(url.searchParams.has("locality[code]")).toBe(false);
    expect(url.searchParams.getAll("q[]")).toEqual(["java", "backend"]);
  });

  it("parses result cards and normalizes their public canonical URLs", () => {
    expect(parseJobsCzSearchPage(searchHtml)).toEqual([
      {
        id: "2000000001",
        title: "Java Backend Developer",
        company: "Example Systems",
        location: "Brno – střed",
        url: "https://www.jobs.cz/rpd/2000000001/",
      },
      {
        id: "2000000002",
        title: "Backend Engineer",
        company: "Second Company",
        location: "Brno",
        url: "https://www.jobs.cz/rpd/2000000002/",
      },
    ]);
  });

  it("captures the structured remote-work label from result cards", () => {
    const remoteHtml = searchHtml.replace(
      '<span data-test="serp-locality">Brno – střed</span>',
      '<span data-test="serp-locality">Brno – střed</span><span>Práce převážně z domova</span>',
    );
    expect(parseJobsCzSearchPage(remoteHtml)[0].workplaceType).toBe("REMOTE");
  });

  it("converts a server-rendered detail into internal JobDetails", () => {
    const listing = parseJobsCzSearchPage(searchHtml)[0];
    const job = parseJobsCzDetailPage(detailHtml, listing);
    expect(job).toMatchObject({
      title: "Java Backend Developer",
      company: "Example Systems",
      location: "Brno – střed",
      url: "https://www.jobs.cz/rpd/2000000001/",
      postedDate: "2026-11-05",
      salary: "80 000–110 000 Kč",
      employmentType: "Full-time",
      workplaceType: "HYBRID",
    });
    expect(job?.description).toContain("Spring Boot");
  });

  it("uses structured workplace data rather than description claims", () => {
    const listing = parseJobsCzSearchPage(searchHtml)[0];
    const unstructuredRemoteHtml = detailHtml
      .replace(
        '<div data-test="jd-info-item">Možnost občasné práce z domova</div>',
        "",
      )
      .replace("</p>", " Fully remote and home office benefit.</p>");

    expect(
      parseJobsCzDetailPage(unstructuredRemoteHtml, listing)?.workplaceType,
    ).toBeUndefined();
  });

  it("skips JavaScript-only career pages instead of calling private APIs", () => {
    const listing = parseJobsCzSearchPage(searchHtml)[0];
    expect(parseJobsCzDetailPage(loaderHtml, listing)).toBeNull();
  });

  it("fetches one search and only the configured number of public details", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(searchHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(detailHtml, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchJobsCzJobs({ ...config, maxResults: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.jobs).toHaveLength(1);
    expect(result.fetchedCount).toBe(1);
    expect(result.rejected).toEqual([]);
    expect(result.jobs[0].title).toBe("Java Backend Developer");
    expect(result.errors).toEqual([]);
  });

  it("respects HTTP 429 and does not attempt any detail requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Slow down", {
        status: 429,
        headers: { "retry-after": "120" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchJobsCzJobs(config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.jobs).toEqual([]);
    expect(result.errors[0].reason).toContain("retry after 120s");
  });

  it("does not follow a redirect outside the jobs.cz host family", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(searchHtml, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/private-api" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchJobsCzJobs({ ...config, maxResults: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.jobs).toEqual([]);
    expect(result.errors[0]).toMatchObject({ kind: "blocked" });
  });
});

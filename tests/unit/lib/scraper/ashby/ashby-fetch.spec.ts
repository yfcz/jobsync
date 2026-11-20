import { fetchAshbyBoardJobs, searchAshbyJobs } from "@/lib/scraper/ashby";
import { mapAshbyJob } from "@/lib/scraper/ashby/mapper";
import type { AshbyJob } from "@/lib/scraper/ashby/types";
import { APP_CONSTANTS } from "@/lib/constants";
import e2bBoard from "./fixtures/e2b-board.json";

function posting(overrides: Partial<AshbyJob> = {}): AshbyJob {
  return {
    id: "job-1",
    title: "Backend Engineer",
    jobUrl: "https://jobs.ashbyhq.com/acme/job-1",
    ...overrides,
  };
}

describe("mapAshbyJob", () => {
  it("carries the company name from the caller (absent in the payload)", () => {
    expect(mapAshbyJob(posting(), "Acme").company).toBe("Acme");
  });

  it("trims the leading whitespace Ashby ships on some titles", () => {
    const job = mapAshbyJob(posting({ title: " Security Engineer" }), "Acme");
    expect(job.title).toBe("Security Engineer");
  });

  it("joins the primary and secondary locations, deduped", () => {
    const job = mapAshbyJob(
      posting({
        location: "New York, NY",
        secondaryLocations: [
          { location: "Remote (US)" },
          { location: "New York, NY" },
          {},
        ],
      }),
      "Acme",
    );
    expect(job.location).toBe("New York, NY, Remote (US)");
  });

  it("prefers descriptionHtml and does not decode it", () => {
    const job = mapAshbyJob(
      posting({
        descriptionHtml: "<p>Build &amp; ship</p>",
        descriptionPlain: "Build & ship",
      }),
      "Acme",
    );
    expect(job.description).toBe("<p>Build &amp; ship</p>");
  });

  it("falls back to descriptionPlain when the HTML body is empty", () => {
    const job = mapAshbyJob(
      posting({ descriptionHtml: "", descriptionPlain: "Plain body" }),
      "Acme",
    );
    expect(job.description).toBe("Plain body");
  });

  it("maps workplaceType, including OnSite (no hyphen, unlike Lever)", () => {
    expect(mapAshbyJob(posting({ workplaceType: "Remote" }), "A").workplaceType).toBe("REMOTE");
    expect(mapAshbyJob(posting({ workplaceType: "Hybrid" }), "A").workplaceType).toBe("HYBRID");
    expect(mapAshbyJob(posting({ workplaceType: "OnSite" }), "A").workplaceType).toBe("ONSITE");
  });

  it("leaves workplaceType undefined for an unknown value", () => {
    const job = mapAshbyJob(posting({ workplaceType: "Flexible" }), "Acme");
    expect(job.workplaceType).toBeUndefined();
  });

  it("passes publishedAt through as the ISO postedDate", () => {
    const job = mapAshbyJob(
      posting({ publishedAt: "2026-04-07T17:12:35.753+00:00" }),
      "Acme",
    );
    expect(job.postedDate).toBe("2026-04-07T17:12:35.753+00:00");
  });

  it("passes employmentType through untouched for normalizeJobType", () => {
    const job = mapAshbyJob(posting({ employmentType: "Temporary" }), "Acme");
    expect(job.employmentType).toBe("Temporary");
  });

  // Ashby sets isRemote on hybrid/on-site postings that merely offer a remote
  // office, so mapping it would mislabel them REMOTE downstream.
  it("does not carry isRemote", () => {
    const job = mapAshbyJob(
      { ...posting({ workplaceType: "Hybrid" }), isRemote: true } as AshbyJob,
      "Acme",
    );
    expect(job.isRemote).toBeUndefined();
    expect(job.workplaceType).toBe("HYBRID");
  });
});

function okJson(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("fetchAshbyBoardJobs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fetches the whole board in one call (no pagination)", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(okJson({ jobs: [posting(), posting({ id: "job-2" })] }));

    const result = await fetchAshbyBoardJobs("Acme", "acme");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true",
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(2);
    expect(result.data[0].company).toBe("Acme");
  });

  it("drops postings flagged isListed: false", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({
        jobs: [posting({ isListed: true }), posting({ id: "j2", isListed: false })],
      }),
    );

    const result = await fetchAshbyBoardJobs("Acme", "acme");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
  });

  it("loads captured E2B descriptions, salary, identity and application metadata in one request", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(okJson(e2bBoard));
    const result = await fetchAshbyBoardJobs("E2B", "e2b");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const platform = result.data.find((job) => job.title === "Platform Engineer")!;
    const raw = e2bBoard.jobs.find((job) => job.title === platform.title)!;
    expect(platform).toMatchObject({
      company: "E2B", sourceId: raw.id, url: raw.jobUrl,
      applicationUrl: raw.applyUrl, postedDate: raw.publishedAt,
      description: raw.descriptionHtml, location: "Prague, Czech Republic",
      employmentType: "FullTime", workplaceType: "ONSITE",
      salary: "CZK 150,000 – 300,000 / month",
    });
    expect(platform.description.length).toBeGreaterThan(4000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("accepts a genuinely empty board", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({ jobs: [] }));
    expect(await fetchAshbyBoardJobs("E2B", "e2b")).toEqual({ success: true, data: [] });
  });

  it.each([null, {}, [], { jobs: null }, { jobs: [null] }, { jobs: [{}] }])(
    "reports malformed payload %j instead of an empty success", async (body) => {
      vi.spyOn(global, "fetch").mockResolvedValue(okJson(body));
      expect(await fetchAshbyBoardJobs("E2B", "e2b")).toMatchObject({
        success: false, error: { type: "parse", message: expect.stringContaining("e2b") },
      });
    },
  );

  it("identifies invalid JSON as a parse error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("<html>Access denied</html>"));
    expect(await fetchAshbyBoardJobs("E2B", "e2b")).toMatchObject({
      success: false, error: { type: "parse", message: expect.stringContaining("invalid JSON") },
    });
  });

  it.each([403, 500])("reports HTTP %i with the board name", async (status) => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson(null, status));
    expect(await fetchAshbyBoardJobs("E2B", "e2b")).toMatchObject({
      success: false, error: { type: "network", message: `Board 'e2b' returned ${status}` },
    });
  });

  it("returns a network error naming the token on 404", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson(null, 404));

    const result = await fetchAshbyBoardJobs("Acme", "nope");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe("network");
    expect(result.error).toMatchObject({ message: expect.stringContaining("nope") });
  });

  it("maps 429 to rate_limited, not a generic network error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson(null, 429));

    const result = await fetchAshbyBoardJobs("Acme", "acme");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe("rate_limited");
  });

  it("returns a parse error when jobs is not an array", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({ jobs: "nope" }));

    const result = await fetchAshbyBoardJobs("Acme", "acme");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe("parse");
  });

  it("reports a timeout as a network error", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.spyOn(global, "fetch").mockRejectedValue(abort);

    const result = await fetchAshbyBoardJobs("Acme", "acme");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ message: expect.stringContaining("timed out") });
  });

  it("aborts a pending request at the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(global, "fetch").mockImplementation((_, options) => new Promise((_, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")));
      }));
      const request = fetchAshbyBoardJobs("E2B", "e2b");
      await vi.advanceTimersByTimeAsync(APP_CONSTANTS.ASHBY_FETCH_TIMEOUT_MS);
      expect(await request).toMatchObject({ success: false, error: { message: "Board 'e2b' timed out" } });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("searchAshbyJobs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("isolates a failing board: good jobs returned, bad token recorded", async () => {
    vi.spyOn(global, "fetch").mockImplementation((input) =>
      Promise.resolve(
        new URL(String(input)).pathname.endsWith("/bad")
          ? okJson(null, 404)
          : okJson({ jobs: [posting()] }),
      ),
    );

    const { jobs, errors } = await searchAshbyJobs([
      { name: "Good", token: "good" },
      { name: "Bad", token: "bad" },
    ]);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].company).toBe("Good");
    expect(errors).toEqual([{ token: "bad", reason: expect.stringContaining("bad") }]);
  });
});

import { PrismaClient } from "@/generated/prisma/client";

const prisma = new PrismaClient({} as never);

vi.mock("@/generated/prisma/client", () => {
  const m = {
    automationRun: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    automation: { findUnique: vi.fn(), update: vi.fn() },
    resume: { findUnique: vi.fn() },
    userSettings: { findUnique: vi.fn() },
    job: { findMany: vi.fn(), create: vi.fn() },
    jobTitle: { findUnique: vi.fn(), create: vi.fn() },
    location: { findUnique: vi.fn(), create: vi.fn() },
    company: { findUnique: vi.fn(), create: vi.fn() },
    jobSource: { findUnique: vi.fn(), create: vi.fn() },
    jobStatus: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    jobStage: { create: vi.fn() },
    jobStageType: {
      findUnique: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    aiCall: { create: vi.fn() },
  };
  return {
    PrismaClient: vi.fn(function () {
      return m;
    }),
  };
});

vi.mock("@/lib/scraper/greenhouse", () => ({
  searchGreenhouseJobs: vi.fn(),
}));

vi.mock("@/lib/scraper/lever", () => ({
  searchLeverJobs: vi.fn(),
}));

vi.mock("@/lib/scraper/jobscz", () => ({
  searchJobsCzJobs: vi.fn(),
}));
vi.mock("@/lib/scraper/startupjobs", () => ({ searchStartupJobs: vi.fn() }));
vi.mock("@/lib/scraper/xitee", () => ({ searchXiteeJobs: vi.fn() }));

vi.mock("@/lib/api-key-resolver", () => ({
  resolveApiKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ai/provider-registry.server", () => ({
  PROVIDER_VERIFIERS: { ollama: vi.fn().mockResolvedValue({ success: true }) },
}));

vi.mock("ai", () => ({ generateText: vi.fn() }));

vi.mock("@/lib/notifications/record", () => ({
  recordRunNotifications: vi.fn(),
}));

vi.mock("@/lib/ai", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, getModel: vi.fn().mockResolvedValue({}) };
});

import { runAutomation } from "@/lib/scraper/runner";
import { searchGreenhouseJobs } from "@/lib/scraper/greenhouse";
import { searchLeverJobs } from "@/lib/scraper/lever";
import { searchJobsCzJobs } from "@/lib/scraper/jobscz";
import { searchStartupJobs } from "@/lib/scraper/startupjobs";
import { searchXiteeJobs } from "@/lib/scraper/xitee";
import { parseXiteeDetail, parseXiteeListing } from "@/lib/scraper/xitee/parser";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { automationLogger } from "@/lib/automation-logger";
import { generateText } from "ai";
import { recordRunNotifications } from "@/lib/notifications/record";
import type { Automation } from "@/models/automation.model";

function makeJob(title: string, description = "", extra = {}) {
  return {
    title,
    company: "Acme",
    location: "Remote",
    description,
    url: `https://jobs.lever.co/acme/${Math.random()}`,
    postedDate: "2026-06-01T00:00:00Z",
    ...extra,
  };
}

const leverAutomation: Automation = {
  id: "auto-lever",
  userId: "user1",
  name: "Lever",
  jobBoard: "lever",
  keywords: "",
  location: "",
  sourceConfig: JSON.stringify({
    lever: {
      companies: [{ name: "Acme", token: "acme", host: "eu" }],
      targetTitles: ["Frontend Engineer"],
      keywords: [],
      locations: [],
      strictLocation: false,
    },
  }),
  resumeId: "resume1",
  matchThreshold: 80,
  scheduleHour: 8,
  nextRunAt: null,
  lastRunAt: null,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("runAutomation (lever)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (prisma.automationRun.create as any).mockResolvedValue({ id: "run1" });
    (prisma.automationRun.update as any).mockResolvedValue({
      id: "run1",
      automationId: "auto-lever",
    });
    (prisma.automation.findUnique as any).mockResolvedValue({ scheduleHour: 8 });
    (prisma.automation.update as any).mockResolvedValue({});
    (prisma.userSettings.findUnique as any).mockResolvedValue(null);
    (prisma.resume.findUnique as any).mockResolvedValue({
      id: "resume1",
      title: "My Resume",
      ContactInfo: null,
      ResumeSections: [],
    });
    (prisma.job.findMany as any).mockResolvedValue([]);
    (prisma.job.create as any).mockResolvedValue({});
    (prisma.jobTitle.findUnique as any).mockResolvedValue({ id: "jt" });
    (prisma.location.findUnique as any).mockResolvedValue({ id: "loc" });
    (prisma.company.findUnique as any).mockResolvedValue({ id: "co" });
    (prisma.jobSource.findUnique as any).mockResolvedValue({ id: "src" });
    (prisma.jobStatus.findFirst as any).mockResolvedValue({ id: "st" });
    // Every saved job now gets its first current stage, which resolves the
    // status-named stage type through the same Prisma mock.
    (prisma.jobStatus.findUnique as any).mockResolvedValue({
      id: "st",
      label: "New",
    });
    (prisma.jobStageType.findUnique as any).mockResolvedValue({
      id: "stage-type-new",
      label: "New",
    });
    (prisma.jobStage.create as any).mockResolvedValue({ id: "stage-1" });

    (generateText as any).mockResolvedValue({
      text: "SCORES: match=90 recommendation=strong match\n\n## Summary\nGreat fit",
    });
  });

  const startupAutomation: Automation = {
    ...leverAutomation, id: "auto-startupjobs", jobBoard: "startupjobs.cz",
    sourceConfig: JSON.stringify({ "startupjobs.cz": { queries: ["java", "backend"], searchMode: "brno", targetTitles: ["Java Developer"], keywords: ["Java", "Spring"], topK: 5 } }),
  };

  const xiteeAutomation: Automation = {
    ...leverAutomation, id: "auto-xitee", jobBoard: "xitee", name: "xitee Careers",
    sourceConfig: JSON.stringify({ xitee: {} }),
  };
  const xiteeFixture = (name: string) => readFileSync(join(process.cwd(), "__tests__/fixtures", `xitee-${name}.html`), "utf8");
  const xiteeListing = parseXiteeListing(xiteeFixture("listing"));
  const xiteeJob = parseXiteeDetail(xiteeFixture("detail-en"), xiteeListing[1]);

  it("matches captured xitee descriptions against selected CV skills with empty targeting, persists metadata and deduplicates subsequent runs", async () => {
    vi.mocked(prisma.resume.findUnique).mockResolvedValue({ id: "resume1", title: "QA CV", ContactInfo: null, ResumeSections: [{ sectionType: "skills", skills: [{ order: 0, Tag: { id: "testing", label: "testing" } }] }] } as never);
    vi.mocked(searchXiteeJobs).mockResolvedValue({ jobs: [xiteeJob], errors: [], totalScopes: 1, listingCount: 2, fetchedCount: 1 });
    const first = await runAutomation(xiteeAutomation);
    expect(first).toMatchObject({ status: "completed", jobsProcessed: 1, jobsSaved: 1 });
    expect(vi.mocked(generateText).mock.calls[0][0].prompt).toContain("Lead and coordinate a team");
    expect(vi.mocked(generateText).mock.calls[0][0].prompt).toContain("QA CV");
    const data = vi.mocked(prisma.job.create).mock.calls[0][0].data;
    expect(data).toMatchObject({ jobUrl: xiteeJob.url.replace(/\/$/, ""), workplaceType: "HYBRID", locationId: null, jobType: "", matchScore: 90 });
    const metadata = JSON.parse(data.matchData as string);
    expect(metadata).toMatchObject({ analyzed: true, resumeId: "resume1", applicationUrl: xiteeJob.applicationUrl, dedupeUrls: xiteeJob.dedupeUrls });
    expect(JSON.parse(first.funnelStats!)).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "listing", count: 2 }), expect.objectContaining({ key: "fetched", count: 1 }),
      expect.objectContaining({ key: "submitted", count: 1 }), expect.objectContaining({ key: "saved", count: 1 }),
    ]));
    vi.mocked(prisma.job.findMany).mockResolvedValue([{ id: "saved", jobUrl: data.jobUrl, matchData: data.matchData, JobTitle: { label: xiteeJob.title }, Company: { label: "xitee" } }] as never);
    vi.mocked(prisma.job.create).mockClear(); vi.mocked(generateText).mockClear();
    const second = await runAutomation(xiteeAutomation);
    expect(second.jobsSaved).toBe(0);
    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("skips an xitee vacancy already imported through its exact Jobs.cz advert ID", async () => {
    vi.mocked(searchXiteeJobs).mockResolvedValue({ jobs: [xiteeJob], errors: [], totalScopes: 1, listingCount: 1, fetchedCount: 1 });
    vi.mocked(prisma.job.findMany).mockResolvedValue([{ id: "saved-on-jobs-cz", jobUrl: "https://www.jobs.cz/rpd/2001487251/?tracking=abc", JobTitle: { label: "Different localized title" }, Company: { label: "xitee s.r.o." } }] as never);
    const run = await runAutomation(xiteeAutomation);
    expect(run.jobsSaved).toBe(0);
    expect(JSON.parse(run.funnelStats!).find((stage: { key: string }) => stage.key === "duplicates").details[0].reason).toContain("earlier run or source");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("retains xitee aliases so a later Jobs.cz run also skips the vacancy", async () => {
    vi.mocked(prisma.job.findMany).mockResolvedValue([{ id: "saved-xitee", jobUrl: xiteeJob.url, matchData: JSON.stringify({ dedupeUrls: xiteeJob.dedupeUrls }), JobTitle: { label: xiteeJob.title }, Company: { label: "xitee" } }] as never);
    vi.mocked(searchJobsCzJobs).mockResolvedValue({ jobs: [{ ...xiteeJob, dedupeUrls: undefined, url: "https://www.jobs.cz/rpd/2001487251/" }], errors: [], totalScopes: 1, skipped: 0, fetchedCount: 1, rejected: [] });
    const run = await runAutomation({ ...xiteeAutomation, jobBoard: "jobs.cz", sourceConfig: JSON.stringify({ "jobs.cz": { queries: ["qa"], searchMode: "praha" } }) });
    expect(run.jobsSaved).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("keeps named xitee pre-ranking and threshold rejections, including strict locations", async () => {
    const preferences = { xitee: { targetTitles: ["QA Lead"], keywords: ["testing"], locations: ["Brno"], strictLocation: true } };
    vi.mocked(searchXiteeJobs).mockResolvedValue({ jobs: [xiteeJob, { ...xiteeJob, title: "QA local", url: xiteeJob.url + "local", location: "Brno", dedupeUrls: [] }], errors: [], totalScopes: 1 });
    vi.mocked(generateText).mockResolvedValue({ text: "SCORES: match=40 recommendation=weak match\n\n## Summary\nThin fit" } as never);
    const run = await runAutomation({ ...xiteeAutomation, sourceConfig: JSON.stringify(preferences) });
    expect(run.jobsSaved).toBe(0);
    expect(JSON.parse(run.funnelStats!)).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "pre_ai_rejected", details: [expect.objectContaining({ name: xiteeJob.title, reason: expect.stringContaining("location") })] }),
      expect.objectContaining({ key: "below_threshold", count: 1 }),
    ]));
  });

  it.each(["blocked", "rate_limited", "parse", "network"] as const)("reports xitee %s failures without writing historical jobs", async (kind) => {
    vi.mocked(searchXiteeJobs).mockResolvedValue({ jobs: [], errors: [{ key: "listing", name: "xitee", reason: "cannot read listing", kind }], totalScopes: 1, listingCount: 0, fetchedCount: 0 });
    const run = await runAutomation(xiteeAutomation);
    expect(run.status).toBe(kind === "blocked" || kind === "rate_limited" ? kind : "failed");
    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(run.errorMessage).toContain("cannot read listing");
  });

  it("completes an empty xitee listing without modifying saved jobs or AI history", async () => {
    vi.mocked(searchXiteeJobs).mockResolvedValue({ jobs: [], errors: [], totalScopes: 1, listingCount: 0, fetchedCount: 0 });
    const run = await runAutomation(xiteeAutomation);
    expect(run).toMatchObject({ status: "completed", jobsSaved: 0 });
    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("runs StartupJobs through AI, persistence, diagnostics and inter-run dedup", async () => {
    const url = "https://www.startupjobs.cz/nabidka/108443/java-developer";
    const job = makeJob("Java Developer", "Java Spring backend", { sourceId: "108443", location: "Brno", workplaceType: "HYBRID", url });
    vi.mocked(searchStartupJobs).mockResolvedValue({ jobs: [job, job], errors: [], totalScopes: 1, fetchedCount: 3, rejected: [{ key: "123", name: "Java Prague", reason: "outside Brno", category: "location" }] });
    const first = await runAutomation(startupAutomation);
    expect(first).toMatchObject({ status: "completed", jobsSearched: 3, jobsProcessed: 1, jobsSaved: 1 });
    const data = vi.mocked(prisma.job.create).mock.calls[0][0].data;
    expect(data.workplaceType).toBe("HYBRID");
    expect(JSON.parse(data.matchData as string).sourceId).toBe("108443");
    const stages = JSON.parse(first.funnelStats!);
    expect(stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "duplicates", count: 1 }), expect.objectContaining({ key: "location_rejected", count: 1 }), expect.objectContaining({ key: "analyzed", count: 1 }), expect.objectContaining({ key: "saved", count: 1 }),
    ]));
    expect(automationLogger.getLogs(startupAutomation.id).some((entry) => entry.message.includes("[123]: outside Brno"))).toBe(true);
    vi.mocked(prisma.job.findMany).mockResolvedValue([{ id: "existing", jobUrl: url.replace("java-developer", "old-title"), JobTitle: { label: "Java Developer" }, Company: { label: "Acme" }, Location: { label: "Brno" } }] as never);
    vi.mocked(prisma.job.create).mockClear(); vi.mocked(generateText).mockClear();
    const second = await runAutomation(startupAutomation);
    expect(second.jobsSaved).toBe(0);
    expect(JSON.parse(second.funnelStats!).find((stage: { key: string }) => stage.key === "duplicates").count).toBe(2);
    expect(prisma.job.create).not.toHaveBeenCalled(); expect(generateText).not.toHaveBeenCalled();
  });

  it("keeps StartupJobs rejection identities and counts for prefilter and low AI scores", async () => {
    vi.mocked(searchStartupJobs).mockResolvedValue({ jobs: [makeJob("Java Developer", "Java Spring", { sourceId: "1" }), makeJob("Accountant", "Payroll", { sourceId: "2" })], errors: [], totalScopes: 1 });
    vi.mocked(generateText).mockResolvedValue({ text: "SCORES: match=40 recommendation=weak match\n\n## Summary\nThin fit" } as never);
    const run = await runAutomation(startupAutomation);
    const stages = JSON.parse(run.funnelStats!);
    expect(stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "pre_ai_rejected", count: 1, details: [expect.objectContaining({ key: "2", name: "Accountant" })] }),
      expect.objectContaining({ key: "below_threshold", count: 1, details: [expect.objectContaining({ key: "1", name: "Java Developer", reason: "AI score 40% below threshold 80%" })] }),
    ]));
    expect(run.jobsSaved).toBe(0);
  });

  it.each(["blocked", "rate_limited"] as const)("records StartupJobs %s in shared Run History", async (kind) => {
    vi.mocked(searchStartupJobs).mockResolvedValue({ jobs: [], errors: [{ key: "robots", name: "StartupJobs", reason: "access refused", kind }], totalScopes: 1 });
    expect((await runAutomation(startupAutomation)).status).toBe(kind);
    expect(generateText).not.toHaveBeenCalled();
  });

  it.each([true, false])("honors the StartupJobs AI budget and saving additional listings (%s)", async (saveUnanalyzed) => {
    const source = JSON.parse(startupAutomation.sourceConfig!);
    Object.assign(source["startupjobs.cz"], { topK: 1, saveUnanalyzed });
    const jobs = [1, 2].map((id) => makeJob("Java Developer", "Java Spring", { sourceId: String(id), url: `https://www.startupjobs.cz/nabidka/${id}/java-developer` }));
    vi.mocked(searchStartupJobs).mockResolvedValue({ jobs, errors: [], totalScopes: 1 });
    const run = await runAutomation({ ...startupAutomation, sourceConfig: JSON.stringify(source) });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(run.jobsSaved).toBe(saveUnanalyzed ? 2 : 1);
    const stages = JSON.parse(run.funnelStats!);
    expect(stages.find((stage: { key: string }) => stage.key === "pre_ai_rejected").count).toBe(saveUnanalyzed ? 0 : 1);
  });

  it("dispatches to the Lever provider (reads the lever config key), not Greenhouse", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });

    const result = await runAutomation(leverAutomation);

    expect(result.status).toBe("completed");
    expect((searchLeverJobs as any).mock.calls.length).toBe(1);
    expect((searchGreenhouseJobs as any).mock.calls.length).toBe(0);
    // The lever config's companies (with host) are passed through.
    expect((searchLeverJobs as any).mock.calls[0][0]).toEqual([
      { name: "Acme", token: "acme", host: "eu" },
    ]);
    expect(result.jobsSaved).toBe(1);
  });

  it("does not save an analyzed job scoring below the match threshold", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });
    (generateText as any).mockResolvedValue({
      text: "SCORES: match=40 recommendation=weak match\n\n## Summary\nThin fit",
    });

    const result = await runAutomation(leverAutomation);

    expect(result.status).toBe("completed");
    expect(result.jobsProcessed).toBe(1); // analyzed
    expect(result.jobsMatched).toBe(0);
    expect(result.jobsSaved).toBe(0);
    expect((prisma.job.create as any).mock.calls.length).toBe(0);
  });

  it("persists Lever's workplaceType through to the job record", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React", { workplaceType: "HYBRID" })],
      errors: [],
    });

    await runAutomation(leverAutomation);

    const createArg = (prisma.job.create as any).mock.calls[0][0];
    expect(createArg.data.workplaceType).toBe("HYBRID");
  });

  it("fails cleanly with no_companies when the lever config is empty", async () => {
    const auto = {
      ...leverAutomation,
      sourceConfig: JSON.stringify({ lever: { companies: [] } }),
    };

    const result = await runAutomation(auto);
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("no_companies");
    expect((searchLeverJobs as any).mock.calls.length).toBe(0);
  });

  it("runs Jobs.cz results through the existing AI and persistence pipeline", async () => {
    const jobsCzAutomation: Automation = {
      ...leverAutomation,
      id: "auto-jobscz",
      name: "Jobs.cz Brno",
      jobBoard: "jobs.cz",
      sourceConfig: JSON.stringify({
        "jobs.cz": {
          queries: ["java", "backend"],
          searchMode: "brno",
          targetTitles: ["Java Backend Developer"],
          keywords: ["Java", "Spring"],
          locations: ["Brno"],
          strictLocation: true,
          topK: 5,
          maxResults: 5,
        },
      }),
    };
    (searchJobsCzJobs as any).mockResolvedValue({
      jobs: [
        makeJob("Java Backend Developer", "Java Spring backend", {
          company: "Example Systems",
          location: "Brno",
          url: "https://www.jobs.cz/rpd/2000000001/",
        }),
      ],
      errors: [],
      totalScopes: 1,
      skipped: 1,
    });

    const result = await runAutomation(jobsCzAutomation);

    expect(result.status).toBe("completed");
    expect(searchJobsCzJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "jobs.cz",
        searchMode: "brno",
        queries: ["java", "backend"],
        maxResults: 5,
      }),
      expect.anything(),
    );
    expect(result.jobsProcessed).toBe(1);
    expect(result.jobsSaved).toBe(1);
    expect((prisma.job.create as any).mock.calls[0][0].data.jobUrl).toBe(
      "https://www.jobs.cz/rpd/2000000001",
    );
  });

  it("records a Jobs.cz 429 as rate_limited without running the pipeline", async () => {
    const jobsCzAutomation: Automation = {
      ...leverAutomation,
      id: "auto-jobscz",
      jobBoard: "jobs.cz",
      sourceConfig: JSON.stringify({
        "jobs.cz": {
          queries: ["java", "backend"],
          keywords: ["Java"],
          locations: ["Brno"],
        },
      }),
    };
    (searchJobsCzJobs as any).mockResolvedValue({
      jobs: [],
      errors: [
        {
          key: "jobs.cz",
          name: "Jobs.cz search",
          reason: "rate limited; retry after 120s",
          kind: "rate_limited",
        },
      ],
      totalScopes: 1,
      skipped: 0,
    });

    const result = await runAutomation(jobsCzAutomation);

    expect(result.status).toBe("rate_limited");
    expect(result.jobsProcessed).toBe(0);
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it("reports fetched Jobs.cz listings rejected by the selected mode without AI", async () => {
    const remoteAutomation: Automation = {
      ...leverAutomation,
      id: "auto-jobscz-remote",
      jobBoard: "jobs.cz",
      sourceConfig: JSON.stringify({
        "jobs.cz": {
          queries: ["java", "backend"],
          searchMode: "remote_cz",
          keywords: ["Java"],
        },
      }),
    };
    (searchJobsCzJobs as any).mockResolvedValue({
      jobs: [],
      errors: [],
      totalScopes: 1,
      skipped: 0,
      fetchedCount: 1,
      rejected: [
        {
          key: "https://www.jobs.cz/rpd/2000000002/",
          name: "Hybrid Java Developer",
          reason: "not marked fully remote",
        },
      ],
    });

    const result = await runAutomation(remoteAutomation);

    expect(searchJobsCzJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        searchMode: "remote_cz",
        locations: [],
        strictLocation: false,
      }),
      expect.anything(),
    );
    expect(result).toMatchObject({
      status: "completed",
      jobsSearched: 1,
      jobsProcessed: 0,
      jobsSaved: 0,
    });
    expect(generateText).not.toHaveBeenCalled();
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it("strips HTML and decodes entities from the resume before matching", async () => {
    (prisma.resume.findUnique as any).mockResolvedValue({
      id: "resume1",
      title: "My Resume",
      ContactInfo: null,
      ResumeSections: [
        {
          sectionType: "experience",
          workExperiences: [
            {
              description: "<p>Sales &amp; Marketing</p>",
              startDate: new Date("2020-01-01"),
              endDate: null,
              Company: { label: "Acme" },
              jobTitle: { label: "Engineer" },
              location: { label: "Remote" },
            },
          ],
        },
      ],
    });
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });

    await runAutomation(leverAutomation);

    const prompt = (generateText as any).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Sales & Marketing");
    expect(prompt).not.toContain("&amp;");
    expect(prompt).not.toContain("<p>");
  });

  it("tags a saved job with the resume skills its posting mentions", async () => {
    (prisma.resume.findUnique as any).mockResolvedValue({
      id: "resume1",
      title: "My Resume",
      ContactInfo: null,
      ResumeSections: [
        {
          sectionType: "skills",
          skills: [
            { category: null, order: 0, Tag: { id: "tag-react", label: "React" } },
            { category: null, order: 1, Tag: { id: "tag-rust", label: "Rust" } },
          ],
        },
      ],
    });
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "We build with React every day")],
      errors: [],
    });

    await runAutomation(leverAutomation);

    const createArg = (prisma.job.create as any).mock.calls[0][0];
    expect(createArg.data.tags).toEqual({ connect: [{ id: "tag-react" }] });
  });

  it("omits tags when the resume has no skills section", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "We build with React every day")],
      errors: [],
    });

    await runAutomation(leverAutomation);

    const createArg = (prisma.job.create as any).mock.calls[0][0];
    expect("tags" in createArg.data).toBe(false);
  });

  describe("board failures", () => {
    const twoBoards: Automation = {
      ...leverAutomation,
      sourceConfig: JSON.stringify({
        lever: {
          companies: [
            { name: "Acme", token: "acme" },
            { name: "Globex", token: "globex" },
          ],
          targetTitles: ["Frontend Engineer"],
          keywords: [],
          locations: [],
          strictLocation: false,
        },
      }),
    };

    it("fails the run when every board errored", async () => {
      (searchLeverJobs as any).mockResolvedValue({
        jobs: [],
        errors: [
          { token: "acme", reason: "Board 'acme' returned 404" },
          { token: "globex", reason: "Board 'globex' timed out" },
        ],
      });

      const result = await runAutomation(twoBoards);

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("All 2 boards unreachable");
      const finalizeData = (recordRunNotifications as any).mock.calls[0][1];
      expect(finalizeData.boardErrors).toEqual([
        { token: "acme", name: "Acme", reason: "Board 'acme' returned 404" },
        { token: "globex", name: "Globex", reason: "Board 'globex' timed out" },
      ]);
    });

    it("completes with errors when only some boards errored", async () => {
      (searchLeverJobs as any).mockResolvedValue({
        jobs: [],
        errors: [{ token: "acme", reason: "Board 'acme' returned 404" }],
      });

      const result = await runAutomation(twoBoards);

      // Takes the "nothing new" early return, which must still carry it.
      expect(result.status).toBe("completed_with_errors");
      expect(result.errorMessage).toBe("1 of 2 boards unreachable");
      const finalizeData = (recordRunNotifications as any).mock.calls[0][1];
      expect(finalizeData.boardErrors).toHaveLength(1);
    });

    it("stays completed when no board errored", async () => {
      (searchLeverJobs as any).mockResolvedValue({ jobs: [], errors: [] });
      const result = await runAutomation(twoBoards);
      expect(result.status).toBe("completed");
      expect(result.errorMessage).toBeUndefined();
    });
  });
});

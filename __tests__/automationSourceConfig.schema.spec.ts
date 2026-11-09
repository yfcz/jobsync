import { CreateAutomationSchema } from "@/models/automation.schema";

const base = {
  name: "Test",
  resumeId: "550e8400-e29b-41d4-a716-446655440000",
  matchThreshold: 80,
  scheduleHour: 8,
};

describe("CreateAutomationSchema conditional validation", () => {
  it("rejects a retired job board", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "jsearch",
      keywords: "frontend",
      location: "Canada",
    });
    expect(result.success).toBe(false);
  });

  it("greenhouse requires at least one company", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: { greenhouse: { companies: [] } },
    });
    expect(result.success).toBe(false);
  });

  it("greenhouse passes with one company and no keywords/location", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: {
          companies: [{ name: "Anthropic", token: "anthropic" }],
          targetTitles: ["Frontend Engineer"],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("greenhouse accepts topK within 1-50 and a saveUnanalyzed boolean", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: {
          companies: [{ name: "Anthropic", token: "anthropic" }],
          topK: 25,
          saveUnanalyzed: false,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("greenhouse rejects topK of 0", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: {
          companies: [{ name: "Anthropic", token: "anthropic" }],
          topK: 0,
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("greenhouse rejects topK of 51", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: {
          companies: [{ name: "Anthropic", token: "anthropic" }],
          topK: 51,
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("ashby requires at least one company", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "ashby",
      sourceConfig: { ashby: { companies: [] } },
    });
    expect(result.success).toBe(false);
  });

  it("ashby passes with one company", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "ashby",
      sourceConfig: {
        ashby: { companies: [{ name: "Ramp", token: "ramp" }] },
      },
    });
    expect(result.success).toBe(true);
  });

  it("jobs.cz accepts a bounded Java/backend Brno search", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "jobs.cz",
      sourceConfig: {
        "jobs.cz": {
          queries: ["java", "backend"],
          searchMode: "brno",
          targetTitles: ["Java Developer", "Backend Developer"],
          keywords: ["Java", "Spring Boot"],
          locations: ["Brno"],
          strictLocation: true,
          maxResults: 10,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("jobs.cz requires a query and rejects an excessive request cap", () => {
    const noQuery = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "jobs.cz",
      sourceConfig: { "jobs.cz": { queries: [] } },
    });
    const excessiveCap = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "jobs.cz",
      sourceConfig: {
        "jobs.cz": { queries: ["java"], maxResults: 11 },
      },
    });
    expect(noQuery.success).toBe(false);
    expect(excessiveCap.success).toBe(false);
  });

  it.each(["brno", "praha", "remote_cz"])(
    "jobs.cz accepts search mode %s",
    (searchMode) => {
      const result = CreateAutomationSchema.safeParse({
        ...base,
        jobBoard: "jobs.cz",
        sourceConfig: {
          "jobs.cz": { queries: ["java"], searchMode },
        },
      });
      expect(result.success).toBe(true);
    },
  );

  it("jobs.cz rejects an unknown search mode", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "jobs.cz",
      sourceConfig: {
        "jobs.cz": { queries: ["java"], searchMode: "everywhere" },
      },
    });
    expect(result.success).toBe(false);
  });
});

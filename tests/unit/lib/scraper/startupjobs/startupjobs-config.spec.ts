import { CreateAutomationSchema, StartupJobsSourceConfigSchema, UpdateAutomationSchema } from "@/models/automation.schema";
import { parseAutomationConfig } from "@/lib/scraper/automation-run/config";
import { EMPTY_STARTUPJOBS, parseEditSourceConfig } from "@/components/automations/automation-wizard/wizardConfig";
import { AUTOMATION_BOARDS, ATS_BOARDS } from "@/models/automation.model";

const base = { name: "StartupJobs", jobBoard: "startupjobs.cz", resumeId: "550e8400-e29b-41d4-a716-446655440000", matchThreshold: 80, scheduleHour: 8 };

describe("StartupJobs automation configuration", () => {
  it.each(["brno", "praha", "remote_cz"] as const)("validates, serializes and reloads %s for create/edit/run", (searchMode) => {
    const config = { ...EMPTY_STARTUPJOBS, searchMode, topK: 3, saveUnanalyzed: false, maxResults: 7 };
    const value = { ...base, sourceConfig: { "startupjobs.cz": config } };
    expect(CreateAutomationSchema.safeParse(value).success).toBe(true);
    expect(UpdateAutomationSchema.safeParse(value).success).toBe(true);
    const serialized = JSON.stringify(value.sourceConfig);
    expect(parseEditSourceConfig(serialized)?.["startupjobs.cz"]).toEqual(config);
    expect(parseAutomationConfig(serialized, "startupjobs.cz")).toMatchObject({ kind: "startupjobs.cz", searchMode, queries: ["java", "backend"], maxResults: 7, topK: 3, saveUnanalyzed: false, strictLocation: false, locations: [] });
  });

  it.each([
    { queries: [] }, { queries: [" "] }, { queries: ["---"] }, { queries: ["1", "2", "3", "4"] },
    { searchMode: undefined }, { searchMode: "unknown" }, { maxResults: 11 }, { maxResults: 0 }, { maxResults: 1.5 }, { topK: 51 },
  ])("rejects invalid source configuration at save and run boundaries %#", (patch) => {
    const config = { ...EMPTY_STARTUPJOBS, ...patch };
    expect(StartupJobsSourceConfigSchema.safeParse(config).success).toBe(false);
    expect(parseAutomationConfig(JSON.stringify({ "startupjobs.cz": config }), "startupjobs.cz")).toBeNull();
    expect(CreateAutomationSchema.safeParse({ ...base, sourceConfig: { "startupjobs.cz": config } }).success).toBe(false);
  });

  it("requires source config, registers the scheduled board and preserves legacy Jobs.cz defaults", () => {
    expect(CreateAutomationSchema.safeParse(base).success).toBe(false);
    expect(AUTOMATION_BOARDS).toContain("startupjobs.cz");
    expect(ATS_BOARDS).not.toContain("startupjobs.cz");
    expect(parseAutomationConfig(JSON.stringify({ "jobs.cz": { queries: ["java"] } }), "jobs.cz")).toMatchObject({ kind: "jobs.cz", searchMode: "brno", locations: ["Brno"] });
  });
});

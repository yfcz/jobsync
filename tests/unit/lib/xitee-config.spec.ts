import { CreateAutomationSchema, UpdateAutomationSchema, XiteeSourceConfigSchema } from "@/models/automation.schema";
import { parseAutomationConfig } from "@/lib/scraper/automation-run/config";
import { EMPTY_XITEE, parseEditSourceConfig } from "@/components/automations/automation-wizard/wizardConfig";
import { AUTOMATION_BOARDS, ATS_BOARDS } from "@/models/automation.model";

const base = { name: "xitee", jobBoard: "xitee", resumeId: "550e8400-e29b-41d4-a716-446655440000", matchThreshold: 80, scheduleHour: 8 };
describe("xitee automation configuration", () => {
  it("supports all-vacancy defaults with no queries or company configuration", () => {
    expect(CreateAutomationSchema.safeParse(base).success).toBe(true);
    expect(parseAutomationConfig(null, "xitee")).toMatchObject({ kind: "xitee", targetTitles: [], keywords: [], locations: [], strictLocation: false });
    expect(AUTOMATION_BOARDS).toContain("xitee");
    expect(ATS_BOARDS).not.toContain("xitee");
  });
  it("validates, saves, and reloads optional preferences and budget for editing/running", () => {
    const config = { ...EMPTY_XITEE, targetTitles: ["QA Lead"], keywords: ["testing"], locations: ["Ostrava"], strictLocation: true, topK: 2, saveUnanalyzed: false };
    const value = { ...base, sourceConfig: { xitee: config } };
    expect(CreateAutomationSchema.parse(value)).toEqual(value);
    expect(UpdateAutomationSchema.parse(value)).toEqual(value);
    const serialized = JSON.stringify(value.sourceConfig);
    expect(parseEditSourceConfig(serialized)?.xitee).toEqual(config);
    expect(parseAutomationConfig(serialized, "xitee")).toEqual({ kind: "xitee", ...config });
  });
  it.each([{ topK: 0 }, { topK: 51 }, { strictLocation: "yes" }, { locations: [17] }, { keywords: [""] }])("rejects malformed optional configuration %#", (patch) => {
    expect(XiteeSourceConfigSchema.safeParse(patch).success).toBe(false);
    expect(parseAutomationConfig(JSON.stringify({ xitee: patch }), "xitee")).toBeNull();
    expect(CreateAutomationSchema.safeParse({ ...base, sourceConfig: { xitee: patch } }).success).toBe(false);
  });
});

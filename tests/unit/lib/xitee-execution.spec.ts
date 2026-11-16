import type { NextRequest } from "next/server";
import cron from "node-cron";
import db from "@/lib/db";
import { runAutomation } from "@/lib/scraper";
import { POST } from "@/app/api/automations/[id]/run/route";
import { startScheduler, stopScheduler } from "@/lib/scheduler";

vi.mock("@/lib/db", () => ({ default: {
  automation: { findFirst: vi.fn(), findMany: vi.fn() },
  automationRun: { findFirst: vi.fn() },
} }));
vi.mock("@/lib/scraper", () => ({
  runAutomation: vi.fn().mockResolvedValue({ status: "completed", jobsSaved: 1 }),
  getUserAiSettings: vi.fn().mockResolvedValue({ provider: "openai" }),
  AutomationAlreadyRunningError: class extends Error {},
}));
vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "user-xitee" } }) }));
vi.mock("@/actions/apiKey.actions", () => ({ getOllamaBaseUrl: vi.fn() }));
vi.mock("@/lib/ai/provider-registry.server", () => ({ PROVIDER_VERIFIERS: {} }));
vi.mock("@/lib/notifications/prune", () => ({ pruneNotifications: vi.fn() }));
vi.mock("@/lib/aiUsage/prune", () => ({ pruneAiCalls: vi.fn() }));
vi.mock("node-cron", () => ({ default: { validate: vi.fn(() => true), schedule: vi.fn(() => ({ stop: vi.fn() })) } }));
vi.mock("next/server", () => ({ NextResponse: { json: (data: unknown, options?: { status?: number }) => ({ status: options?.status ?? 200, json: async () => data }) } }));

const automation = {
  id: "xitee-automation", userId: "user-xitee", name: "xitee Careers", jobBoard: "xitee",
  sourceConfig: JSON.stringify({ xitee: {} }), keywords: "", location: "", resumeId: "cv-xitee",
  resume: { id: "cv-xitee", title: "QA CV" }, matchThreshold: 80, scheduleHour: 12,
  nextRunAt: new Date(), lastRunAt: null, status: "active", createdAt: new Date(), updatedAt: new Date(),
};

describe("xitee execution entry points", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.automation.findFirst).mockResolvedValue(automation as never);
    vi.mocked(db.automation.findMany).mockResolvedValue([automation] as never);
    vi.mocked(db.automationRun.findFirst).mockResolvedValue(null);
  });
  afterEach(() => stopScheduler());

  it("Run Now launches the shared runner with selected CV, configuration and match threshold", async () => {
    const result = await POST({} as NextRequest, { params: Promise.resolve({ id: automation.id }) });
    expect(result.status).toBe(200);
    expect(runAutomation).toHaveBeenCalledWith(expect.objectContaining({ jobBoard: "xitee", sourceConfig: automation.sourceConfig, resumeId: "cv-xitee", matchThreshold: 80 }));
  });

  it("the daily scheduler includes xitee in due sources and launches the same runner", async () => {
    startScheduler();
    const tick = vi.mocked(cron.schedule).mock.calls[0][1] as () => Promise<void>;
    await tick();
    expect(db.automation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ jobBoard: { in: expect.arrayContaining(["xitee", "jobs.cz", "startupjobs.cz", "greenhouse", "lever", "ashby"]) } }) }));
    expect(runAutomation).toHaveBeenCalledWith(expect.objectContaining({ jobBoard: "xitee", sourceConfig: automation.sourceConfig, resumeId: "cv-xitee", scheduleHour: 12 }));
  });
});

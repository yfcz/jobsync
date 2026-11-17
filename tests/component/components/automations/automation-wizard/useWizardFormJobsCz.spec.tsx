import { act, renderHook, waitFor } from "@testing-library/react";
import { useWizardForm } from "@/components/automations/automation-wizard/useWizardForm";
import type { AutomationWithResume } from "@/models/automation.model";

vi.mock("@/actions/automation.actions", () => ({
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

describe("useWizardForm Jobs.cz defaults", () => {
  it("persists the visible Java/backend Brno preset when Jobs.cz is selected", async () => {
    const { result } = renderHook(() =>
      useWizardForm({
        open: true,
        onOpenChange: vi.fn(),
        automations: [],
        onSuccess: vi.fn(),
      }),
    );

    act(() => result.current.form.setValue("jobBoard", "jobs.cz"));

    await waitFor(() => {
      expect(
        result.current.form.getValues("sourceConfig")?.["jobs.cz"],
      ).toMatchObject({
        queries: ["java", "backend"],
        searchMode: "brno",
        locations: ["Brno"],
        strictLocation: true,
        maxResults: 10,
      });
    });
  });

  it.each(["brno", "praha", "remote_cz"] as const)(
    "reloads persisted %s mode when editing",
    async (searchMode) => {
      const editAutomation: AutomationWithResume = {
        id: `auto-${searchMode}`,
        userId: "user-1",
        name: `Jobs.cz ${searchMode}`,
        jobBoard: "jobs.cz",
        keywords: "",
        location: "",
        sourceConfig: JSON.stringify({
          "jobs.cz": {
            queries: ["java", "backend"],
            searchMode,
            targetTitles: ["Java Developer"],
          },
        }),
        resumeId: "resume-1",
        matchThreshold: 80,
        scheduleHour: 8,
        nextRunAt: null,
        lastRunAt: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
        resume: { id: "resume-1", title: "Java CV" },
      };
      const { result } = renderHook(() =>
        useWizardForm({
          open: true,
          onOpenChange: vi.fn(),
          automations: [editAutomation],
          onSuccess: vi.fn(),
          editAutomation,
        }),
      );

      await waitFor(() => {
        expect(
          result.current.form.getValues("sourceConfig")?.["jobs.cz"]
            ?.searchMode,
        ).toBe(searchMode);
      });
    },
  );
});

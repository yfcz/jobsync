import { act, renderHook, waitFor } from "@testing-library/react";
import { useWizardForm } from "@/components/automations/automation-wizard/useWizardForm";

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
        locations: ["Brno"],
        strictLocation: true,
        maxResults: 10,
      });
    });
  });
});

import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useWizardForm } from "@/components/automations/automation-wizard/useWizardForm";
import { XiteeSearchStep } from "@/components/automations/XiteeSearchStep";
import { EMPTY_XITEE } from "@/components/automations/automation-wizard/wizardConfig";
import { createAutomation, updateAutomation } from "@/actions/automation.actions";
import type { AutomationWithResume } from "@/models/automation.model";

vi.mock("@/actions/automation.actions", () => ({ createAutomation: vi.fn(), updateAutomation: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("@/actions/jobtitle.actions", () => ({ getAllJobTitles: vi.fn().mockResolvedValue([]), createJobTitle: vi.fn() }));
vi.mock("@/actions/tag.actions", () => ({ getAllTags: vi.fn().mockResolvedValue([]), createTag: vi.fn() }));
vi.mock("@/actions/jobLocation.actions", () => ({ getAllJobLocations: vi.fn().mockResolvedValue([]) }));
vi.mock("@/actions/job.actions", () => ({ createLocation: vi.fn() }));

describe("xitee automation UI", () => {
  it("shows optional preferences and run options without search queries or a company picker", () => {
    render(<XiteeSearchStep value={EMPTY_XITEE} onChange={vi.fn()} />);
    expect(screen.getByText("Target job titles")).toBeInTheDocument();
    expect(screen.getByText("Keywords / skills")).toBeInTheDocument();
    expect(screen.getByText("Locations")).toBeInTheDocument();
    expect(screen.getByText("Save additional relevant listings")).toBeInTheDocument();
    expect(screen.queryByText(/Add at least one target/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Search queries|Companies|Company token/)).not.toBeInTheDocument();
  });
  it("initializes all-vacancy defaults, advances and saves a new automation", async () => {
    vi.mocked(createAutomation).mockResolvedValue({ success: true });
    const args = { open: true, onOpenChange: vi.fn(), automations: [], onSuccess: vi.fn() };
    const { result } = renderHook(() => useWizardForm(args));
    act(() => { result.current.form.setValue("jobBoard", "xitee"); result.current.nextStep(); });
    await waitFor(() => expect(result.current.form.getValues("sourceConfig")?.xitee).toEqual(EMPTY_XITEE));
    expect(result.current.canGoNext()).toBe(true);
    act(() => { result.current.form.setValue("name", "xitee jobs"); result.current.form.setValue("resumeId", "550e8400-e29b-41d4-a716-446655440000"); });
    await act(() => result.current.onSubmit(result.current.form.getValues()));
    expect(createAutomation).toHaveBeenCalledWith(expect.objectContaining({ jobBoard: "xitee", sourceConfig: { xitee: EMPTY_XITEE } }));
    expect(args.onSuccess).toHaveBeenCalled();
  });
  it("reloads edited xitee settings and saves updates", async () => {
    const config = { ...EMPTY_XITEE, targetTitles: ["QA Lead"], locations: ["Praha"], strictLocation: true, topK: 2, saveUnanalyzed: false };
    const editAutomation = { id: "xitee-auto", name: "QA", jobBoard: "xitee", sourceConfig: JSON.stringify({ xitee: config }), resumeId: "550e8400-e29b-41d4-a716-446655440000", matchThreshold: 85, scheduleHour: 12 } as AutomationWithResume;
    vi.mocked(updateAutomation).mockResolvedValue({ success: true });
    const { result } = renderHook(() => useWizardForm({ open: true, onOpenChange: vi.fn(), automations: [], onSuccess: vi.fn(), editAutomation }));
    expect(result.current.sourceConfigValue).toEqual(config);
    await act(() => result.current.onSubmit(result.current.form.getValues()));
    expect(updateAutomation).toHaveBeenCalledWith("xitee-auto", expect.objectContaining({ sourceConfig: { xitee: config }, scheduleHour: 12, matchThreshold: 85 }));
  });

  it("clears unrelated query requirements when switching from an unfinished search source", async () => {
    const { result } = renderHook(() => useWizardForm({ open: true, onOpenChange: vi.fn(), automations: [], onSuccess: vi.fn() }));
    act(() => {
      result.current.form.setValue("sourceConfig", { "jobs.cz": { queries: [] } });
      result.current.form.setValue("jobBoard", "xitee");
    });
    await waitFor(() => expect(result.current.form.getValues("sourceConfig")).toEqual({ xitee: EMPTY_XITEE }));
  });
});

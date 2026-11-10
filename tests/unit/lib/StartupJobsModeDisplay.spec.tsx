import { fireEvent, render, screen, within } from "@testing-library/react";
import { StepReview } from "@/components/automations/automation-wizard/StepReview";
import { AutomationSearchConfig } from "@/components/automations/automation-detail-container/AutomationSearchConfig";
import { AutomationList } from "@/components/automations/AutomationList";
import type { AutomationWithResume, JobsCzSearchMode } from "@/models/automation.model";

const labels: Record<JobsCzSearchMode, string> = {
  brno: "Brno",
  praha: "Prague",
  remote_cz: "Remote – Czech Republic",
};

function automation(searchMode: JobsCzSearchMode): AutomationWithResume {
  return {
    id: `auto-${searchMode}`,
    userId: "user-1",
    name: `StartupJobs.cz ${labels[searchMode]}`,
    jobBoard: "startupjobs.cz",
    keywords: "",
    location: "",
    sourceConfig: JSON.stringify({
      "startupjobs.cz": {
        queries: ["java", "backend"],
        searchMode,
        targetTitles: ["Java Developer"],
        keywords: ["Spring"],
        maxResults: 5,
      },
    }),
    resumeId: "resume-1",
    matchThreshold: 80,
    scheduleHour: 8,
    nextRunAt: null,
    lastRunAt: null,
    status: "active",
    createdAt: new Date("2026-11-01T00:00:00Z"),
    updatedAt: new Date("2026-11-01T00:00:00Z"),
    resume: { id: "resume-1", title: "Java CV" },
  };
}

describe("StartupJobs.cz search mode display", () => {
  it.each(Object.entries(labels) as [JobsCzSearchMode, string][])(
    "shows %s in the review",
    (searchMode, label) => {
      render(
        <StepReview
          formValues={{
            name: "Jobs",
            jobBoard: "startupjobs.cz",
            sourceConfig: {
              "startupjobs.cz": { queries: ["java"], searchMode },
            },
            resumeId: "00000000-0000-4000-8000-000000000000",
            matchThreshold: 80,
            scheduleHour: 8,
          }}
          searchConfig={{ queries: ["java"], searchMode }}
          selectedResume={{ id: "resume-1", title: "Java CV", sectionCount: 1 }}
        />,
      );
      expect(screen.getByText("Search location").nextSibling).toHaveTextContent(
        label,
      );
    },
  );

  it("shows the mode in the automation list", () => {
    render(
      <AutomationList
        automations={[automation("praha")]}
        onEdit={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    const row = screen
      .getByText("StartupJobs.cz Prague")
      .closest<HTMLElement>("div.flex-1")!;
    expect(within(row).getByText("Prague")).toBeInTheDocument();
  });

  it("shows the mode in automation detail", () => {
    const item = automation("remote_cz");
    render(
      <AutomationSearchConfig
        sourceConfig={item.sourceConfig}
        jobBoard="startupjobs.cz"
        retired={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Search location").nextSibling).toHaveTextContent(
      "Remote – Czech Republic",
    );
  });
});

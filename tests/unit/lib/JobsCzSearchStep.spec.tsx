import { fireEvent, render, screen } from "@testing-library/react";
import { JobsCzSearchStep } from "@/components/automations/JobsCzSearchStep";
import type { JobsCzSourceConfig } from "@/models/automation.model";

vi.mock("@/actions/jobtitle.actions", () => ({
  getAllJobTitles: vi.fn().mockResolvedValue([]),
  createJobTitle: vi.fn(),
}));
vi.mock("@/actions/tag.actions", () => ({
  getAllTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn(),
}));
vi.mock("@/actions/jobLocation.actions", () => ({
  getAllJobLocations: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/actions/job.actions", () => ({
  createLocation: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({
  toastError: vi.fn(),
}));

const value: JobsCzSourceConfig = {
  queries: ["java", "backend"],
  targetTitles: ["Java Developer"],
  keywords: ["Spring Boot"],
  locations: ["Brno"],
  strictLocation: true,
  topK: 5,
  saveUnanalyzed: true,
  maxResults: 5,
};

describe("JobsCzSearchStep", () => {
  it("shows the fixed Brno scope and editable bounded request cap", () => {
    const onChange = vi.fn();
    render(<JobsCzSearchStep value={value} onChange={onChange} />);

    expect(screen.getByText("Jobs.cz search area: Brno")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(
      screen.queryByText("Only show jobs in these locations"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("java")).toBeInTheDocument();
    expect(screen.getByText("backend")).toBeInTheDocument();

    const cap = screen.getByLabelText("Maximum detail pages per run");
    fireEvent.change(cap, { target: { value: "8" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: 8 }),
    );
  });

  it("clamps the detail request cap to the low-traffic maximum", () => {
    const onChange = vi.fn();
    render(<JobsCzSearchStep value={value} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Maximum detail pages per run"), {
      target: { value: "999" },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: 10 }),
    );
  });
});

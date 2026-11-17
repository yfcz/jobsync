import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CzechBoardSearchStep } from "@/components/automations/CzechBoardSearchStep";
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

describe("StartupJobs search fields", () => {
  beforeAll(() => {
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("shows the fixed Brno scope and editable bounded request cap", () => {
    const onChange = vi.fn();
    render(<CzechBoardSearchStep board="startupjobs.cz" value={value} onChange={onChange} />);

    expect(screen.getByText("StartupJobs.cz search area: Brno")).toBeInTheDocument();
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
    render(<CzechBoardSearchStep board="startupjobs.cz" value={value} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Maximum detail pages per run"), {
      target: { value: "999" },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: 10 }),
    );
  });

  it.each([
    ["Prague", "praha", ["Praha"], true],
    ["Remote – Czech Republic", "remote_cz", [], false],
  ] as const)(
    "persists the %s search mode and safe derived location fields",
    async (label, searchMode, locations, strictLocation) => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<CzechBoardSearchStep board="startupjobs.cz" value={value} onChange={onChange} />);

      await user.click(
        screen.getByRole("combobox", { name: "Search location" }),
      );
      await user.click(screen.getByRole("option", { name: label }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          searchMode,
          locations: [...locations],
          strictLocation,
        }),
      );
    },
  );

  it("shows a legacy configuration without searchMode as Brno", () => {
    render(<CzechBoardSearchStep board="startupjobs.cz" value={value} onChange={vi.fn()} />);
    expect(
      screen.getByRole("combobox", { name: "Search location" }),
    ).toHaveTextContent("Brno");
  });
});

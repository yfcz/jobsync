import { mapAshbyJob } from "@/lib/scraper/ashby/mapper";
import { mapAshbySalary } from "@/lib/scraper/ashby/compensation";
import type { AshbyCompensationComponent } from "@/lib/scraper/ashby/types";
import e2bBoard from "./fixtures/e2b-board.json";

const salary = (overrides: Partial<AshbyCompensationComponent> = {}): AshbyCompensationComponent => ({
  compensationType: "Salary", currencyCode: "CZK", minValue: 150000, maxValue: 300000,
  interval: "1 MONTH", ...overrides,
});

describe("Ashby compensation", () => {
  it.each([
    ["Platform Engineer", "CZK 150,000 – 300,000 / month"],
    ["Support Engineer", "CZK 80,000 – 120,000 / month"],
    ["Billing Engineer", "EUR 80,000 – 120,000 / year"],
    ["Engineering Team Lead, Platform", "CZK 180,000 – 360,000 / year"],
    ["Backend Software Engineer - Enterprise", undefined],
  ])("maps the published salary of %s without changing its period", (title, expected) => {
    const job = e2bBoard.jobs.find((posting) => posting.title === title)!;
    expect(mapAshbyJob(job, "E2B").salary).toBe(expected);
  });

  it("does not depend on the missing simple summary for E2B monthly salaries", () => {
    for (const title of ["Platform Engineer", "Support Engineer"]) {
      const job = e2bBoard.jobs.find((posting) => posting.title === title)!;
      expect(job.compensation?.scrapeableCompensationSalarySummary).toBeNull();
      expect(mapAshbyJob(job, "E2B").salary).toContain("/ month");
    }
  });

  it("retains distinct currencies, periods and ranges rather than combining bounds", () => {
    expect(mapAshbySalary({ summaryComponents: [salary(), salary(), salary({
      currencyCode: "EUR", minValue: 80000, maxValue: 120000, interval: "1 YEAR",
    })] })).toBe("CZK 150,000 – 300,000 / month; EUR 80,000 – 120,000 / year");
  });

  it("falls back to a published salary summary without guessing a period", () => {
    expect(mapAshbySalary({ scrapeableCompensationSalarySummary: "  €80K – €120K  " }))
      .toBe("€80K – €120K");
  });

  it("preserves named tiers and uses only salary components", () => {
    expect(mapAshbySalary({ compensationTiers: [
      { title: "Prague", components: [salary(), { compensationType: "EquityPercentage", summary: "0.5%" }] },
      { title: "Other", components: [{ compensationType: "Salary", summary: "Negotiable" }] },
    ] })).toBe("Prague: CZK 150,000 – 300,000 / month; Other: Negotiable");
  });

  it.each([undefined, null, {}, { summaryComponents: [
    { compensationType: "EquityPercentage", minValue: 1, maxValue: 2 },
    { compensationType: "Bonus", summary: "Offers bonus" },
  ] }])("leaves absent salary or equity-only compensation undefined", (compensation) => {
    expect(mapAshbySalary(compensation)).toBeUndefined();
  });

  it("preserves zero, decimals, one-sided amounts and unspecified units", () => {
    expect(mapAshbySalary({ summaryComponents: [
      salary({ minValue: 0, maxValue: null, interval: null, currencyCode: null }),
      salary({ minValue: null, maxValue: 100.25, interval: "1 HOUR" }),
      salary({ minValue: 200, maxValue: 200, interval: "NONE" }),
    ] })).toBe("from 0; CZK up to 100.25 / hour; CZK 200");
  });

  it("does not render non-finite or negative amounts as a salary", () => {
    expect(mapAshbySalary({ summaryComponents: [salary({ minValue: NaN, maxValue: -1 })] }))
      .toBeUndefined();
  });
});

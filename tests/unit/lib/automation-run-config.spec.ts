import { parseAutomationConfig } from "@/lib/scraper/automation-run/config";

describe("Jobs.cz runtime configuration", () => {
  it("defaults a legacy configuration without searchMode to Brno", () => {
    expect(
      parseAutomationConfig(
        JSON.stringify({ "jobs.cz": { queries: ["java"] } }),
        "jobs.cz",
      ),
    ).toMatchObject({
      kind: "jobs.cz",
      searchMode: "brno",
      locations: ["Brno"],
      strictLocation: true,
    });
  });

  it.each([
    ["brno", ["Brno"], true],
    ["praha", ["Praha", "Prague", "Hlavní město Praha"], true],
    ["remote_cz", [], false],
  ] as const)("derives safe runtime scope for %s", (searchMode, locations, strict) => {
    expect(
      parseAutomationConfig(
        JSON.stringify({
          "jobs.cz": {
            queries: ["java"],
            searchMode,
            locations: ["Brno"],
            strictLocation: true,
          },
        }),
        "jobs.cz",
      ),
    ).toMatchObject({ searchMode, locations: [...locations], strictLocation: strict });
  });

  it("falls back safely when persisted searchMode is invalid", () => {
    expect(
      parseAutomationConfig(
        JSON.stringify({
          "jobs.cz": { queries: ["java"], searchMode: "somewhere" },
        }),
        "jobs.cz",
      ),
    ).toMatchObject({ searchMode: "brno", locations: ["Brno"] });
  });
});

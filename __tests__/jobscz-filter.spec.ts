import {
  filterJobsCzJobs,
  isBrnoLocation,
  isPragueLocation,
  jobsCzRejectionReason,
} from "@/lib/scraper/jobscz";
import type { JobDetails } from "@/lib/scraper/types";

function job(extra: Partial<JobDetails> = {}): JobDetails {
  return {
    title: "Java Backend Developer",
    company: "Acme",
    location: "Brno",
    description: "Java and Spring Boot",
    url: "https://www.jobs.cz/rpd/2000000001/",
    ...extra,
  };
}

describe("Jobs.cz mode filters", () => {
  it("preserves Brno and excludes Brno-venkov", () => {
    expect(isBrnoLocation("Brno – střed")).toBe(true);
    expect(isBrnoLocation("Brno-město")).toBe(true);
    expect(isBrnoLocation("Brno-venkov")).toBe(false);
    expect(isBrnoLocation("Brno – venkov")).toBe(false);
  });

  it.each(["Praha", "Prague", "Praha 1", "Hlavní město Praha – Karlín"])(
    "recognizes Prague location %s",
    (location) => expect(isPragueLocation(location)).toBe(true),
  );

  it.each([
    "Brno",
    "Ostrava",
    "Praha-východ",
    "Praha – západ",
  ])(
    "rejects non-Prague location %s",
    (location) => expect(isPragueLocation(location)).toBe(false),
  );

  it("never accepts a Prague mention from the description", () => {
    expect(
      jobsCzRejectionReason(
        job({ location: "Ostrava", description: "Spolupráce s týmem v Praze" }),
        "praha",
      ),
    ).toBe("outside Prague");
  });

  it.each(["Praha", "Brno", "Ostrava", "Olomouc"])(
    "accepts structured remote work from Czech location %s",
    (location) => {
      expect(
        jobsCzRejectionReason(
          job({ location, workplaceType: "REMOTE", isRemote: true }),
          "remote_cz",
        ),
      ).toBeNull();
    },
  );

  it("accepts an otherwise generic Remote location with explicit Czech availability", () => {
    expect(
      jobsCzRejectionReason(
        job({
          location: "Remote",
          workplaceType: "REMOTE",
          description: "Open to candidates anywhere in the Czech Republic.",
        }),
        "remote_cz",
      ),
    ).toBeNull();
  });

  it("accepts the Czech country abbreviation as availability evidence", () => {
    expect(
      jobsCzRejectionReason(
        job({ location: "Remote", workplaceType: "REMOTE", description: "Pro uchazeče z ČR." }),
        "remote_cz",
      ),
    ).toBeNull();
  });

  it("rejects hybrid, on-site and ambiguous workplace information", () => {
    expect(
      jobsCzRejectionReason(job({ workplaceType: "HYBRID" }), "remote_cz"),
    ).toBe("not marked fully remote");
    expect(jobsCzRejectionReason(job(), "remote_cz")).toBe(
      "not marked fully remote",
    );
    expect(
      jobsCzRejectionReason(
        job({
          workplaceType: "REMOTE",
          description: "Hybridní režim, pravidelná docházka do kanceláře.",
        }),
        "remote_cz",
      ),
    ).toBe("hybrid or on-site attendance required");
  });

  it("does not confuse hybrid-cloud terminology with a hybrid workplace", () => {
    expect(
      jobsCzRejectionReason(
        job({
          workplaceType: "REMOTE",
          description: "Build a hybrid cloud platform from anywhere.",
        }),
        "remote_cz",
      ),
    ).toBeNull();
  });

  it("does not treat a generic home-office benefit as remote evidence", () => {
    expect(
      jobsCzRejectionReason(
        job({ description: "Benefit: home office podle dohody." }),
        "remote_cz",
      ),
    ).toBe("not marked fully remote");
  });

  it("rejects remote roles restricted to a foreign location", () => {
    expect(
      jobsCzRejectionReason(
        job({ location: "Sofia, Bulgaria", workplaceType: "REMOTE" }),
        "remote_cz",
      ),
    ).toBe("not confirmed available in the Czech Republic");
  });

  it("returns accepted jobs and observable rejection reasons", () => {
    const result = filterJobsCzJobs(
      [
        job({ location: "Praha", url: "https://www.jobs.cz/rpd/1/" }),
        job({ location: "Plzeň", url: "https://www.jobs.cz/rpd/2/" }),
      ],
      "praha",
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toMatchObject([
      { reason: "outside Prague", job: { location: "Plzeň" } },
    ]);
  });
});

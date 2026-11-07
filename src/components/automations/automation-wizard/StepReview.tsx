"use client";

import { APP_CONSTANTS } from "@/lib/constants";
import type { CreateAutomationInput } from "@/models/automation.schema";
import type { SearchConfigValue, WizardResume } from "./wizardConfig";

export function StepReview({
  formValues,
  searchConfig,
  selectedResume,
}: {
  formValues: CreateAutomationInput;
  searchConfig: SearchConfigValue;
  selectedResume?: WizardResume;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Name</span>
        <span className="font-medium">{formValues.name || "-"}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Job Board</span>
        <span className="font-medium capitalize">
          {formValues.jobBoard || "-"}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">
          {formValues.jobBoard === "jobs.cz" ? "Search queries" : "Companies"}
        </span>
        <span className="font-medium text-right">
          {"queries" in searchConfig
            ? searchConfig.queries.join(", ")
            : searchConfig.companies?.length
              ? searchConfig.companies.map((c) => c.name).join(", ")
              : "-"}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Target titles</span>
        <span className="font-medium text-right">
          {searchConfig.targetTitles?.length
            ? searchConfig.targetTitles.join(", ")
            : "Any"}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Locations</span>
        <span className="font-medium text-right">
          {searchConfig.locations?.length
            ? `${searchConfig.locations.join(", ")}${
                searchConfig.strictLocation ? " (strict)" : ""
              }`
            : "Any location"}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Jobs analyzed per run</span>
        <span className="font-medium text-right">
          {searchConfig.topK ?? APP_CONSTANTS.MAX_JOBS_PER_RUN}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Save additional listings</span>
        <span className="font-medium text-right">
          {searchConfig.saveUnanalyzed !== false ? "Yes" : "No"}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Resume</span>
        <span className="font-medium">
          {selectedResume?.title || "Not selected"}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Match Threshold</span>
        <span className="font-medium">{formValues.matchThreshold ?? 80}%</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Schedule</span>
        <span className="font-medium">
          Daily at{" "}
          {(formValues.scheduleHour ?? 8).toString().padStart(2, "0")}:00
        </span>
      </div>
    </div>
  );
}

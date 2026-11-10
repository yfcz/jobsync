"use client";

import { APP_CONSTANTS } from "@/lib/constants";
import type { CreateAutomationInput } from "@/models/automation.schema";
import type { SearchConfigValue, WizardResume } from "./wizardConfig";
import {
  JOBSCZ_SEARCH_MODE_LABELS,
  jobsCzSearchMode,
  isCzechJobBoard,
} from "@/models/automation.model";

export function StepReview({
  formValues,
  searchConfig,
  selectedResume,
}: {
  formValues: CreateAutomationInput;
  searchConfig: SearchConfigValue;
  selectedResume?: WizardResume;
}) {
  const jobsCzMode =
    "queries" in searchConfig
      ? JOBSCZ_SEARCH_MODE_LABELS[jobsCzSearchMode(searchConfig.searchMode)]
      : null;
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Name</span>
        <span className="font-medium">{formValues.name || "-"}</span>
      </div>
      {jobsCzMode && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Search location</span>
          <span className="font-medium text-right">{jobsCzMode}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span className="text-muted-foreground">Job Board</span>
        <span className="font-medium capitalize">
          {formValues.jobBoard || "-"}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">
          {isCzechJobBoard(formValues.jobBoard) ? "Search queries" : "Companies"}
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
        <span className="text-muted-foreground">
          {jobsCzMode ? "Location rules" : "Locations"}
        </span>
        <span className="font-medium text-right">
          {jobsCzMode
            ? jobsCzMode === JOBSCZ_SEARCH_MODE_LABELS.remote_cz
              ? "Remote and available in Czech Republic"
              : `Strict ${jobsCzMode} match`
            : searchConfig.locations?.length
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

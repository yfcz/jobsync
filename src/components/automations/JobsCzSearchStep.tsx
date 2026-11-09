"use client";

import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { APP_CONSTANTS } from "@/lib/constants";
import {
  JOBSCZ_SEARCH_MODE_LABELS,
  jobsCzSearchMode,
  type JobsCzSearchMode,
  type JobsCzSourceConfig,
} from "@/models/automation.model";
import { EntityStringChipInput } from "./ats-search-step/EntityStringChipInput";
import { TargetingFields } from "./ats-search-step/TargetingFields";
import { RunOptionsFields } from "./ats-search-step/RunOptionsFields";

interface JobsCzSearchStepProps {
  value: JobsCzSourceConfig;
  onChange: (next: JobsCzSourceConfig) => void;
}

export function JobsCzSearchStep({ value, onChange }: JobsCzSearchStepProps) {
  const searchMode = jobsCzSearchMode(value.searchMode);
  const modeLabel = JOBSCZ_SEARCH_MODE_LABELS[searchMode];
  const setSearchMode = (next: JobsCzSearchMode) => {
    onChange({
      ...value,
      searchMode: next,
      locations:
        next === "brno" ? ["Brno"] : next === "praha" ? ["Praha"] : [],
      strictLocation: next !== "remote_cz",
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="text-sm">
          <p className="font-medium">Jobs.cz search area: {modeLabel}</p>
          <p className="text-muted-foreground">
            Uses one public search page and only a small, bounded number of
            public detail pages. Java and backend are separate OR queries.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="jobscz-search-location">Search location</Label>
        <Select
          value={searchMode}
          onValueChange={(next) => setSearchMode(next as JobsCzSearchMode)}
        >
          <SelectTrigger id="jobscz-search-location">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="brno">Brno</SelectItem>
            <SelectItem value="praha">Prague</SelectItem>
            <SelectItem value="remote_cz">
              Remote – Czech Republic
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {searchMode === "remote_cz"
            ? "Uses the native nationwide remote-work filter, then keeps only listings with structured remote evidence and Czech availability."
            : "Uses the selected Jobs.cz locality and validates the structured job location before ranking."}
        </p>
      </div>

      <EntityStringChipInput
        label="Jobs.cz search queries"
        placeholder="e.g., java"
        noun="search query"
        description="Required. Up to three terms are sent as repeated Jobs.cz search parameters."
        values={value.queries}
        onChange={(queries) => onChange({ ...value, queries: queries.slice(0, 3) })}
        loadOptions={async () => []}
        createOption={async (label) => ({
          id: label.toLocaleLowerCase("cs"),
          label,
          value: label.toLocaleLowerCase("cs"),
        })}
      />

      <div className="space-y-2">
        <Label htmlFor="jobscz-max-results">Maximum detail pages per run</Label>
        <Input
          id="jobscz-max-results"
          type="number"
          min={1}
          max={APP_CONSTANTS.JOBSCZ_MAX_RESULTS}
          value={value.maxResults ?? APP_CONSTANTS.JOBSCZ_MAX_RESULTS}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (!Number.isFinite(parsed)) return;
            onChange({
              ...value,
              maxResults: Math.max(
                1,
                Math.min(APP_CONSTANTS.JOBSCZ_MAX_RESULTS, Math.trunc(parsed)),
              ),
            });
          }}
        />
        <p className="text-sm text-muted-foreground">
          Capped at {APP_CONSTANTS.JOBSCZ_MAX_RESULTS} to keep traffic and
          memory use low. Each run uses only one search request plus these
          detail requests.
        </p>
      </div>

      <TargetingFields
        value={value}
        onChange={onChange}
        fixedLocation={modeLabel}
        fixedLocationDescription={
          searchMode === "remote_cz"
            ? "Nationwide search; listings must be marked remote and confirmed available in the Czech Republic."
            : "This source uses a fixed Jobs.cz locality and validates the structured listing location."
        }
      />
      <RunOptionsFields value={value} onChange={onChange} />
    </div>
  );
}

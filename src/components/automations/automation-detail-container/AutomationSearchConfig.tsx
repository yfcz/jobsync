"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  AtsBoard,
  JobBoard,
  JobsCzSourceConfig,
  LeverSourceConfig,
} from "@/models/automation.model";
import {
  JOBSCZ_SEARCH_MODE_LABELS,
  jobsCzSearchMode,
  isCzechJobBoard,
} from "@/models/automation.model";
import { companyBoardUrl } from "@/lib/atsBoardUrl";
import { APP_CONSTANTS } from "@/lib/constants";

// Pure JSON parse (no runner dependency — this is a client component, and
// runner.ts pulls the network-calling scraper into the client bundle). The raw
// parse may be missing any field, so it's a Partial of the config shape.
function parseAtsConfig(
  sourceConfig: string | null | undefined,
  jobBoard: JobBoard,
): Partial<LeverSourceConfig> | Partial<JobsCzSourceConfig> | null {
  if (!sourceConfig) return null;
  try {
    return JSON.parse(sourceConfig)?.[jobBoard] ?? null;
  } catch {
    return null;
  }
}

interface AutomationSearchConfigProps {
  sourceConfig: string | null | undefined;
  jobBoard: JobBoard;
  retired: boolean;
}

export function AutomationSearchConfig({
  sourceConfig,
  jobBoard,
  retired,
}: AutomationSearchConfigProps) {
  const [showSearchConfig, setShowSearchConfig] = useState(false);

  const searchConfig = retired
    ? null
    : parseAtsConfig(sourceConfig, jobBoard);

  if (!searchConfig) return null;
  const jobsCzConfig =
    isCzechJobBoard(jobBoard)
      ? (searchConfig as Partial<JobsCzSourceConfig>)
      : null;
  const atsConfig =
    !isCzechJobBoard(jobBoard)
      ? (searchConfig as Partial<LeverSourceConfig>)
      : null;
  const jobsCzMode = jobsCzConfig
    ? JOBSCZ_SEARCH_MODE_LABELS[jobsCzSearchMode(jobsCzConfig.searchMode)]
    : null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="mt-4 -ml-2 text-muted-foreground"
        onClick={() => setShowSearchConfig((prev) => !prev)}
      >
        {showSearchConfig ? (
          <ChevronUp className="h-4 w-4 mr-1" />
        ) : (
          <ChevronDown className="h-4 w-4 mr-1" />
        )}
        {showSearchConfig ? "Show less" : "Show more"}
      </Button>

      {showSearchConfig && (
        <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2 md:col-span-4">
            <p className="text-sm text-muted-foreground">
              {jobsCzConfig ? `${jobBoard === "startupjobs.cz" ? "StartupJobs.cz" : "Jobs.cz"} queries` : "Companies"}
            </p>
            {jobsCzConfig?.queries?.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {jobsCzConfig.queries.map((query) => (
                  <Badge key={query} variant="secondary">
                    {query}
                  </Badge>
                ))}
              </div>
            ) : atsConfig?.companies?.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {atsConfig.companies.map((c) => (
                  <Badge key={c.token} variant="secondary" className="gap-1">
                    {c.name}
                    <a
                      href={companyBoardUrl(jobBoard as AtsBoard, c)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${c.name} job board`}
                      title="Open job board"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm font-medium">-</p>
            )}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Target titles</p>
            <p className="text-sm font-medium">
              {searchConfig.targetTitles?.length
                ? searchConfig.targetTitles.join(", ")
                : "Any"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Keywords</p>
            <p className="text-sm font-medium">
              {searchConfig.keywords?.length
                ? searchConfig.keywords.join(", ")
                : "None"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              {jobsCzMode ? "Search location" : "Locations"}
            </p>
            <p className="text-sm font-medium">
              {jobsCzMode
                ? jobsCzMode
                : searchConfig.locations?.length
                ? `${searchConfig.locations.join(", ")}${
                    searchConfig.strictLocation ? " (strict)" : ""
                  }`
                : "Any location"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              Jobs analyzed per run
            </p>
            <p className="text-sm font-medium">
              {searchConfig.topK ?? APP_CONSTANTS.MAX_JOBS_PER_RUN}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Extra listings</p>
            <p className="text-sm font-medium">
              {searchConfig.saveUnanalyzed !== false
                ? "Saved"
                : "Not saved"}
            </p>
          </div>
          {jobsCzConfig && (
            <div>
              <p className="text-sm text-muted-foreground">Detail page cap</p>
              <p className="text-sm font-medium">
                {jobsCzConfig.maxResults ?? APP_CONSTANTS.JOBSCZ_MAX_RESULTS}
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

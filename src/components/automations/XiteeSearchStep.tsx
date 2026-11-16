"use client";

import type { XiteeSourceConfig } from "@/models/automation.model";
import { TargetingFields } from "./ats-search-step/TargetingFields";
import { RunOptionsFields } from "./ats-search-step/RunOptionsFields";

export function XiteeSearchStep({ value, onChange }: {
  value: XiteeSourceConfig;
  onChange: (next: XiteeSourceConfig) => void;
}) {
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">
      Monitor all public vacancies at <a className="underline" href="https://career.xitee.com/cs/volna-mista/" target="_blank" rel="noopener noreferrer">xitee Careers</a>.
      Optional preferences and your selected CV determine relevance.
    </p>
    <TargetingFields value={value} onChange={onChange} resumeSkillFallback />
    <RunOptionsFields value={value} onChange={onChange} />
  </div>;
}

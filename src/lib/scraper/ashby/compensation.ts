import type { AshbyCompensation, AshbyCompensationComponent } from "./types";

function formatSalary(component: AshbyCompensationComponent): string | undefined {
  if (component.compensationType !== "Salary") return undefined;
  const amount = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value.toLocaleString("en-US", { maximumFractionDigits: 20 })
      : undefined;
  const min = amount(component.minValue);
  const max = amount(component.maxValue);
  if (min === undefined && max === undefined) return undefined;

  const range = min === max ? min
    : min !== undefined && max !== undefined ? `${min} – ${max}`
    : min !== undefined ? `from ${min}` : `up to ${max}`;
  const currency = component.currencyCode?.trim();
  const interval = component.interval?.trim();
  // Render published units without guessing an annual/monthly conversion.
  const period = !interval || interval === "NONE" ? ""
    : ` / ${interval.replace(/^1 (YEAR|MONTH|WEEK|DAY|HOUR)$/i, (_, unit: string) => unit.toLowerCase())}`;
  return `${currency ? `${currency} ` : ""}${range}${period}`;
}

export function mapAshbySalary(compensation?: AshbyCompensation | null): string | undefined {
  if (!compensation) return undefined;
  const structured = (compensation.summaryComponents ?? [])
    .map(formatSalary)
    .filter((value): value is string => Boolean(value));
  if (structured.length) return [...new Set(structured)].join("; ");

  const published = compensation.scrapeableCompensationSalarySummary?.trim();
  if (published) return published;

  // Keep tiers separate: their amounts, currencies and intervals can differ.
  const tiers = (compensation.compensationTiers ?? []).flatMap((tier) => {
    const salaries = (tier.components ?? [])
      .filter((component) => component.compensationType === "Salary")
      .map((component) => formatSalary(component) ?? component.summary?.trim())
      .filter((value): value is string => Boolean(value));
    return salaries.map((salary) => tier.title?.trim() ? `${tier.title.trim()}: ${salary}` : salary);
  });
  return tiers.length ? [...new Set(tiers)].join("; ") : undefined;
}

import { parse, serializeOuter } from "parse5";
import type { JobDetails } from "../types";
import type { JobsCzSearchListing } from "./types";

type HtmlAttribute = { name: string; value: string };
type HtmlNode = {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
};

function attr(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((candidate) => candidate.name === name)?.value;
}

function hasClass(node: HtmlNode, className: string): boolean {
  return (attr(node, "class") ?? "").split(/\s+/).includes(className);
}

function walk(node: HtmlNode, visit: (candidate: HtmlNode) => boolean): HtmlNode | null {
  if (visit(node)) return node;
  for (const child of node.childNodes ?? []) {
    const found = walk(child, visit);
    if (found) return found;
  }
  return null;
}

function collect(
  node: HtmlNode,
  visit: (candidate: HtmlNode) => boolean,
  result: HtmlNode[] = [],
): HtmlNode[] {
  if (visit(node)) result.push(node);
  for (const child of node.childNodes ?? []) collect(child, visit, result);
  return result;
}

function text(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  if (node.nodeName === "script" || node.nodeName === "style") return "";
  return (node.childNodes ?? []).map(text).join(" ").replace(/\s+/g, " ").trim();
}

function canonicalDetailUrl(id: string): string {
  return `https://www.jobs.cz/rpd/${id}/`;
}

export function parseJobsCzSearchPage(html: string): JobsCzSearchListing[] {
  const document = parse(html) as unknown as HtmlNode;
  const cards = collect(document, (node) =>
    node.tagName === "article" && hasClass(node, "SearchResultCard"),
  );

  const listings: JobsCzSearchListing[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const link = walk(card, (node) => !!attr(node, "data-jobad-id"));
    const rawId = link ? attr(link, "data-jobad-id") : undefined;
    const id = rawId?.match(/^\d+$/)?.[0];
    if (!id || seen.has(id)) continue;

    const titleNode = walk(card, (node) => !!attr(node, "data-test-ad-title"));
    const companyNode = walk(
      card,
      (node) => node.tagName === "span" && attr(node, "translate") === "no",
    );
    const companyLogo = walk(
      card,
      (node) => node.tagName === "img" && !!attr(node, "alt"),
    );
    const locationNode = walk(
      card,
      (node) => attr(node, "data-test") === "serp-locality",
    );

    const title = text(titleNode ?? link!);
    const company = companyNode
      ? text(companyNode)
      : companyLogo
        ? (attr(companyLogo, "alt") ?? "")
        : "";
    const location = locationNode ? text(locationNode) : "";
    const workplaceType = workplaceTypeFrom(text(card));
    if (!title || !company) continue;

    seen.add(id);
    listings.push({
      id,
      title,
      company,
      location,
      url: canonicalDetailUrl(id),
      ...(workplaceType ? { workplaceType } : {}),
    });
  }

  return listings;
}

function employmentTypeFrom(info: string): string | undefined {
  const normalized = info.toLocaleLowerCase("cs");
  if (normalized.includes("plný úvazek") || normalized.includes("full-time")) {
    return "Full-time";
  }
  if (
    normalized.includes("částečný úvazek") ||
    normalized.includes("part-time")
  ) {
    return "Part-time";
  }
  if (normalized.includes("smlouva") || normalized.includes("contract")) {
    return "Contract";
  }
  return undefined;
}

function workplaceTypeFrom(info: string): "REMOTE" | "HYBRID" | undefined {
  const normalized = info.toLocaleLowerCase("cs");
  if (
    normalized.includes("práce převážně z domova") ||
    normalized.includes("fully remote")
  ) {
    return "REMOTE";
  }
  if (
    normalized.includes("možnost občasné práce z domova") ||
    normalized.includes("hybrid")
  ) {
    return "HYBRID";
  }
  return undefined;
}

export function parseJobsCzDetailPage(
  html: string,
  listing: JobsCzSearchListing,
): JobDetails | null {
  const document = parse(html) as unknown as HtmlNode;
  const descriptionNode = walk(
    document,
    (node) => attr(node, "data-test") === "jd-body-richtext",
  );

  // Some Jobs.cz links redirect to JavaScript-only company career pages. The
  // public HTML then contains only a loader, not the job body. Do not call an
  // internal API or launch a browser: skip it explicitly.
  if (!descriptionNode) return null;

  const description = (descriptionNode.childNodes ?? [])
    .map((node) => serializeOuter(node as never))
    .join("")
    .trim();
  if (!text(descriptionNode)) return null;

  const locationNode = walk(
    document,
    (node) => attr(node, "data-test") === "jd-info-location",
  );
  const salaryNode = walk(
    document,
    (node) => attr(node, "data-test") === "jd-salary",
  );
  const infoNodes = collect(
    document,
    (node) => attr(node, "data-test") === "jd-info-item",
  );
  const info = infoNodes.map(text).join(" ");
  const timeNode = walk(
    document,
    (node) => node.tagName === "time" && !!attr(node, "datetime"),
  );
  const workplaceType = workplaceTypeFrom(info) ?? listing.workplaceType;

  return {
    title: listing.title,
    company: listing.company,
    location: (locationNode ? text(locationNode) : "") || listing.location,
    description,
    url: listing.url,
    postedDate: timeNode ? attr(timeNode, "datetime") : undefined,
    salary: salaryNode ? text(salaryNode) : undefined,
    employmentType: employmentTypeFrom(info),
    workplaceType,
    isRemote: workplaceType === "REMOTE",
  };
}

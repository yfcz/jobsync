import { parse } from "parse5";
import { flattenHtml } from "../html";
import type { StartupJobsJob, StartupJobsListing } from "./types";

export const STARTUPJOBS_ORIGIN = "https://www.startupjobs.cz";

export function allowedStartupJobsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === STARTUPJOBS_ORIGIN && !url.username && !url.password &&
      (url.pathname === "/robots.txt" || url.pathname === "/sitemap_index.xml" ||
        url.pathname === "/sitemap/offers.xml" || /^\/nabidka\/\d+\/[a-z0-9-]+\/?$/.test(url.pathname)) &&
      !url.search && !url.hash;
  } catch {
    return false;
  }
}

function locs(xml: string): string[] {
  // No DTD/entity expansion. The observed sitemaps use plain absolute URLs.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported sitemap declarations");
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) => match[1].replace(/&amp;/g, "&"));
}

export function parseStartupJobsSitemapIndex(xml: string): string {
  if (!/<sitemapindex\b/.test(xml)) throw new Error("Invalid StartupJobs sitemap index");
  const offers = locs(xml).find((url) => url === `${STARTUPJOBS_ORIGIN}/sitemap/offers.xml`);
  if (!offers) throw new Error("StartupJobs offers sitemap is unavailable");
  return offers;
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
}

export function matchesStartupJobsQueries(value: string, queries: string[]): boolean {
  const text = ` ${normalizeSearchText(value)} `;
  return queries.some((query) => {
    const normalized = normalizeSearchText(query);
    return normalized.length > 0 && text.includes(` ${normalized} `);
  });
}

export function parseStartupJobsSearch(xml: string, queries: string[]): StartupJobsListing[] {
  if (!/<urlset\b/.test(xml)) throw new Error("Invalid StartupJobs offers sitemap");
  return locs(xml).filter(allowedStartupJobsUrl).flatMap((url) => {
    const match = new URL(url).pathname.match(/^\/nabidka\/(\d+)\/([a-z0-9-]+)\/?$/);
    if (!match || !matchesStartupJobsQueries(match[2], queries)) return [];
    return [{ id: match[1], title: match[2].replace(/-/g, " "), url: `${STARTUPJOBS_ORIGIN}/nabidka/${match[1]}/${match[2]}` }];
  }).sort((a, b) => Number(b.id) - Number(a.id));
}

type HtmlNode = { tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: HtmlNode[]; value?: string };
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function localized(value: unknown): string {
  if (typeof value === "string") return value;
  const v = object(value);
  return typeof v.cs === "string" && v.cs ? v.cs : typeof v.en === "string" ? v.en : "";
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function strings(value: unknown): string[] { return array(value).filter((v): v is string => typeof v === "string"); }

function nuxtData(html: string): unknown[] {
  const nodes: HtmlNode[] = [parse(html) as unknown as HtmlNode];
  while (nodes.length) {
    const node = nodes.pop()!;
    if (node.tagName === "script" && node.attrs?.some((a) => a.name === "id" && a.value === "__NUXT_DATA__")) {
      const data: unknown = JSON.parse(node.childNodes?.map((n) => n.value ?? "").join("") ?? "");
      if (!Array.isArray(data) || data.length > 30_000) throw new Error("Invalid StartupJobs page data");
      return data;
    }
    nodes.push(...(node.childNodes ?? []));
  }
  throw new Error("StartupJobs public detail data is missing (page changed or access challenge)");
}

// Nuxt's devalue format stores object/array values as references into a table.
// Decode JSON only; never evaluate scripts or call the API named in query keys.
function decode(table: unknown[], index: unknown, depth = 0, budget = { left: 30_000 }): unknown {
  if (typeof index !== "number" || !Number.isInteger(index) || depth > 40 || --budget.left < 0) throw new Error("Invalid StartupJobs data reference");
  if (index < 0) return null;
  if (index >= table.length) throw new Error("Invalid StartupJobs data reference");
  const value = table[index];
  if (Array.isArray(value)) {
    if (typeof value[0] === "string") {
      if (["Reactive", "ShallowReactive", "Ref", "ShallowRef"].includes(value[0])) return decode(table, value[1], depth + 1, budget);
      throw new Error("Unsupported StartupJobs data encoding");
    }
    return value.map((v) => decode(table, v, depth + 1, budget));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(table, v, depth + 1, budget)]));
  }
  return value;
}

export function parseStartupJobsDetail(html: string, listing: StartupJobsListing): StartupJobsJob {
  const table = nuxtData(html);
  let offer: JsonObject | undefined;
  for (const entry of table) {
    const query = object(entry);
    if (!("queryKey" in query) || !("state" in query)) continue;
    const key = array(decode(table, query.queryKey));
    const request = object(key[0]);
    if (request._id === "apiOffersIdGet" && String(object(request.path).id) === listing.id) {
      offer = object(object(decode(table, query.state)).data);
      break;
    }
  }
  if (!offer) throw new Error("StartupJobs detail identity did not match the requested listing");
  if (offer.status === "expired") throw new Error("Listing is not published (expired)");
  if (offer.status !== "published") throw new Error(`Unexpected StartupJobs publication state: ${String(offer.status ?? "missing")}`);
  const title = localized(offer.name);
  const company = localized(object(offer.company).name);
  const body = localized(offer.description);
  if (!title || !company || !flattenHtml(body)) throw new Error("Listing has no public title, company or description");
  const locations = array(offer.locations).map(object);
  const collaborations = strings(offer.collaborations);
  const skills = array(offer.skills).map((s) => localized(object(s).name)).filter(Boolean);
  const workplaceType = collaborations.includes("remote") ? "REMOTE" : collaborations.includes("hybrid") ? "HYBRID" : collaborations.includes("onsite") ? "ONSITE" : undefined;
  const salary = object(offer.salary);
  const amount = [salary.minimum, salary.maximum].filter((n) => typeof n === "number" && Number.isFinite(n)).join("–");
  // Keep the published compensation, all shift options and technologies in the
  // existing description field too: Job has no dedicated salary/skills columns.
  const salaryText = amount ? `${amount} ${localized(salary.currency)} ${localized(salary.measure)}`.trim() : undefined;
  const shifts = array(offer.shifts).filter((n): n is number => typeof n === "number");
  const employment = shifts.includes(160) ? "Full-time" : shifts.some((n) => n > 0 && n < 160) ? "Part-time" : undefined;
  const extra = [salaryText ? `Published salary: ${salaryText}` : "", skills.length ? `Technologies / skills: ${skills.join(", ")}` : "", shifts.length ? `Monthly hours: ${shifts.join(", ")}` : "", collaborations.length ? `Cooperation options: ${collaborations.join(", ")}` : ""].filter(Boolean).join("\n");
  return {
    sourceId: listing.id, title, company, url: listing.url,
    description: `${body}\n${extra}`, sourceDescription: body,
    location: locations.map((l) => localized(l.name)).filter(Boolean).join("; "),
    cities: locations.map((l) => localized(l.place)).filter(Boolean),
    countries: locations.map((l) => localized(l.country)).filter(Boolean),
    workplaces: locations.map((l) => ({ city: localized(l.place), country: localized(l.country) })),
    collaborations, skills, workplaceType, isRemote: workplaceType === "REMOTE",
    postedDate: typeof offer.createdAt === "string" ? offer.createdAt : undefined,
    employmentType: employment, salary: salaryText,
  };
}

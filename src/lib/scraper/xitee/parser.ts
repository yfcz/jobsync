import { parse } from "parse5";
import type { JobDetails } from "../types";
import { canonicalXiteeUrl } from "./urls";

type Node = { tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: Node[]; value?: string };
const attr = (node: Node, name: string) => node.attrs?.find((a) => a.name === name)?.value ?? "";
const hasClass = (node: Node, name: string) => attr(node, "class").split(/\s+/).includes(name);
const ignored = new Set(["script", "style", "nav", "header", "footer", "form", "button", "svg", "noscript"]);
function nodes(root: Node): Node[] {
  const result: Node[] = [];
  const walk = (node: Node) => {
    if (ignored.has(node.tagName ?? "") || node.attrs?.some((a) => a.name === "hidden") || attr(node, "aria-hidden") === "true") return;
    result.push(node);
    node.childNodes?.forEach(walk);
  };
  walk(root);
  return result;
}
function text(node: Node): string {
  if (ignored.has(node.tagName ?? "")) return "";
  const value = node.value ?? node.childNodes?.map(text).join("") ?? "";
  return /^(?:p|div|li|h[1-6]|ul|ol|br)$/.test(node.tagName ?? "") ? `\n${value}\n` : value;
}
const compact = (node: Node) => text(node).replace(/\s+/g, " ").trim();
const lines = (node: Node) => text(node).split(/\n/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

export interface XiteeListing { title: string; url: string }

export function parseXiteeListing(html: string): XiteeListing[] {
  const all = nodes(parse(html) as Node);
  const heading = all.find((n) => n.tagName === "h1");
  const loops = all.filter((n) => hasClass(n, "bde-post-loop"));
  if (!heading || !/voln[áa]\s+m[íi]sta|(?:open|job)\s+(?:positions|vacancies)|vacancies/i.test(compact(heading)) || loops.length !== 1) {
    throw new Error("xitee listing structure changed: vacancy heading or post loop missing");
  }
  const loop = loops[0];
  if (!nodes(loop).some((n) => hasClass(n, "bde-loop"))) {
    throw new Error("xitee listing structure changed: vacancy list missing");
  }
  const listings = new Map<string, XiteeListing>();
  for (const article of nodes(loop).filter((n) => n.tagName === "article")) {
    const links = nodes(article).filter((n) => n.tagName === "a");
    const vacancy = links.map((n) => ({ title: compact(n), url: canonicalXiteeUrl(attr(n, "href")) })).find((n) => n.url && n.title);
    if (!vacancy?.url) throw new Error("xitee vacancy card has no valid title/link");
    listings.set(vacancy.url, { title: vacancy.title, url: vacancy.url });
  }
  // A recognized, actually empty loop is valid; a link-only changed template is not.
  if (!listings.size && nodes(loop).some((n) => n.tagName === "a" || n.tagName === "article")) {
    throw new Error("xitee vacancy cards changed");
  }
  if (!listings.size && compact(loop) && !/^(?:no (?:posts|positions|vacancies|jobs) found\.?|žádn[áé] (?:voln[áé] )?(?:místa|pozice)\.?)$/i.test(compact(loop))) {
    throw new Error("xitee vacancy list contains unexpected content");
  }
  return [...listings.values()];
}

export function parseXiteeDetail(html: string, listing: XiteeListing): JobDetails {
  const all = nodes(parse(html) as Node);
  const body = all.find((n) => n.tagName === "body");
  const heading = all.find((n) => n.tagName === "h1");
  const descriptions = all.filter((n) => hasClass(n, "bde-rich-text"));
  if (!body || !hasClass(body, "single-volna-mista") || !heading || descriptions.length !== 1) {
    throw new Error("xitee detail structure changed: position title/description missing");
  }
  const title = compact(heading);
  const roleLines = lines(descriptions[0]);
  const raw = roleLines.join("\n");
  if (!title || raw.length < 120) {
    throw new Error("xitee detail has no substantive requirements/responsibilities");
  }
  const declared = all.find((n) => n.tagName === "link" && attr(n, "rel") === "canonical");
  const url = canonicalXiteeUrl(declared ? attr(declared, "href") : listing.url);
  const requestedUrl = canonicalXiteeUrl(listing.url);
  if (!url || !requestedUrl) throw new Error("Invalid xitee canonical vacancy URL");
  const dedupeUrls = new Set([url, requestedUrl]);
  for (const link of all.filter((n) => n.tagName === "link" && attr(n, "hreflang"))) {
    const alternate = canonicalXiteeUrl(attr(link, "href"));
    if (alternate) dedupeUrls.add(alternate);
  }
  let applicationUrl: string | undefined;
  for (const link of all.filter((n) => n.tagName === "a")) {
    try {
      const target = new URL(attr(link, "href"));
      const advert = target.searchParams.get("advId");
      if (target.origin === "https://my.teamio.com" && target.pathname === "/asmt/index.jsp" &&
          !target.username && !target.password && advert && /^\d{6,15}$/.test(advert)) {
        applicationUrl = target.href;
        dedupeUrls.add(`https://www.jobs.cz/rpd/${advert}/`);
      }
    } catch { /* Non-URL application anchors are not identities. */ }
  }
  const metadata = (pattern: RegExp) => roleLines.map((line) => line.match(pattern)?.[1]?.trim()).find(Boolean);
  // Only explicit labels in the position content count as location evidence.
  const location = metadata(/^(?:location|locations|místo výkonu práce|místo práce|lokalita)\s*:\s*(.+)$/i) ?? "";
  const salary = metadata(/^(?:salary|salary range|mzda|plat|odměna)\s*:\s*(.+)$/i);
  const postedDate = metadata(/^(?:posted|date posted|zveřejněno|datum zveřejnění)\s*:\s*(.+)$/i);
  const employmentType = /\bfull[ -]?time\b|plný úvazek|\bHPP\b/i.test(raw) ? "FULL_TIME"
    : /\bpart[ -]?time\b|částečný úvazek|zkrácený úvazek/i.test(raw) ? "PART_TIME"
    : /\bcontractor\b|\bIČO\b/i.test(raw) ? "CONTRACTOR" : undefined;
  const workplaceType = /\bhybrid(?:ní)?\s+(?:work|working|model|mode|režim|práce|pracovní|spolupráce)|(?:pracovat|práce)\s+hybridně|(?:workplace|work mode)\s*:\s*hybrid\b/i.test(raw) ? "HYBRID"
    : /(?:fully|100\s*%|full)[ -]?(?:remote|home office)|(?:remote[ -](?:only|first))|plně (?:na dálku|remote)/i.test(raw) ? "REMOTE"
    : /\bon[ -]site\b|(?:výhradně|pouze) (?:z|v) kancelář/i.test(raw) ? "ONSITE" : undefined;
  // Benefits written inside the role's editor are also removed. Keep explicit
  // working terms there, but never the shared office-address/benefits pitch.
  let benefits = false;
  const description = roleLines.filter((line) => {
    if (/^(?:benefits|benefity|co ti nabízíme|co nabízíme|and what can you expect from us)\??:?(?:\s*)$/i.test(line)) { benefits = true; return false; }
    if (/^(?:requirements|responsibilities|must have|nice to have|what you(?:'|’)ll (?:do|bring)|co (?:od tebe )?očekáváme|co bude tvou náplní práce|požadujeme|náplň práce|jazykové znalosti)\??:?$/i.test(line)) benefits = false;
    return !benefits || /full[ -]?time|part[ -]?time|úvaz|pracovní poměr|hybrid|fully remote|100\s*% remote|^(?:salary|mzda|plat|location|místo práce)\s*:/i.test(line);
  }).join("\n\n");
  return {
    sourceId: attr(body, "class").match(/\bpostid-(\d+)\b/)?.[1],
    title, company: "xitee", url, description, location, salary, postedDate,
    employmentType, workplaceType, isRemote: workplaceType === "REMOTE" ? true : undefined,
    applicationUrl, dedupeUrls: [...dedupeUrls],
  };
}

// Pure robots policy shared by the HTML career-site adapters.
export function robotsAllows(text: string, value: string, requestIntervalMs: number): boolean {
  if (/<html|<!doctype/i.test(text)) return false;
  const groups: { agents: string[]; rules: { path: string; allow: boolean }[]; delay: number }[] = [];
  let current: (typeof groups)[number] | undefined;
  let hasRules = false;
  for (const line of text.split(/\r?\n/)) {
    const match = line.replace(/#.*$/, "").trim().match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (!current || hasRules) { current = { agents: [], rules: [], delay: 0 }; groups.push(current); hasRules = false; }
      current.agents.push(value.toLowerCase());
    } else if (current && ["allow", "disallow", "crawl-delay"].includes(key)) {
      hasRules = true;
      if (key === "crawl-delay") current.delay = Number(value) || 0;
      else if (value) current.rules.push({ path: value, allow: key === "allow" });
    }
  }
  const specificity = (group: (typeof groups)[number]) => Math.max(0, ...group.agents.filter((a) => a !== "*" && "jobsync".startsWith(a)).map((a) => a.length));
  const longest = Math.max(0, ...groups.map(specificity));
  const applicable = longest ? groups.filter((g) => specificity(g) === longest) : groups.filter((g) => g.agents.includes("*"));
  // Refuse rather than violate a publisher's slower crawl requirement.
  if (applicable.some((g) => g.delay * 1000 > requestIntervalMs)) return false;
  const target = new URL(value);
  const path = target.pathname + target.search;
  const matches = applicable.flatMap((g) => g.rules).filter((rule) => {
    const pattern = rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    return new RegExp(`^${pattern}`).test(path);
  }).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matches[0]?.allow ?? true;
}

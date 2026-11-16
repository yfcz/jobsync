export const XITEE_ORIGIN = "https://career.xitee.com";
export const XITEE_LISTING_URL = `${XITEE_ORIGIN}/cs/volna-mista/`;

export function canonicalXiteeUrl(value: string, base = XITEE_LISTING_URL): string | null {
  try {
    const url = new URL(value, base);
    if (url.origin !== XITEE_ORIGIN || url.username || url.password ||
        !/^\/(?:cs|en)\/volna-mista\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/i.test(url.pathname)) return null;
    return `${XITEE_ORIGIN}${url.pathname.replace(/^\/en\//, "/cs/").replace(/\/?$/, "/")}`;
  } catch { return null; }
}

// Network allowlist also covers the observed WordPress robots redirect.
export function allowedXiteeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === XITEE_ORIGIN && !url.username && !url.password && !url.hash && !url.search &&
      (["/robots.txt", "/cs/robots.txt/", "/cs/volna-mista/", "/en/volna-mista/"].includes(url.pathname) || canonicalXiteeUrl(value) !== null);
  } catch { return false; }
}

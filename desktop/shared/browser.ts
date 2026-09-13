export const BLANK_PAGE = "about:blank";
export const GOOGLE_SEARCH = "https://www.google.com/search?q=";

export type LocalServer = { port: number; process: string };

export function browserDestination(typed: string): string | undefined {
  const wanted = typed.trim();
  if (!wanted) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(wanted)) return wanted;
  const bare = wanted.split(/[/?#]/, 1)[0] ?? "";
  const hostLike = !/\s/.test(wanted) && (/^localhost(:\d{1,5})?$/i.test(bare) || /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?$/.test(bare) || /^[^\s.]+(\.[^\s.]+)+(:\d{1,5})?$/.test(bare));
  if (!hostLike) return `${GOOGLE_SEARCH}${encodeURIComponent(wanted)}`;
  return /^localhost|^(\d{1,3}\.){3}\d{1,3}/i.test(bare) ? `http://${wanted}` : `https://${wanted}`;
}

export function blankPage(url: string | undefined): boolean {
  return !url || url === BLANK_PAGE;
}

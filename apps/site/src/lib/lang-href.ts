/**
 * The language switch keeps the place on the page: /en/sound/#sound-keys -> /pl/sound/#sound-keys.
 * The switch links are plain server-rendered <a href="/pl/sound/">; ClickTracker adds the current anchor on the click
 * (the page in another language has the same section ids). An empty hash or "#" leaves the link as it is.
 */
export function langHref(href: string, hash: string): string {
  if (!hash || hash === "#") return href;
  const bare = href.split("#")[0];
  return `${bare}${hash.startsWith("#") ? hash : `#${hash}`}`;
}

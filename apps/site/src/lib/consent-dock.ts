/** A vertical span on the screen, in CSS pixels from the top of the viewport. */
export type Span = { top: number; bottom: number };

/** Where the cookie banner stands: its usual place at the bottom, or under the sticky header. */
export type ConsentDock = "bottom" | "top";

/** The banner's place on the screen, given its height and the gap it keeps from that edge. */
export function dockSpan(dock: ConsentDock, viewportH: number, bannerH: number, bottomGap: number, headerBottom: number): Span {
  return dock === "bottom"
    ? { top: viewportH - bottomGap - bannerH, bottom: viewportH - bottomGap }
    : { top: headerBottom, bottom: headerBottom + bannerH };
}

const overlaps = (a: Span, b: Span) => a.top < b.bottom && b.top < a.bottom;

/**
 * The cookie banner never lies over the page's main button (an element marked `data-keep-clear`, e.g. the Fly by Sound
 * start on /{lang}/sound/). It stays at the bottom unless there it covers such a button on the screen; then it docks under
 * the header, if that place is clear. When both places cover a button it stays at the bottom (the page can be scrolled).
 */
export function consentDock(viewportH: number, bannerH: number, bottomGap: number, headerBottom: number, keepClear: Span[]): ConsentDock {
  const onScreen = keepClear.filter((k) => k.bottom > 0 && k.top < viewportH);
  const covers = (d: ConsentDock) => onScreen.some((k) => overlaps(dockSpan(d, viewportH, bannerH, bottomGap, headerBottom), k));
  if (!covers("bottom")) return "bottom";
  return covers("top") ? "bottom" : "top";
}

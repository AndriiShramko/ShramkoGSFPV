"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { track } from "@/lib/track";

/** The pages of the catalogue a pick is drawn from: the 200 best-liked walkable scans (5 × 40). */
const PAGE = 40;
const PAGES = 5;

/**
 * "Fly a random location": asks this site's SuperSplat catalogue proxy for a page of the best-liked
 * walkable scans (the same query every visitor makes, so it is served from the proxy's cache), picks
 * one at random and opens the simulator on it. Without JavaScript, or when the catalogue does not
 * answer, the link opens the simulator as it is (its picker has the same Random button).
 */
export default function RandomScene({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);

  async function go(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    track("fly_click");
    let target = href;
    try {
      const skip = PAGE * Math.floor(Math.random() * PAGES);
      const r = await fetch(`/api/superspl/explore?sort=starred&features=walkable&limit=${PAGE}&skip=${skip}`, { headers: { accept: "application/json" } });
      const j = (await r.json()) as { ok?: boolean; items?: { id?: string }[] };
      const ids = (j.items ?? []).map((i) => i.id).filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(id));
      if (r.ok && ids.length) target = `${href}?scene=${encodeURIComponent(ids[Math.floor(Math.random() * ids.length)])}`;
    } catch {
      /* the simulator's own picker then */
    }
    window.location.assign(target);
  }

  return (
    <a href={href} onClick={go} aria-busy={busy || undefined} data-random-scene className={className}>
      {children}
    </a>
  );
}

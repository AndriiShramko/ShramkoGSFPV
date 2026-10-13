"use client";
import { useEffect, useState } from "react";
import { readCatalog, type CatalogScene } from "@gsfpv/scenes/catalog";

/** The words of a card, from the page's dictionary (the server component passes them). */
export interface CatalogGridLabels {
  kind: Record<"interior" | "exterior" | "other", string>;
  /** "By {name}" */
  by: string;
  walls: string;
  noWalls: string;
  fly: string;
  page: string;
  /** "Preview of the scan “{title}”" */
  alt: string;
  /** translated titles of the owner's own scans by id (scenes.items) */
  titles: Record<string, string>;
}

const POSTERS = "https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat";

function poster(s: CatalogScene): string {
  return s.thumb ?? `${POSTERS}/${s.id}/v${s.version ?? 1}/m.webp`;
}

function flyHref(locale: string, s: CatalogScene): string {
  const q = new URLSearchParams({ scene: s.id });
  if (s.render?.budgetM) q.set("budget", String(s.render.budgetM));
  return `/${locale}/fly/?${q.toString()}${s.render?.stochastic ? "&stochastic" : ""}`;
}

/**
 * The published scene catalogue on the landing (owner's item 4): rendered at build time from the snapshot
 * (scripts/catalog-snapshot.mjs), so crawlers and visitors without JavaScript see every card, then refreshed
 * from /api/catalog in the browser, so a scene the owner publishes shows without a new release. Every card
 * links to its scene page (/{lang}/scenes/<id>/, rendered by the API) and straight into the simulator.
 */
export default function CatalogGrid({ initial, locale, labels }: { initial: unknown; locale: string; labels: CatalogGridLabels }) {
  const [scenes, setScenes] = useState<CatalogScene[]>(() => readCatalog(initial)?.scenes.filter((s) => !s.hidden) ?? []);
  useEffect(() => {
    let live = true;
    fetch("/api/catalog", { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((doc) => {
        const c = readCatalog(doc);
        if (live && c && c.scenes.length) setScenes(c.scenes.filter((s) => !s.hidden));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return (
    <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="catalog-grid">
      {scenes.map((s) => {
        const title = labels.titles[s.id] ?? s.title;
        const page = `/${locale}/scenes/${s.id}/`;
        return (
          <li key={s.id} className="flex flex-col overflow-hidden rounded-xl border border-line bg-bg" data-scene={s.id}>
            <a href={page} tabIndex={-1} aria-hidden="true">
              <img src={poster(s)} width={320} height={180} alt={labels.alt.replace("{title}", title)} loading="lazy" decoding="async" className="aspect-[4/3] w-full bg-surface-2 object-cover" />
            </a>
            <div className="flex flex-1 flex-col p-5">
              <p className="font-mono text-xs uppercase tracking-wider text-muted">
                {labels.kind[s.kind]}
                {s.geo?.place ? <span className="normal-case"> · {s.geo.place}</span> : null}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-ink">
                <a href={page} className="link inline-flex min-h-11 items-center">
                  {title}
                </a>
              </h3>
              <p className="mt-1 text-sm text-muted">
                {s.author ? `${labels.by.replace("{name}", s.author)} · ` : ""}
                {s.license ? `${s.license} · ` : ""}
                <span className={s.collision ? "text-accent" : "text-warn"}>{s.collision ? labels.walls : labels.noWalls}</span>
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5">
                <a href={flyHref(locale, s)} data-track="scene_open" data-p="showcase" className="btn-primary min-h-11 px-4 text-sm">
                  {labels.fly}
                  <span className="sr-only">: {title}</span>
                </a>
                <a href={page} className="link inline-flex min-h-11 items-center text-sm">
                  {labels.page}
                  <span className="sr-only">: {title}</span>
                </a>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

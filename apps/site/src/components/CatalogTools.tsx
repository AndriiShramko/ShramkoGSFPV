"use client";
import { useEffect, useRef, useState } from "react";

export type CatalogLabels = { search: string; placeholder: string; clear: string; filter: string; all: string; shown: string };

/** The same folding as SettingsCatalog's data-tc-q: lower case, no accents. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Rows the search opened by itself, so they close again when the search changes. */
const AUTO = "tcAuto";

/**
 * Search box and group chips of the settings catalogue. The rows are server-rendered (readable
 * without JavaScript, never duplicated into the client payload); this island only hides the rows
 * and group cards that do not match, by their data attributes. A search with a few hits opens
 * them, so the text that matched is in view.
 */
export default function CatalogTools({ labels, groups, total }: { labels: CatalogLabels; groups: { id: string; title: string; n: number }[]; total: number }) {
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [shown, setShown] = useState(total);

  useEffect(() => {
    const root = box.current?.closest("[data-tc-root]");
    if (!root) return;
    const words = fold(q).split(/\s+/).filter(Boolean);
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-tc-row]"));
    let n = 0;
    for (const r of rows) {
      const hit = (group === "all" || r.dataset.tcGroup === group) && words.every((w) => (r.dataset.tcQ ?? "").includes(w));
      r.hidden = !hit;
      if (hit) n++;
      const d = r.querySelector("details");
      if (d && d.dataset[AUTO] !== undefined) {
        d.open = false;
        delete d.dataset[AUTO];
      }
    }
    if (words.length && n <= 6) {
      for (const r of rows) {
        const d = r.querySelector("details");
        if (!r.hidden && d && !d.open) {
          d.open = true;
          d.dataset[AUTO] = "";
        }
      }
    }
    for (const card of Array.from(root.querySelectorAll<HTMLElement>("[data-tc-card]"))) card.hidden = !card.querySelector("[data-tc-row]:not([hidden])");
    // a column left without cards goes too, so the hits start at the left
    for (const col of Array.from(root.querySelectorAll<HTMLElement>("[data-tc-col]"))) col.hidden = !col.querySelector("[data-tc-card]:not([hidden])");
    const empty = root.querySelector<HTMLElement>("[data-tc-empty]");
    if (empty) empty.hidden = n > 0;
    setShown(n);
  }, [q, group]);

  const chip = (id: string, title: string, n: number) => (
    <button key={id} type="button" aria-pressed={group === id} onClick={() => setGroup(id)} className="chip shrink-0 gap-2 whitespace-nowrap px-3.5 text-sm aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-accent">
      {title}
      <span className="font-mono text-xs opacity-75">{n}</span>
    </button>
  );

  return (
    <div ref={box} className="relative mt-8 rounded-xl border border-line bg-surface p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-80 lg:shrink-0">
          <label htmlFor="tc-search" className="sr-only">
            {labels.search}
          </label>
          <span aria-hidden="true" className="tc-search-icon" />
          <input
            ref={input}
            id="tc-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && q) {
                e.preventDefault();
                setQ("");
              }
            }}
            placeholder={labels.placeholder}
            autoComplete="off"
            spellCheck={false}
            className="field tc-search pl-10 pr-12"
          />
          {q ? (
            <button
              type="button"
              aria-label={labels.clear}
              onClick={() => {
                setQ("");
                input.current?.focus();
              }}
              className="absolute right-0.5 top-0.5 inline-flex h-11 w-11 items-center justify-center rounded-lg text-xl text-muted hover:text-ink"
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
        <div role="group" aria-label={labels.filter} className="tc-chips -m-1 flex gap-2 overflow-x-auto p-1 sm:flex-wrap sm:overflow-visible">
          {chip("all", labels.all, total)}
          {groups.map((g) => chip(g.id, g.title, g.n))}
        </div>
      </div>
      <p role="status" className="mt-3 px-1 font-mono text-xs text-muted">
        {labels.shown.replace("{n}", String(shown)).replace("{total}", String(total))}
      </p>
    </div>
  );
}

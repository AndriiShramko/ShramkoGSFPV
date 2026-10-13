"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { buildBoard, loadLive } from "@/lib/roadmap";
import type { RoadmapStatus, ViewItem } from "@/lib/roadmap";
import { keepTogether } from "@/lib/text";

/**
 * The landing's roadmap board (section #features): counts, Done by group, In progress, Planned; a pilot's
 * idea is marked, never named. The HTML is the build-time snapshot (scripts/roadmap.mjs), so search engines
 * and visitors without JavaScript read it; when the section comes within a screen of view the board asks
 * GET /api/roadmap once and shows the owner's store as it is now. Any failure, or an answer that misses
 * most of the snapshot (a store that was never seeded: lib/roadmap.ts coversSnapshot), keeps the snapshot.
 * `data-roadmap-state`: "snapshot" (not asked yet), "live" (refreshed), "kept" (asked, snapshot kept).
 */
export type RoadmapLabels = {
  status: Record<RoadmapStatus, string>;
  count: Record<RoadmapStatus, string>;
  nowTitle: string;
  progressTitle: string;
  progressNote: string;
  plannedTitle: string;
  plannedNote: string;
  more: string;
  pilot: string;
  empty: string;
};

type State = "snapshot" | "live" | "kept";

const STATUSES: RoadmapStatus[] = ["done", "in_progress", "planned"];

/** One colour per status, the same pairs as the source chips elsewhere on the page. */
const STATUS_STYLE: Record<RoadmapStatus, { chip: string; tile: string; num: string; bar: string }> = {
  done: { chip: "border-accent/50 text-accent", tile: "border-accent/40", num: "text-accent", bar: "bg-accent" },
  in_progress: { chip: "border-warn/50 text-warn", tile: "border-warn/40", num: "text-warn", bar: "bg-warn" },
  planned: { chip: "border-line-strong text-muted", tile: "border-line-strong", num: "text-ink", bar: "bg-line-strong" },
};

function Chip({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`mt-px inline-flex shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs leading-5 ${className}`}>{children}</span>;
}

function Rows({ items, labels }: { items: ViewItem[]; labels: RoadmapLabels }) {
  if (!items.length) return <p className="mt-3 text-sm text-muted">{labels.empty}</p>;
  return (
    <ul className="mt-3 divide-y divide-line">
      {items.map((it) => (
        <li key={it.id} data-roadmap-item={it.id} data-status={it.status} className="flex items-start justify-between gap-3 py-2.5">
          <span className="text-[15px] leading-snug text-ink/90">
            {keepTogether(it.title)}
            {it.text ? <span className="mt-1 block text-sm leading-snug text-muted">{it.text}</span> : null}
          </span>
          <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {it.fromPilot ? (
              <Chip className="border-accent/30 text-ink/80">
                <span data-roadmap-pilot>{labels.pilot}</span>
              </Chip>
            ) : null}
            <Chip className={STATUS_STYLE[it.status].chip}>{labels.status[it.status]}</Chip>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Roadmap({ locale, initial, groups, labels, nowNote }: { locale: string; initial: ViewItem[]; groups: { id: string; title: string }[]; labels: RoadmapLabels; nowNote: ReactNode }) {
  const [items, setItems] = useState(initial);
  const [state, setState] = useState<State>("snapshot");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let asked = false;
    let alive = true;
    const ask = () => {
      if (asked) return;
      asked = true;
      io?.disconnect();
      void loadLive(fetch, locale, initial).then((live) => {
        if (!alive) return;
        if (live) setItems(live);
        setState(live ? "live" : "kept");
      });
    };
    const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && ask(), { rootMargin: "100% 0px" }) : null;
    if (io) io.observe(el);
    else ask();
    return () => {
      alive = false;
      io?.disconnect();
    };
  }, [initial, locale]);

  const board = buildBoard(items, groups.map((g) => g.id));
  const title = (id: string | null) => (id === null ? labels.more : (groups.find((g) => g.id === id)?.title ?? labels.more));
  return (
    <div ref={root} data-testid="roadmap" data-roadmap-state={state}>
      <div className="mt-10 max-w-2xl">
        <dl className="grid grid-cols-3 gap-3">
          {STATUSES.map((k) => (
            <div key={k} className={`flex flex-col-reverse justify-end gap-1 rounded-xl border bg-bg p-4 ${STATUS_STYLE[k].tile}`}>
              <dt className="text-sm leading-snug text-muted">{labels.count[k]}</dt>
              <dd data-roadmap-count={k} className={`font-mono text-3xl font-semibold leading-none sm:text-4xl ${STATUS_STYLE[k].num}`}>
                {board.counts[k]}
              </dd>
            </div>
          ))}
        </dl>
        <div aria-hidden="true" className="mt-3 flex h-1.5 gap-1 overflow-hidden rounded-full">
          {STATUSES.map((k) => (
            <span key={k} className={`rounded-full ${STATUS_STYLE[k].bar}`} style={{ flexGrow: board.counts[k] }} />
          ))}
        </div>
      </div>

      <h3 className="mt-14 text-2xl font-semibold text-ink">{labels.nowTitle}</h3>
      <p className="mt-2 max-w-3xl text-sm text-muted">{nowNote}</p>
      <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {board.done.map((g) => (
          <li key={g.group ?? "more"} data-roadmap-group={g.group ?? "more"} className="rounded-xl border border-line bg-bg p-5">
            <h4 className="flex items-baseline justify-between gap-3 text-lg font-semibold text-ink">
              {title(g.group)}
              <span aria-hidden="true" className="font-mono text-sm font-normal text-muted">
                {g.items.length}
              </span>
            </h4>
            <Rows items={g.items} labels={labels} />
          </li>
        ))}
      </ul>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <article aria-labelledby="features-progress" className="rounded-xl border border-warn/30 bg-bg p-5 sm:p-6">
          <h3 id="features-progress" className="flex items-center gap-3 text-2xl font-semibold text-ink">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-warn" />
            {labels.progressTitle}
          </h3>
          <p className="mt-2 text-sm text-muted">{labels.progressNote}</p>
          <Rows items={board.inProgress} labels={labels} />
        </article>
        <article aria-labelledby="features-planned" className="rounded-xl border border-line bg-bg p-5 sm:p-6">
          <h3 id="features-planned" className="flex items-center gap-3 text-2xl font-semibold text-ink">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-line-strong" />
            {labels.plannedTitle}
          </h3>
          <p className="mt-2 text-sm text-muted">{labels.plannedNote}</p>
          <Rows items={board.planned} labels={labels} />
        </article>
      </div>
    </div>
  );
}

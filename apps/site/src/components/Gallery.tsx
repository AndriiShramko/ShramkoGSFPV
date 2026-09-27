"use client";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

type Variant = { src: string; w: number; h: number };
/** `thumb`: the menu itself when the shot has a crop of it (readable small); `full`: the whole screen, shown large. */
export type GalleryItem = { id: string; t: string; d: string; open: string; phone: boolean; thumb: { small: Variant; large: Variant }; full: Variant };
export type GalleryLabels = { label: string; prev: string; next: string; close: string; count: string; phone: string };

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Every screenshot: from 1024 px up a grid of all of them (four columns), on narrower screens one
 * horizontal strip (scroll snap, no library) with Previous / Next buttons, arrow keys, Home and End
 * on the focused strip. Each picture opens large, as the whole screen, in a native modal <dialog>
 * (Esc closes it, the arrow keys step through, focus returns to the picture).
 */
export default function Gallery({ items, labels }: { items: GalleryItem[]; labels: GalleryLabels }) {
  const track = useRef<HTMLUListElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [pos, setPos] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const n = items.length;

  const cards = () => Array.from(track.current?.children ?? []) as HTMLElement[];
  const go = (i: number) => {
    const el = cards()[Math.max(0, Math.min(n - 1, i))];
    if (!el || !track.current) return;
    track.current.scrollTo({ left: el.offsetLeft, behavior: reduced() ? "auto" : "smooth" });
  };

  // the first card in view, for the counter and the buttons
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const cs = Array.from(el.children) as HTMLElement[];
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      let i = cs.findIndex((c) => c.offsetLeft + c.offsetWidth / 2 > el.scrollLeft);
      if (atEnd) i = cs.length - 1;
      setPos(Math.max(0, i));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (open !== null && d && !d.open) d.showModal();
  }, [open]);

  const onTrackKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const k = e.key;
    if (k === "ArrowRight") go(pos + 1);
    else if (k === "ArrowLeft") go(pos - 1);
    else if (k === "Home") go(0);
    else if (k === "End") go(n - 1);
    else return;
    e.preventDefault();
  };
  const step = (d: number) => setOpen((i) => (i === null ? i : (i + d + n) % n));
  const onDialogKey = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else return;
    e.preventDefault();
  };
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialog.current) dialog.current?.close();
  };
  const cur = open === null ? null : items[open];
  const count = labels.count.replace("{i}", String(pos + 1)).replace("{n}", String(n));

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between gap-4 lg:hidden">
        <p className="font-mono text-sm text-muted" aria-hidden="true">
          {count}
        </p>
        <div className="flex gap-2">
          <button type="button" className="gallery-btn" onClick={() => go(pos - 1)} disabled={pos <= 0} aria-label={labels.prev}>
            <span aria-hidden="true">←</span>
          </button>
          <button type="button" className="gallery-btn" onClick={() => go(pos + 1)} disabled={pos >= n - 1} aria-label={labels.next}>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      <ul ref={track} tabIndex={0} aria-label={labels.label} onKeyDown={onTrackKey} className="gallery-track" data-testid="gallery-track">
        {items.map((it, i) => (
          <li key={it.id} className={`gallery-card ${it.phone ? "is-phone" : ""}`} data-shot={it.id}>
            <figure>
              <button type="button" className="gallery-open" onClick={() => setOpen(i)} aria-label={it.open}>
                <img src={it.thumb.small.src} srcSet={`${it.thumb.small.src} ${it.thumb.small.w}w, ${it.thumb.large.src} ${it.thumb.large.w}w`} sizes={it.phone ? "(min-width: 1024px) 130px, (min-width: 640px) 200px, 40vw" : "(min-width: 1024px) 270px, (min-width: 640px) 440px, 82vw"} width={it.thumb.large.w} height={it.thumb.large.h} alt="" loading="lazy" decoding="async" />
                {it.phone ? <span className="gallery-tag">{labels.phone}</span> : null}
              </button>
              <figcaption className="mt-3 text-sm leading-snug">
                <span className="font-semibold text-ink lg:block">{it.t}</span>
                <span className="text-muted lg:hidden"> — </span>
                <span className="text-muted lg:mt-1 lg:line-clamp-3 lg:text-[13px]">{it.d}</span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
      <dialog ref={dialog} className="lightbox" aria-labelledby="lightbox-title" onClose={() => setOpen(null)} onClick={onBackdrop} onKeyDown={onDialogKey} data-testid="lightbox">
        {cur ? (
          <div className="lightbox-inner">
            <div className="lightbox-media">
              <img key={cur.id} src={cur.full.src} width={cur.full.w} height={cur.full.h} alt={cur.t} className={cur.phone ? "is-phone" : ""} />
            </div>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p id="lightbox-title" className="font-semibold text-ink">
                  {cur.t}
                </p>
                <p className="mt-1 text-sm text-muted">{cur.d}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className="gallery-btn" onClick={() => step(-1)} aria-label={labels.prev}>
                  <span aria-hidden="true">←</span>
                </button>
                <button type="button" className="gallery-btn" onClick={() => step(1)} aria-label={labels.next}>
                  <span aria-hidden="true">→</span>
                </button>
                <button type="button" className="gallery-btn" onClick={() => dialog.current?.close()} aria-label={labels.close} autoFocus>
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}

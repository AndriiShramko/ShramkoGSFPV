"use client";
import { useEffect } from "react";

/**
 * Scroll parallax for every [data-parallax] layer on the page. A layer moves by data-px / data-py
 * pixels (at the extremes) as its [data-parallax-host] travels through the viewport: -1 when the
 * host's top enters at the bottom, +1 when its bottom leaves at the top. Only a CSS transform
 * changes (no layout, so no layout shift), only hosts on screen are updated, at most once per
 * frame. Visitors who prefer reduced motion get the layers standing still.
 */
export default function Parallax() {
  useEffect(() => {
    const layers = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"));
    if (!layers.length) return;
    const hostOf = new Map<HTMLElement, HTMLElement>();
    for (const el of layers) hostOf.set(el, el.closest<HTMLElement>("[data-parallax-host]") ?? el.parentElement ?? el);
    const hosts = Array.from(new Set(hostOf.values()));
    const onScreen = new Set<HTMLElement>();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;

    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      for (const el of layers) {
        const host = hostOf.get(el)!;
        if (!onScreen.has(host)) continue;
        const r = host.getBoundingClientRect();
        const p = Math.max(-1, Math.min(1, ((vh - r.top) / (vh + r.height)) * 2 - 1));
        const x = Number(el.dataset.px ?? 0) * p;
        const y = Number(el.dataset.py ?? 0) * p;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) onScreen.add(e.target as HTMLElement);
          else onScreen.delete(e.target as HTMLElement);
        }
        request();
      },
      { rootMargin: "25% 0px" },
    );

    let running = false;
    const start = () => {
      if (running) return;
      running = true;
      for (const h of hosts) io.observe(h);
      window.addEventListener("scroll", request, { passive: true });
      window.addEventListener("resize", request, { passive: true });
      document.documentElement.dataset.parallax = "on";
    };
    const stop = () => {
      running = false;
      io.disconnect();
      onScreen.clear();
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (const el of layers) el.style.transform = "";
      delete document.documentElement.dataset.parallax;
    };
    const apply = () => (mq.matches ? stop() : start());
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      stop();
    };
  }, []);
  return null;
}

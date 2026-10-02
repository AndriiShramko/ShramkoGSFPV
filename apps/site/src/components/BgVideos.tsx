"use client";
import { useEffect } from "react";

type Conn = { saveData?: boolean; effectiveType?: string };
type MC = { decodingInfo?: (c: unknown) => Promise<{ supported: boolean; smooth: boolean; powerEfficient: boolean }> };

const WIDE = "(min-width: 1100px)";
const DWELL_MS = 250;
const SEEN = 0.3;
const AV1 = (w: number) => `video/mp4; codecs="av01.0.${w > 1280 ? "08" : "05"}M.08"`;

/** AV1 when the browser plays it smoothly (and, on a narrow screen, without burning the battery); else H.264. */
async function pickCodec(v: HTMLVideoElement, w: number, wide: boolean): Promise<"av1" | "h264"> {
  const type = AV1(w);
  if (!v.canPlayType(type)) return "h264";
  const mc = (navigator as Navigator & { mediaCapabilities?: MC }).mediaCapabilities;
  if (!mc?.decodingInfo) return "av1";
  try {
    const r = await mc.decodingInfo({ type: "file", video: { contentType: type, width: w, height: w / 2, bitrate: w > 1280 ? 2_400_000 : 1_200_000, framerate: 30 } });
    return r.supported && r.smooth && (r.powerEfficient || wide) ? "av1" : "h264";
  } catch {
    return "av1";
  }
}

/**
 * Starts the background videos of components/BgVideo. Nothing is fetched before the page's load
 * event; then a video gets its file only when a good part of its block has been on screen for a
 * quarter of a second (the hero's right after the load event); it plays
 * while it is there and pauses when it leaves or the tab is hidden. Reduced motion, Save-Data or a
 * 2G connection: no video at all, the
 * poster stays. 1920 px files from 1100 px CSS width up, 1280 px below.
 */
export default function BgVideos() {
  useEffect(() => {
    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("video[data-bg-video]"));
    if (!videos.length) return;
    const conn = (navigator as Navigator & { connection?: Conn }).connection;
    const lite = !!conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? "");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const near = new Set<HTMLVideoElement>();
    let io: IntersectionObserver | null = null;

    const play = (v: HTMLVideoElement) => {
      if (document.hidden || reduced.matches || !near.has(v)) return;
      v.muted = true;
      void v.play().catch(() => undefined);
    };
    const attach = async (v: HTMLVideoElement) => {
      if (v.dataset.state) return play(v);
      v.dataset.state = "loading";
      const wide = window.matchMedia(WIDE).matches;
      const widths = (v.dataset.widths ?? "1280,1920").split(",").map(Number);
      const w = wide ? widths[widths.length - 1] : widths[0];
      const codec = await pickCodec(v, w, wide);
      v.addEventListener("playing", () => v.classList.add("is-playing"), { once: true });
      v.src = `${v.dataset.bgVideo}-${w}${codec === "av1" ? ".av1" : ""}.mp4`;
      v.dataset.state = `${w}-${codec}`;
      v.preload = "auto";
      play(v);
    };
    // A block is "in view" once a good part of it is on screen: SEEN of the viewport's height, or
    // half of the block. A block whose top edge just peeks in under the first screen is not, nor one
    // only passed on the way (a jump to an anchor, a fast fling): it must stay in view for DWELL_MS.
    // A block that leaves the screen entirely pauses.
    const timers = new Map<HTMLVideoElement, number>();
    const onSeen = (entries: IntersectionObserverEntry[]) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        const seen = e.isIntersecting && e.intersectionRect.height >= Math.min(SEEN * window.innerHeight, 0.5 * e.boundingClientRect.height);
        if (seen && !near.has(v)) {
          near.add(v);
          clearTimeout(timers.get(v));
          timers.set(v, window.setTimeout(() => near.has(v) && void attach(v), DWELL_MS));
        } else if (!e.isIntersecting) {
          clearTimeout(timers.get(v));
          near.delete(v);
          v.pause();
        } else if (!seen && !v.dataset.state) {
          clearTimeout(timers.get(v));
          near.delete(v);
        }
      }
    };
    const start = () => {
      if (lite || reduced.matches || io) return;
      io = new IntersectionObserver(onSeen, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
      for (const v of videos) io.observe(v);
    };
    const stop = () => {
      for (const id of timers.values()) clearTimeout(id);
      timers.clear();
      io?.disconnect();
      io = null;
      near.clear();
      for (const v of videos) v.pause();
    };
    const onMotion = () => (reduced.matches ? stop() : start());
    const onVisible = () => {
      for (const v of videos) document.hidden ? v.pause() : play(v);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    reduced.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("load", start);
      reduced.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisible);
      stop();
    };
  }, []);
  return null;
}

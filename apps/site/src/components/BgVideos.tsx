"use client";
import { useEffect } from "react";

type Conn = { saveData?: boolean; effectiveType?: string };
type MC = { decodingInfo?: (c: unknown) => Promise<{ supported: boolean; smooth: boolean; powerEfficient: boolean }> };

const WIDE = "(min-width: 1100px)";
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
 * event; then a video gets its file only when its block is within ~one screen of the viewport
 * (the hero's at once, it is on screen), plays while it is near or on screen and pauses when it
 * leaves or the tab is hidden. Reduced motion, Save-Data or a 2G connection: no video at all, the
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
    const onSeen = (entries: IntersectionObserverEntry[]) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting) {
          near.add(v);
          void attach(v);
        } else {
          near.delete(v);
          v.pause();
        }
      }
    };
    const start = () => {
      if (lite || reduced.matches || io) return;
      io = new IntersectionObserver(onSeen, { rootMargin: "50% 0px" });
      for (const v of videos) io.observe(v);
    };
    const stop = () => {
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

"use client";
import { useEffect } from "react";

/** Pauses the hero video when the visitor prefers reduced motion (CSS then shows the poster). */
export default function HeroMotion() {
  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>("video.hero-video");
    if (!video) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (mq.matches) {
        video.pause();
        video.removeAttribute("autoplay");
      } else {
        video.muted = true;
        void video.play().catch(() => undefined);
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return null;
}

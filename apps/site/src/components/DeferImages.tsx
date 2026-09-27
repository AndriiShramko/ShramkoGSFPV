"use client";
import { useEffect } from "react";

/**
 * Pictures marked with data-srcset (ShotImage `defer`: the screenshot band and the tour, right under
 * the hero) start downloading only after the page's load event, so they never compete with the
 * hero picture for the first paint. From then on they load lazily: a picture far down the tour, or
 * a band tile outside the visible strip, is fetched only when it comes near the screen (a phone
 * does not download pictures it never scrolls to). Their boxes have a fixed aspect ratio, so the
 * swap moves nothing on the page. A swapped picture keeps data-deferred (the site checks read it).
 */
export default function DeferImages() {
  useEffect(() => {
    let idle = 0;
    const swap = () => {
      for (const img of Array.from(document.querySelectorAll<HTMLImageElement>("img[data-srcset]"))) {
        img.loading = "lazy";
        img.srcset = img.dataset.srcset ?? "";
        img.src = img.dataset.src ?? img.src;
        delete img.dataset.srcset;
        delete img.dataset.src;
        img.dataset.deferred = "";
      }
    };
    const later = () => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (w.requestIdleCallback) idle = w.requestIdleCallback(swap, { timeout: 1500 });
      else idle = window.setTimeout(swap, 300);
    };
    if (document.readyState === "complete") later();
    else window.addEventListener("load", later, { once: true });
    return () => {
      window.removeEventListener("load", later);
      const w = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (w.cancelIdleCallback) w.cancelIdleCallback(idle);
      clearTimeout(idle);
    };
  }, []);
  return null;
}

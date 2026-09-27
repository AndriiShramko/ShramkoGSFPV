import type { ShotView } from "@/lib/shots";
import { srcSet } from "@/lib/shots";

/** 1x1 transparent GIF standing in for a deferred picture until the page has loaded. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * One screenshot as a responsive <img>: the small WebP as src, both sizes in srcset, the large
 * size as width/height and as a fixed aspect ratio, so the box has its final shape before the file
 * arrives (no layout shift).
 * `defer`: the file is asked for only after the page's load event (components/DeferImages), so the
 * screenshots near the first screen never compete with the hero picture; with JavaScript off the
 * <noscript> copy shows it.
 */
export default function ShotImage({ shot, sizes, alt, className = "", eager = false, defer = false }: { shot: ShotView; sizes: string; alt: string; className?: string; eager?: boolean; defer?: boolean }) {
  const common = { sizes, width: shot.large.w, height: shot.large.h, alt, decoding: "async" as const, className, style: { aspectRatio: `${shot.large.w} / ${shot.large.h}` } };
  if (!defer) return <img src={shot.small.src} srcSet={srcSet(shot)} loading={eager ? "eager" : "lazy"} {...common} />;
  return (
    <>
      <img src={BLANK} data-src={shot.small.src} data-srcset={srcSet(shot)} {...common} />
      <noscript>
        <img src={shot.small.src} srcSet={srcSet(shot)} loading="lazy" {...common} />
      </noscript>
    </>
  );
}

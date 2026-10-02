import media from "@/generated/media.json";
import { VIDEOS } from "@/config/videos";
import type { VideoSlot } from "@/config/videos";

type Clip = { video: boolean; posters: boolean };

/**
 * A real flight looping behind a block (decorative: the scan is credited in the block's text).
 *
 * The poster is a plain <img> under the video, not the video's `poster` attribute: a poster
 * attribute is fetched as soon as the HTML is parsed, even for a block far down the page, while the
 * <img> is lazy (the hero's is the high-priority LCP picture) and responsive (800 / 1600 px).
 * The <video> carries no source at all: components/BgVideos gives it one only when the block comes
 * near the screen, after the page's load event, and never for reduced motion or Save-Data, so no
 * video byte is spent on a block nobody scrolls to. A video with no frame yet is transparent, the
 * poster shows through; the video fades in once it really plays. The box is the block's own
 * (absolute, object-fit: cover), so nothing on the page moves when the video arrives.
 * The <video> is emitted as raw HTML because React does not serialise `muted`, and mobile browsers
 * only autoplay a video that is muted in the markup.
 */
export default function BgVideo({ slot, className = "", priority = false, videoClass = "" }: { slot: VideoSlot; className?: string; priority?: boolean; videoClass?: string }) {
  const { clip } = VIDEOS[slot];
  const m = (media.videos as Record<string, Clip>)[clip];
  if (!m?.posters) return <div aria-hidden="true" className={`hero-fallback absolute inset-0 ${className}`} />;
  const [small, large] = media.posters;
  const base = `/media/${clip}`;
  const video = m.video
    ? `<video class="bg-video-el ${videoClass}" muted playsinline loop autoplay preload="none" disablepictureinpicture disableremoteplayback tabindex="-1" data-bg-video="${base}" data-widths="${media.widths.join(",")}"></video>`
    : "";
  return (
    <div aria-hidden="true" className={`bg-video absolute inset-0 ${className}`}>
      <img
        src={`${base}-poster-${small}.webp`}
        srcSet={`${base}-poster-${small}.webp ${small}w, ${base}-poster-${large}.webp ${large}w`}
        sizes="100vw"
        alt=""
        width={large}
        height={large / 2}
        loading={priority ? "eager" : "lazy"}
        {...(priority ? { fetchPriority: "high" as const } : {})}
        decoding="async"
        className="bg-video-poster"
      />
      {video ? <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: video }} /> : null}
    </div>
  );
}

import media from "@/generated/media.json";
import HeroMotion from "./HeroMotion";

/**
 * Hero background. The <video> is emitted as raw HTML because React does not serialise the
 * `muted` attribute, and mobile browsers only autoplay when `muted` is in the markup.
 * The poster is also a real high-priority <img> under the video: it is the LCP element, it is
 * what reduced-motion visitors see, and it is not delayed by the video download. With the WebP
 * copies of that frame the <img> is responsive and the video carries no poster of its own (a video
 * without a frame yet is transparent, the <img> shows through): one download instead of two.
 * No video file at build time → a plain dark gradient (no fake media).
 */
export default function HeroMedia() {
  if (!media.heroVideo) return <div aria-hidden="true" className="hero-fallback absolute inset-0" />;
  const webp = media.heroPosterWebp ?? [];
  const poster = media.heroPoster && webp.length === 0 ? ' poster="/media/hero-poster.jpg"' : "";
  const html = `<video class="hero-video" autoplay muted playsinline loop preload="auto"${poster} tabindex="-1"><source src="/media/hero.mp4" type="video/mp4"></video>`;
  return (
    <div aria-hidden="true" className="hero-media absolute inset-0">
      {webp.length ? (
        <img src={`/media/hero-poster-${webp[0]}.webp`} srcSet={webp.map((w) => `/media/hero-poster-${w}.webp ${w}w`).join(", ")} sizes="100vw" alt="" width={1280} height={720} fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      ) : media.heroPoster ? (
        <img src="/media/hero-poster.jpg" alt="" width={1280} height={720} fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: html }} />
      <HeroMotion />
    </div>
  );
}

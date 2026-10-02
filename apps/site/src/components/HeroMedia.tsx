import BgVideo from "./BgVideo";

/**
 * Hero background: a real flight along the walls of Andrii's Tunis scan (components/BgVideo). Its
 * poster is the high-priority LCP picture; the video starts after the page's load event
 * (components/BgVideos) and fades in over it. Reduced motion or Save-Data: the poster alone.
 */
export default function HeroMedia() {
  return <BgVideo slot="hero" priority videoClass="hero-video" className="hero-media" />;
}

import { shot, srcSet } from "@/lib/shots";

/**
 * A real screenshot as a section's background: dimmed under a veil (text keeps its contrast on
 * the dark ground), taller than the section so it can drift with the scroll (components/Parallax).
 */
export default function ShotBackdrop({ id, drift = 80 }: { id: string; drift?: number }) {
  const s = shot(id);
  return (
    <div aria-hidden="true" className="shot-backdrop">
      <img data-parallax data-py={drift} src={s.small.src} srcSet={srcSet(s)} sizes="100vw" width={s.large.w} height={s.large.h} alt="" loading="lazy" decoding="async" className="shot-backdrop-img" />
      <div className="shot-backdrop-veil" />
    </div>
  );
}

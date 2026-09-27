import { full, shot, srcSet } from "@/lib/shots";

/**
 * A real screenshot as a section's background: dimmed under a veil (text keeps its contrast on
 * the dark ground), taller than the section so it can drift with the scroll (components/Parallax).
 * `tone`: "voxel" tints the veil for the voxel-grid pictures (they are light grey, not photos).
 */
export default function ShotBackdrop({ id, drift = 80, tone = "photo" }: { id: string; drift?: number; tone?: "photo" | "voxel" }) {
  const s = full(shot(id));
  return (
    <div aria-hidden="true" className={`shot-backdrop ${tone === "voxel" ? "is-voxel" : ""}`}>
      <img data-parallax data-py={drift} src={s.small.src} srcSet={srcSet(s)} sizes="100vw" width={s.large.w} height={s.large.h} alt="" loading="lazy" decoding="async" className="shot-backdrop-img" />
      <div className="shot-backdrop-veil" />
    </div>
  );
}

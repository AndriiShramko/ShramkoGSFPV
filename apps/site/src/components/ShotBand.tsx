import ShotImage from "./ShotImage";
import { panel, shot } from "@/lib/shots";

// Two rows of real screenshots that slide against each other while the page scrolls. A menu shows
// as its crop (the menu itself, readable), a flight or the voxel grid as the whole screen; no
// picture appears twice. Decorative: every picture is shown again, with its caption, in the tour
// and the gallery below.
const ROW_A = ["voxels", "pause", "flight-tunis", "wizard-throttle", "drones", "voxels-only", "crash", "settings", "flight-garden", "walls"];
const ROW_B = ["keys", "cinema", "voxels-wire", "betaflight", "flight-villa", "wizard-check", "picker", "voxels-floaters", "loading", "replays"];

/** On a phone a row shows its first PHONE_TILES pictures (enough for the strip and its slide); the
 *  rest are display:none there, so a phone does not download them. */
const PHONE_TILES = 6;

function Row({ ids, px }: { ids: string[]; px: number }) {
  return (
    <div data-parallax data-px={px} className="shot-band-row flex w-max gap-3 sm:gap-4">
      {ids.map((id, i) => (
        <ShotImage key={id} shot={panel(shot(id))} defer sizes="(min-width: 1024px) 310px, (min-width: 640px) 250px, 180px" alt="" className={`h-[112px] w-auto shrink-0 rounded-lg border border-line-strong/60 bg-surface-2 object-cover sm:h-[150px] lg:h-[190px] ${i >= PHONE_TILES ? "max-sm:hidden" : ""}`} />
      ))}
    </div>
  );
}

export default function ShotBand({ label }: { label: string }) {
  return (
    <div aria-hidden="true" data-parallax-host className="shot-band relative flex flex-col items-center gap-3 overflow-hidden border-y border-line bg-surface py-5 sm:gap-4 sm:py-8">
      <Row ids={ROW_A} px={-160} />
      <Row ids={ROW_B} px={160} />
      <p className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-accent/40 bg-bg/85 px-4 py-2 font-mono text-xs text-ink shadow-lg shadow-black/50 backdrop-blur-md sm:text-sm">
        <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
        {label}
      </p>
    </div>
  );
}

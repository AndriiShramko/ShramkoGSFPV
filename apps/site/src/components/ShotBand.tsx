import ShotImage from "./ShotImage";
import { shot } from "@/lib/shots";

// Two rows of real screenshots that slide against each other while the page scrolls. Decorative
// (every picture is shown again, with its caption, in the tour and the gallery below).
const ROW_A = ["flight-tunis", "pause", "wizard-throttle", "drones", "flight-garden", "crash", "settings", "betaflight"];
const ROW_B = ["keys", "cinema", "wizard-check", "measure", "picker", "arm-card", "walls", "flight-villa"];

function Row({ ids, px }: { ids: string[]; px: number }) {
  return (
    <div data-parallax data-px={px} className="shot-band-row flex w-max gap-3 sm:gap-4">
      {ids.map((id) => (
        <ShotImage key={id} shot={shot(id)} defer sizes="(min-width: 1024px) 340px, (min-width: 640px) 270px, 200px" alt="" className="h-[112px] w-auto shrink-0 rounded-lg border border-line-strong/60 bg-surface-2 object-cover sm:h-[150px] lg:h-[190px]" />
      ))}
    </div>
  );
}

export default function ShotBand({ label }: { label: string }) {
  return (
    <div aria-hidden="true" data-parallax-host className="shot-band relative flex flex-col items-center gap-3 overflow-hidden border-y border-line bg-surface py-5 sm:gap-4 sm:py-8">
      <Row ids={ROW_A} px={-140} />
      <Row ids={ROW_B} px={140} />
      <p className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-accent/40 bg-bg/85 px-4 py-2 font-mono text-xs text-ink shadow-lg shadow-black/50 backdrop-blur-md sm:text-sm">
        <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
        {label}
      </p>
    </div>
  );
}

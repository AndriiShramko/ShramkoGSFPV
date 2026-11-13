/**
 * The animated figures of the Fly by Sound page (/{lang}/sound/): how one flies by ear, drawn for those who see.
 *
 * Every figure is decoration: the SVG is aria-hidden and the full explanation stands next to it as text, so a screen
 * reader (blind pilots are the page's first readers) misses nothing. The SVG is inline (no request, no library) and
 * holds no words, so one drawing serves the four languages. Motion comes only from the sf-* classes in
 * app/globals.css, applied under prefers-reduced-motion: no-preference; without them (reduced motion, or the CSS
 * not loaded) every element sits in its still frame, which already tells the whole story. No element blinks: a tick
 * or a hum is drawn as marks in space, a moving cursor shows time, opacity changes at most once a second.
 *
 * The numbers drawn are those of the sound package's default theme Soft (packages/sonic-fpv/themes/soft.json and
 * src/theme/schema.ts, src/cues/rules.ts, src/cues/beacon.ts, src/lesson/runner.ts at the recorded submodule):
 * height 0.5 m per scale step over steps 3 to 17; wall knocks every 1400 ms at 4 s before the hit down to 110 ms at
 * the hit (logarithmic), urgent under 1.5 s; target hum on course within 8 degrees of the nose (an octave higher).
 */
import type { ReactNode } from "react";

export type SoundFigureKind = "height" | "wall" | "hum" | "gates" | "keys";

const ACCENT = "#4ade80";
const WARN = "#e3b341";
const INK = "#e8eaed";
const MUTED = "#9ba3ae";
const LINE = "#3a424d";
const SURFACE = "#15181d";

/** A quadcopter seen from above, centred on (0, 0), nose toward -y (an accent tip). */
function Drone() {
  return (
    <g>
      <path d="M-9 -9 L9 9 M9 -9 L-9 9" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <circle cx="-9" cy="-9" r="5" fill="none" stroke={INK} strokeWidth="1.5" />
      <circle cx="9" cy="-9" r="5" fill="none" stroke={INK} strokeWidth="1.5" />
      <circle cx="-9" cy="9" r="5" fill="none" stroke={INK} strokeWidth="1.5" />
      <circle cx="9" cy="9" r="5" fill="none" stroke={INK} strokeWidth="1.5" />
      <path d="M0 -15 L-4 -8 L4 -8 Z" fill={ACCENT} />
    </g>
  );
}

/** A drone seen from the side (body, two arms, two props), centred on (0, 0). */
function SideDrone() {
  return (
    <g>
      <rect x="-10" y="-3" width="20" height="7" rx="2" fill={INK} />
      <path d="M-18 -3 L18 -3" stroke={INK} strokeWidth="2" />
      <path d="M-25 -7 L-11 -7 M11 -7 L25 -7" stroke={MUTED} strokeWidth="2" strokeLinecap="round" />
      <path d="M10 1 L15 1" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
    </g>
  );
}

/** A sine wave of `cycles` periods from (x, y), `w` wide: a low tone has few cycles, a high one many. */
function wave(x: number, y: number, w: number, cycles: number, amp: number): string {
  const n = Math.max(8, Math.round(cycles * 12));
  let d = `M${x} ${y}`;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    d += ` L${(x + w * t).toFixed(1)} ${(y - amp * Math.sin(t * cycles * 2 * Math.PI)).toFixed(1)}`;
  }
  return d;
}

/** Headphones seen from the front; `side` is the cup that sounds (filled). */
function Headphones({ x, y, side }: { x: number; y: number; side: "left" | "right" }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-14 4 A14 14 0 0 1 14 4" fill="none" stroke={MUTED} strokeWidth="2" />
      <rect x="-18" y="2" width="8" height="12" rx="3" fill={side === "left" ? WARN : "none"} stroke={side === "left" ? WARN : MUTED} strokeWidth="1.5" />
      <rect x="10" y="2" width="8" height="12" rx="3" fill={side === "right" ? WARN : "none"} stroke={side === "right" ? WARN : MUTED} strokeWidth="1.5" />
    </g>
  );
}

/** (1) Height: the drone climbs and sinks, a marker on a scale of notes moves with it; the target height is a dashed line. */
function HeightFig() {
  const steps = Array.from({ length: 15 }, (_, i) => 160 - i * 9); // scale steps 3..17, one per 0.5 m
  return (
    <>
      <path d="M12 168 L212 168" stroke={LINE} strokeWidth="2" />
      <path d="M12 79 L300 79" stroke={ACCENT} strokeWidth="1.5" strokeDasharray="5 5" opacity="0.8" />
      <circle className="sf-pulse" cx="286" cy="79" r="5" fill={ACCENT} />
      {steps.map((y) => (
        <path key={y} d={`M240 ${y} L270 ${y}`} stroke={LINE} strokeWidth="1.5" />
      ))}
      <path d={wave(240, 22, 30, 4, 4)} fill="none" stroke={MUTED} strokeWidth="1.5" />
      <path d={wave(240, 180, 30, 1, 4)} fill="none" stroke={MUTED} strokeWidth="1.5" />
      <g className="sf-rise">
        <g transform="translate(110 106)">
          <SideDrone />
        </g>
        <path d="M140 106 L246 106" stroke={WARN} strokeWidth="1" strokeDasharray="2 4" />
        <circle cx="255" cy="106" r="6" fill={WARN} />
      </g>
    </>
  );
}

/** Seconds of the wall figure's approach and the times of its knocks (the Soft theme's pulse rule). */
const WALL_S = 4;
function wallKnocks(): number[] {
  const out: number[] = [];
  for (let t = 0; t < WALL_S; ) {
    out.push(t);
    const x = Math.min(1, (WALL_S - t) / 4); // ttc / ttcFarS
    t += (110 * (1400 / 110) ** x) / 1000; // expLerp(periodNearMs, periodFarMs, x), ms -> s
  }
  return out;
}

/** (2) Wall: the drone closes on a wall to its right front; the knocks on the time strip crowd as the hit nears. */
function WallFig() {
  const x0 = 24;
  const w = 272;
  const urgentX = x0 + (w * (WALL_S - 1.5)) / WALL_S;
  return (
    <>
      <path d="M300 14 L300 116" stroke={MUTED} strokeWidth="6" />
      <path d="M306 20 L312 14 M306 40 L312 34 M306 60 L312 54 M306 80 L312 74 M306 100 L312 94" stroke={LINE} strokeWidth="2" />
      <Headphones x={40} y={22} side="right" />
      <path d="M70 130 L262 54" stroke={LINE} strokeWidth="1" strokeDasharray="3 5" />
      <g className="sf-approach">
        <g transform="translate(262 54) rotate(67)">
          <Drone />
          <path d="M8 -26 A16 16 0 0 1 24 -12 M12 -34 A24 24 0 0 1 32 -14" fill="none" stroke={WARN} strokeWidth="2" />
        </g>
      </g>
      <rect x={urgentX} y="146" width={x0 + w - urgentX} height="40" fill={WARN} opacity="0.15" />
      <path d={`M${x0} 186 L${x0 + w} 186`} stroke={LINE} strokeWidth="2" />
      {wallKnocks().map((t) => {
        const x = x0 + (w * t) / WALL_S;
        const h = 10 + 22 * (t / WALL_S);
        return <path key={t} d={`M${x.toFixed(1)} 186 L${x.toFixed(1)} ${(186 - h).toFixed(1)}`} stroke={WARN} strokeWidth="2" />;
      })}
      <path className="sf-cursor" d={`M${x0 + w} 140 L${x0 + w} 192`} stroke={INK} strokeWidth="1.5" />
    </>
  );
}

/** (3) Target hum: the drone turns until its nose (the 8 degree cone) points at the gate; the hum goes an octave up. */
function HumFig() {
  return (
    <>
      <path d="M86 36 L134 36" stroke={ACCENT} strokeWidth="5" strokeLinecap="round" />
      <path d="M96 52 A18 18 0 0 1 124 52 M88 62 A30 30 0 0 1 132 62" fill="none" stroke={ACCENT} strokeWidth="1.5" opacity="0.7" />
      <g transform="rotate(-22.6 160 160)">
        <g className="sf-turn">
          <path d="M160 160 L143 40 L177 40 Z" fill={ACCENT} opacity="0.12" />
          <path d="M160 160 L160 40" stroke={ACCENT} strokeWidth="1" strokeDasharray="3 4" />
          <g transform="translate(160 160)">
            <Drone />
          </g>
        </g>
      </g>
      <rect x="216" y="132" width="96" height="56" rx="8" fill={SURFACE} stroke={LINE} />
      <path className="sf-low" d={wave(226, 160, 76, 2, 10)} fill="none" stroke={MUTED} strokeWidth="2" opacity="0" />
      <path className="sf-high" d={wave(226, 160, 76, 4, 10)} fill="none" stroke={ACCENT} strokeWidth="2" />
    </>
  );
}

/** (4) Rings and gates: one note per gate, climbing; below, nose-first back is told, backing up is not. */
function GatesFig() {
  const gates = [90, 160, 230];
  return (
    <>
      <path d="M16 70 L300 70" stroke={LINE} strokeWidth="1.5" strokeDasharray="4 5" />
      <path d="M292 64 L302 70 L292 76" fill="none" stroke={LINE} strokeWidth="1.5" />
      {gates.map((x, i) => (
        <g key={x}>
          <path d={`M${x} 54 L${x} 86`} stroke={ACCENT} strokeWidth="5" strokeLinecap="round" />
          <circle className={`sf-note sf-note${i + 1}`} cx={x + 12} cy={36 - i * 9} r="5" fill={WARN} />
          <path className={`sf-note sf-note${i + 1}`} d={`M${x + 17} ${36 - i * 9} L${x + 17} ${20 - i * 9}`} stroke={WARN} strokeWidth="2" />
        </g>
      ))}
      <g className="sf-course">
        <g transform="translate(272 70) rotate(90)">
          <Drone />
        </g>
      </g>
      <path d="M16 112 L304 112" stroke={LINE} strokeWidth="1" />
      <path d="M160 120 L160 194" stroke={LINE} strokeWidth="1" />
      <g transform="translate(96 160) rotate(-90)">
        <Drone />
      </g>
      <path d="M70 182 L34 182 M42 176 L34 182 L42 188" fill="none" stroke={INK} strokeWidth="2" />
      <path d="M30 124 h70 a6 6 0 0 1 6 6 v20 a6 6 0 0 1 -6 6 h-46 l-10 10 v-10 h-14 a6 6 0 0 1 -6 -6 v-20 a6 6 0 0 1 6 -6 Z" fill="none" stroke={WARN} strokeWidth="2" />
      <path d="M44 140 h48 M44 148 h30" stroke={WARN} strokeWidth="2" />
      <g transform="translate(250 160) rotate(90)">
        <Drone />
      </g>
      <path d="M224 182 L188 182 M196 176 L188 182 L196 188" fill="none" stroke={INK} strokeWidth="2" />
      <path d="M194 124 h70 a6 6 0 0 1 6 6 v20 a6 6 0 0 1 -6 6 h-46 l-10 10 v-10 h-14 a6 6 0 0 1 -6 -6 v-20 a6 6 0 0 1 6 -6 Z" fill="none" stroke={LINE} strokeWidth="2" />
      <path d="M200 160 L264 120" stroke={MUTED} strokeWidth="2.5" />
    </>
  );
}

/** The keyboard rows of the keys card, and the sound mode's keys on them (the page's KEYS). */
const ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const MODE_KEYS = "TUIZGRNLK";

/** (5) The keys card: a keyboard with the nine keys of the sound mode lit, one after another. */
function KeysFig() {
  return (
    <>
      {ROWS.map((row, r) =>
        [...row].map((k, i) => {
          const x = 10 + r * 14 + i * 30;
          const y = 40 + r * 40;
          const n = MODE_KEYS.indexOf(k);
          const on = n >= 0;
          return (
            <g key={k} className={on ? `sf-key sf-key${n + 1}` : undefined}>
              <rect x={x} y={y} width="26" height="32" rx="5" fill={on ? "#173d26" : SURFACE} stroke={on ? ACCENT : LINE} strokeWidth={on ? 2 : 1} />
              <text x={x + 13} y={y + 21} textAnchor="middle" fontSize="13" fontFamily="ui-monospace, monospace" fill={on ? INK : MUTED}>
                {k}
              </text>
            </g>
          );
        })
      )}
    </>
  );
}

const DRAW: Record<SoundFigureKind, () => ReactNode> = {
  height: HeightFig,
  wall: WallFig,
  hum: HumFig,
  gates: GatesFig,
  keys: KeysFig
};

/**
 * One figure: an optional h3 (figures 1 to 4 under "What do I hear?"; the keys card sits under its own h3), the
 * drawing and its 2 or 3 sentences. On a phone the drawing comes first and the text under it; from sm side by side.
 */
export default function SoundFigure({ kind, title, text }: { kind: SoundFigureKind; title?: string; text: string[] }) {
  const Fig = DRAW[kind];
  return (
    <div className="mt-8" data-sound-figure={kind}>
      {title ? <h3 className="scroll-mt-20 text-lg font-semibold text-ink">{title}</h3> : null}
      <div className="mt-3 grid gap-4 sm:grid-cols-2 sm:items-center">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 320 200"
          className={`sound-fig sf-${kind} w-full max-w-md rounded-xl border border-line bg-surface`}
        >
          <Fig />
        </svg>
        <div className="space-y-2 text-ink/85">
          {text.map((x) => (
            <p key={x}>{x}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

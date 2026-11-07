// From the host's samples to the lines of a package (docs/wip/v12-plan.md section 4.3 step 2): 30 Hz flight frames
// out of the rendered frames, events checked before they are written. Both exist because the reader of a package is
// strict: one flight line or one event the format refuses makes the whole package unreadable, and a recording must
// not be lost to a stray number from another feature. So nothing is written that the package's own validators refuse;
// what they refuse is counted and the first reasons kept.
import type { FlightFrame, FlightSample, SessionEvent } from '@shramko/sonic-fpv';
import { MAX_CUES_PER_FRAME, validateEvent, validateFrame } from '@shramko/sonic-fpv';

export const FRAME_HZ = 30;
const INTERVAL_MS = 1000 / FRAME_HZ;
/** A sample this much early still counts as the due one: frames come at 60 Hz with jitter, and 33.0 ms is not 3 frames of 16.7. */
const EARLY_MS = 1;
const CUE_ID_MAX = 80;

/** Cue ids as the package takes them: 1 to 80 characters, at most MAX_CUES_PER_FRAME of them. */
export function cleanCues(ids: readonly unknown[] | null | undefined): string[] {
    const out: string[] = [];
    if (!ids) return out;
    for (const id of ids) {
        if (typeof id === 'string' && id.length > 0 && id.length <= CUE_ID_MAX) out.push(id);
        if (out.length >= MAX_CUES_PER_FRAME) break;
    }
    return out;
}

/** What was refused, and why: a count per reason, and the first few messages. */
export class Refusals {
    readonly counts = new Map<string, number>();
    readonly first: string[] = [];

    add(reason: string, detail: string): void {
        this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
        if (this.first.length < 5) this.first.push(`${reason}: ${detail}`);
    }

    get total(): number {
        let n = 0;
        for (const c of this.counts.values()) n += c;
        return n;
    }
}

const finite = (xs: readonly number[]): boolean => xs.every((x) => Number.isFinite(x));

/**
 * Takes every rendered frame's sample and keeps one in 30 Hz: the first sample, then the first one at or after each
 * due time, the due times 1/30 s apart however the frames fall (so 60 Hz, 144 Hz and an uneven display all average 30 Hz,
 * and a slow display keeps every sample).
 */
export class FrameSampler {
    private due: number | null = null;
    private lastT = -Infinity;
    readonly refused = new Refusals();
    kept = 0;
    seen = 0;

    /** `t`: the sample's time on the recording clock. Returns the frame to write, or null. */
    take(s: FlightSample, t: number, cues: readonly string[]): FlightFrame | null {
        this.seen++;
        if (this.due !== null && t < this.due - EARLY_MS) return null;
        const frame = this.build(s, t, cues);
        if (frame === null) return null;
        this.due = this.due === null ? t + INTERVAL_MS : this.due + INTERVAL_MS;
        if (this.due <= t) this.due = t + INTERVAL_MS; // behind (a stall): start counting from here, never burst
        this.lastT = frame.t;
        this.kept++;
        return frame;
    }

    private build(s: FlightSample, t: number, cues: readonly string[]): FlightFrame | null {
        if (!finite([t, s.tick, ...s.pos, ...s.vel, ...s.quat, ...s.sticks])) {
            this.refused.add('not-finite', `a sample at ${String(t)} holds a number that is not finite`);
            return null;
        }
        const norm = Math.hypot(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
        if (!(norm > 0.5 && norm < 1.5)) {
            this.refused.add('quaternion', `quaternion of length ${norm.toFixed(3)} at ${t.toFixed(0)} ms`);
            return null;
        }
        const clamp = (x: number): number => Math.max(-1, Math.min(1, x));
        const frame: FlightFrame = {
            // time never goes back: a frame that would is stamped as the one before it
            t: Math.max(t, this.lastT === -Infinity ? 0 : this.lastT),
            tick: Math.max(0, Math.round(s.tick)),
            p: [s.pos[0], s.pos[1], s.pos[2]],
            v: [s.vel[0], s.vel[1], s.vel[2]],
            q: [s.quat[0] / norm, s.quat[1] / norm, s.quat[2] / norm, s.quat[3] / norm],
            s: [clamp(s.sticks[0]), clamp(s.sticks[1]), clamp(s.sticks[2]), clamp(s.sticks[3])],
            c: cleanCues(cues)
        };
        const check = validateFrame(JSON.parse(JSON.stringify(frame)));
        if (!check.ok) {
            this.refused.add('frame', check.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
            return null;
        }
        return frame;
    }
}

/** Does the package's own reader take this event? Returns null when yes, else the reasons. */
export function eventProblem(e: SessionEvent): string | null {
    let plain: unknown;
    try {
        plain = JSON.parse(JSON.stringify(e));
    } catch {
        return 'not JSON';
    }
    const check = validateEvent(plain);
    return check.ok ? null : check.issues.map((i) => `${i.path === '' ? e.kind : i.path}: ${i.message}`).join('; ');
}

/**
 * Which events of the bus are written in each phase of a recording. While it records: all of them (the replay's
 * markers included: lesson open, the key events with reset and next actions, the speech.end events). After the pilot
 * stopped it, while the survey runs: only speech, since a touch or a gate after the last frame is something the replay
 * can never re-derive, and the comparer would call it missing.
 */
export function busEventWanted(e: SessionEvent, phase: 'recording' | 'closing'): boolean {
    if (phase === 'recording') return true;
    return e.kind === 'speech';
}

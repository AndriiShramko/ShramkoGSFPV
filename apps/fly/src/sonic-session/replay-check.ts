// The replay check of a recording (docs/wip/v12-plan.md section 4.3 step 5): the sound package's replay core re-derives the lesson's
// events and the cues from the recorded frames, and its comparer holds them to what the recording says, with its tolerances. This file
// runs the same computation as the package's `checkSession` (a test holds the two equal), in pieces: a ten-minute flight is 18 000 frames,
// and the page must stay alive while they are re-played, so the work yields to the browser every few hundred frames.
import { DEFAULT_TOLERANCES, ReplayError, Replayer, compareReplay, formatReplayCheck, rebuildSession } from '@shramko/sonic-fpv';
import type { CheckOptions, FlightFrame, ReplayCheck, ReplaySetup, SessionEvent, SessionManifest } from '@shramko/sonic-fpv';

export interface CheckedPackage {
    readonly manifest: SessionManifest;
    readonly frames: readonly FlightFrame[];
    readonly events: readonly SessionEvent[];
}

export interface ReplayOutcome {
    /** null when the session could not be rebuilt at all (an unknown lesson, a scan with no world given, no frames) */
    readonly setup: ReplaySetup | null;
    readonly check: ReplayCheck | null;
    /** the package's own one-line report of the check (English; the panel shows a sentence of its own and keeps this for the details) */
    readonly line: string;
    readonly error: { readonly code: string; readonly message: string } | null;
    /** how long the check took, ms */
    readonly tookMs: number;
}

export interface CheckRun extends CheckOptions {
    /** frames between two looks at the browser (default 240) */
    readonly yieldEvery?: number;
    readonly yieldFn?: () => Promise<void>;
    readonly now?: () => number;
}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function checkPackage(pkg: CheckedPackage, run: CheckRun = {}): Promise<ReplayOutcome> {
    const now = run.now ?? ((): number => performance.now());
    const t0 = now();
    const failed = (code: string, message: string): ReplayOutcome => ({ setup: null, check: null, line: '', error: { code, message }, tookMs: now() - t0 });
    if (pkg.frames.length === 0) return failed('frames', 'the recording has no flight frames');
    let setup: ReplaySetup;
    try {
        setup = rebuildSession(pkg.manifest, run);
    } catch (e) {
        if (e instanceof ReplayError) return failed(e.code, e.message);
        throw e;
    }
    const replayer = new Replayer({ setup, frames: pkg.frames, events: pkg.events, ...(run.progress === undefined ? {} : { progress: run.progress }), ...(run.seed === undefined ? {} : { seed: run.seed }) });
    const every = Math.max(1, run.yieldEvery ?? 240);
    const yieldFn = run.yieldFn ?? nextTask;
    for (let n = 1; replayer.step() !== null; n++) if (n % every === 0) await yieldFn();
    const check = compareReplay(pkg, replayer.result(), setup.exact, { ...DEFAULT_TOLERANCES, ...run.tolerances });
    return { setup, check, line: formatReplayCheck(check), error: null, tookMs: now() - t0 };
}

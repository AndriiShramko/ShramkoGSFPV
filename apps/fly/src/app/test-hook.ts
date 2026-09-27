// window.__gsfpv: what the acceptance harnesses (tools/bench) read and drive. Set when the page
// loads, filled in as the flight comes up; the shapes are the harnesses' contract.
import type { InputLog, SimEvent } from '@gsfpv/sim-core';
import type { Scenario } from '@gsfpv/input/sim';
import type { FrameGovernor } from '@gsfpv/render-pc';
import type { RecorderInfo } from '../cinema';
import type { FlightSession } from '../session';
import type { Controls } from '../controls';
import type { RadioScreen } from '../ui/radio';
import type { FakeEdgeTx } from '../devices/fakehid';
import type { TouchSticks } from '../devices/touch';
import type { CrashView } from '../crashview';

export interface SavedLog {
    label: string;
    header: InputLog['header'];
    bytes: Uint8Array;
    endTick: number;
    hash: string;
}

export interface TestHook {
    status: 'loading' | 'picker' | 'ready' | 'error';
    error?: string;
    errorCode?: string;
    /** the loading screen's numbers (bytes of the first view), updated every 100 ms until 'done' */
    loading?: { stage: string; loaded: number; total: number; fraction: number; exact: boolean; elapsedMs: number };
    session?: FlightSession;
    scenario?: Scenario;
    controls?: Controls;
    radio?: RadioScreen;
    fake?: FakeEdgeTx;
    touch?: TouchSticks;
    crash?: CrashView;
    info?: Record<string, unknown>;
    lastCrash?: Record<string, unknown> | null;
    events: SimEvent[];
    savedLogs: SavedLog[];
    saveLog?: (label: string) => SavedLog;
    /** B15: replay the log saved in localStorage (optionally with one LSB flipped) in this tab */
    verifyLastLog?: (tamper?: { record: number; channel: number }) => { saved: string; endTick: number; hash: string; track: number[]; tampered: number | null } | null;
    loops?: number;
    /** phase C: result of building collision in this tab */
    bake?: Record<string, unknown>;
    bakedBytes?: { json: Uint8Array; bin: Uint8Array };
    runBake?: () => Promise<void>;
    /** save the baked collision as two downloads (acceptance runs the Node tunnelling harness on it) */
    downloadBaked?: () => boolean;
    /** phase D: the exported trajectory as text (the same text the export button saves) */
    trajectoryText?: (kind: 'csv' | 'json') => string;
    governor?: FrameGovernor;
    setFrameDelay?: (ms: number) => void;
    /** phase D: import rates and PID from a Betaflight CLI diff (the same path as the import panel) */
    importDiff?: (text: string) => { ok: boolean; firmware?: string | null; ratesType?: string; warnings?: string[]; errors?: string[] };
    /** phase D: cinema mode and the recorder */
    cinema?: { on: () => boolean; toggle: () => void; canRecord: boolean; start: () => Promise<string>; stop: () => Promise<RecorderInfo | null>; last: RecorderInfo | null; lastBytes: Uint8Array | null; creditStripStd: () => number };
}

export const hook: TestHook = { status: 'loading', events: [], savedLogs: [] };
(window as unknown as { __gsfpv: TestHook }).__gsfpv = hook;

/** How many runner events the hook keeps (the harnesses read the recent ones). */
const EVENTS_KEPT = 500;

/** Every runner event, newest last. */
export function keepEvent(e: SimEvent): void {
    hook.events.push(e);
    if (hook.events.length > EVENTS_KEPT) hook.events.shift();
}

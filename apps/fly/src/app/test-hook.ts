// window.__gsfpv: what the acceptance harnesses (tools/bench) read and drive. The shape is the one
// main.ts had before the v0.3 split; the features fill their parts when they install.
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
import type { WallsHook } from '../walls';
import type { VoxelController, VoxelMode, VoxelStats, VoxelStyle } from '../voxels';
import type { PrefsHook } from './prefs';

export interface SavedLog {
    label: string;
    header: InputLog['header'];
    bytes: Uint8Array;
    endTick: number;
    hash: string;
}

export interface TestHook {
    status: 'loading' | 'picker' | 'ready' | 'error';
    /** the page's preferences store (app/prefs.ts), from the picker on */
    prefs?: PrefsHook;
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
    /** the walls in use, the refine, the walls store (walls.ts) */
    walls?: WallsHook;
    /** the pilot's walls switch (C): on / off, and the current log header that records it */
    wallsSwitch?: { on: () => boolean; set: (on: boolean) => void; state: () => string; header: () => InputLog['header'] };
    /** the voxel grid (V): mode, style, opacity, what is drawn */
    voxels?: { stats: () => VoxelStats; perf: () => VoxelController['perf']; settled: () => boolean; setMode: (m: VoxelMode) => void; setStyle: (s: VoxelStyle) => void; setOpacity: (a: number) => void; setRadius: (m: number) => void };
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

/** Every runner event, the last 500 (acceptance reads crashes and contacts from here). */
export function keepEvent(e: SimEvent): void {
    hook.events.push(e);
    if (hook.events.length > 500) hook.events.shift();
}

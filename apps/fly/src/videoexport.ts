// The video export from the flight log (docs/architecture-v03.md F.3; item 19, D34): "Save this
// flight as video (60 fps)". The life is replayed from its log at exactly one frame per 1/60 s of
// flight time; each frame is drawn on demand and encoded only once the engine drew it with the scan
// complete for that view (nothing loading, every level of detail in place: the gsplat
// 'frame:ready'), so the file is the clean 60 fps a live recording cannot be (a live one repeats
// what the screen missed). The flight model is the log's own (LivesPlayer: params and walls from
// each life's header); the scan is drawn under the transform the life was flown at (its header,
// then each world record, E.7); a crash is drawn by a CrashView on this replay's clock.
//
// Nothing here touches the DOM or a clock: the engine, the camera and the encoder come in through
// small interfaces, so tools/bench/test/video-export.test.ts drives it with fakes.
import { S } from '@gsfpv/sim-core';
import type { Life, Sim, SimEvent } from '@gsfpv/sim-core';
import { LivesPlayer } from './session/replay';
import type { WallsSource } from './session/replay';

export type ExportSize = '1080p' | '1440p' | '2160p';

/** The sizes offered (16:9, what an editor's timeline expects); the canvas draws at exactly this size meanwhile. */
export const EXPORT_SIZES: Readonly<Record<ExportSize, { w: number; h: number }>> = {
    '1080p': { w: 1920, h: 1080 },
    '1440p': { w: 2560, h: 1440 },
    '2160p': { w: 3840, h: 2160 }
};

export const EXPORT_FPS = 60;

/** Frames of `durationTicks` ms of flight at `fps`: frame k shows k/fps s (300 for 5 s at 60; ticks x fps first, so no period is rounded). */
export function exportFrameCount(durationTicks: number, fps: number = EXPORT_FPS): number {
    return Math.max(0, Math.floor((Math.max(0, durationTicks) * fps + 1e-6) / 1000));
}

/** The sim tick (1 ms) frame k shows: the nearest tick to k/fps s after the start. */
export function exportFrameTick(startTick: number, k: number, fps: number = EXPORT_FPS): number {
    return startTick + Math.round((k * 1000) / fps);
}

/** The engine as the export sees it (render-pc's SplatRenderer has these). */
export interface ExportEngine {
    /** engine frames begun so far */
    readonly frameNumber: number;
    /** in 'frameend': the frame just drawn shows the scan complete for its view */
    readonly sceneComplete: boolean;
}

/** Where the replayed flight is shown: the FPV camera, the crash view, the scan's transform. */
export interface ExportView {
    /** before each tick while no crash is shown: remember the camera for a crash (CrashView.trackCamera) */
    beforeStep(): void;
    /** a crash in the replay: the crash view takes the camera (it may load Rapier first) */
    crash(e: Extract<SimEvent, { type: 'crash' }>): Promise<void>;
    /** a new life (a respawn): the crash view lets the camera go */
    respawn(): void;
    /** the scene transform [s, tx, ty, tz] the life is at */
    transform(t: readonly [number, number, number, number]): void;
    /** place the camera for this state; `ms` is the replay's clock (flight time since the start) */
    show(sim: Sim, ms: number): void;
    /** the camera's position as drawn (the acceptance compares it with the replayed pose) */
    camera(): [number, number, number];
}

/** The encoder in exact mode (CinemaRecorder.canTake / addExact). */
export interface ExportSink {
    readonly canTake: boolean;
    /** encode the frame just drawn as the next one; false when it did not go in */
    take(): boolean;
}

/** A frame as encoded: its index, the tick it shows, the replayed pose there and the camera as drawn. */
export interface ExportPose {
    k: number;
    tick: number;
    p: [number, number, number];
    q: [number, number, number, number];
    cam: [number, number, number];
    crash: boolean;
}

export interface LogExportOptions {
    fromTick: number;
    toTick: number;
    /** frames a second of the file (the slots are k/60 s) */
    fps?: number;
    /**
     * Test only, the negative control of F.5: the replay steps 1/stepFps s per frame while the file
     * is stamped at `fps` (a wrong step: 1/30 s gives half the frames and the wrong poses).
     */
    stepFps?: number;
    /** Test only (control): encode frames whatever the scan's state. */
    ignoreScene?: boolean;
}

export type ExportStep = 'wait' | 'took' | 'done';

/**
 * One export: call prepare() to place frame 0, then onFrameEnd() in every engine 'frameend'; after
 * 'took' call prepare() for the next frame; 'done' after the last one.
 */
export class LogExport {
    readonly frames: number;
    readonly startTick: number;
    readonly endTick: number;
    readonly fps: number;
    readonly stepFps: number;
    /** the next frame to encode */
    k = 0;
    /** frames drawn that were not encoded: the scan still loading, the pose not drawn yet, the encoder behind */
    waited = 0;
    /** of those, frames drawn with the scan incomplete */
    incomplete = 0;
    /** frames encoded with the scan incomplete (0 unless ignoreScene) */
    encodedIncomplete = 0;
    first: ExportPose | null = null;
    last: ExportPose | null = null;
    crashes = 0;
    private readonly player: LivesPlayer;
    private readonly ignoreScene: boolean;
    private prepared = false;
    private preparing: Promise<void> | null = null;
    private prepFrame = -1;
    private crashShown = false;
    private events: SimEvent[] = [];

    constructor(lives: readonly Life[], walls: WallsSource, o: LogExportOptions, private readonly engine: ExportEngine, private readonly view: ExportView, private readonly sink: ExportSink) {
        this.fps = o.fps ?? EXPORT_FPS;
        this.stepFps = o.stepFps ?? this.fps;
        this.ignoreScene = o.ignoreScene === true;
        const first = lives.findIndex((l) => l.endTick > o.fromTick);
        const from = lives.slice(Math.max(0, first));
        this.player = new LivesPlayer(from, walls, o.toTick);
        // to the start (a snapshot may begin later than asked): what happened before is not shown
        this.player.stepTo(Math.max(o.fromTick, from[0].header.life.startTick));
        this.player.onEvent = (e) => this.events.push(e);
        this.startTick = this.player.sim.tick;
        this.endTick = this.player.endTick;
        this.frames = exportFrameCount(this.endTick - this.startTick, this.stepFps);
    }

    /** The replayed model now (the crash view follows it). */
    get sim(): Sim {
        return this.player.sim;
    }

    /** The scene transform [s, tx, ty, tz] the replayed life is at now. */
    get transform(): readonly [number, number, number, number] {
        return this.player.transform;
    }

    /** The replay's clock, ms of flight since the start: what the crash view is driven by. */
    get clockMs(): number {
        return this.player.sim.tick - this.startTick;
    }

    get done(): boolean {
        return this.k >= this.frames;
    }

    /** Steps the replay to frame k's tick and places the camera. Async only when a crash shows (Rapier). */
    prepare(): Promise<void> {
        if (this.preparing) return this.preparing;
        this.prepared = false;
        const p = this.step().then(() => {
            this.preparing = null;
            this.prepared = true;
            this.prepFrame = this.engine.frameNumber;
        });
        this.preparing = p;
        return p;
    }

    private async step(): Promise<void> {
        const pl = this.player;
        const target = exportFrameTick(this.startTick, this.k, this.stepFps);
        while (pl.sim.tick < target && pl.sim.tick < this.endTick) {
            if (!this.crashShown) this.view.beforeStep();
            const before = pl.sim;
            pl.stepTo(pl.sim.tick + 1);
            // the next life (a model of its own, from its header): as a respawn in flight
            if (pl.sim !== before && this.crashShown) {
                this.crashShown = false;
                this.view.respawn();
            }
            const evs = this.events.splice(0);
            for (const e of evs) {
                if (e.type === 'crash') {
                    this.crashes++;
                    this.crashShown = true;
                    await this.view.crash(e);
                } else if (e.type === 'respawn') {
                    this.crashShown = false;
                    this.view.respawn();
                }
            }
        }
        this.view.transform(pl.transform);
        this.view.show(pl.sim, this.clockMs);
    }

    /** In the engine's 'frameend', right after it drew: encode this frame when it shows frame k complete. */
    onFrameEnd(): ExportStep {
        if (this.done) return 'done';
        // the pose was set after this frame began: it is the next one that shows it
        if (!this.prepared || this.engine.frameNumber <= this.prepFrame) return 'wait';
        const complete = this.engine.sceneComplete;
        if (!complete) this.incomplete++;
        if ((!complete && !this.ignoreScene) || !this.sink.canTake || !this.sink.take()) {
            this.waited++;
            return 'wait';
        }
        if (!complete) this.encodedIncomplete++;
        const s = this.player.sim.s;
        const pose: ExportPose = {
            k: this.k, tick: this.player.sim.tick,
            p: [s[S.px], s[S.py], s[S.pz]], q: [s[S.qw], s[S.qx], s[S.qy], s[S.qz]],
            cam: this.view.camera(), crash: this.crashShown
        };
        this.first ??= pose;
        this.last = pose;
        this.k++;
        this.prepared = false;
        return this.done ? 'done' : 'took';
    }
}

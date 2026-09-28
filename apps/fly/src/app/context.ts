// What every feature of the flight page installs into (docs/architecture-v03.md 1.1). The shell
// (flight.ts) builds one FlightContext per flight and installs FEATURES (features.ts) into it; a
// feature owns its files and reaches the others only through this object and its events.
import type { SimEvent, RespawnReason } from '@gsfpv/sim-core';
import type { ActionId, PrefsStore } from '@gsfpv/prefs';
import type { SplatRenderer } from '@gsfpv/render-pc';
import type { FlightSession } from '../session';
import type { Controls } from '../controls';
import type { CrashView } from '../crashview';
import type { VoxelController } from '../voxels';
import type { Hud } from '../ui/hud';
import type { ShowcaseScene } from '../ui/scenes';
import type { WallsSwitch } from '../ui/voxels';
import type { KeyRouter } from './keys';
import type { InputHost } from './input';
import type { Quality } from './quality';
import type { TestHook } from './test-hook';

/**
 * Why the flight is paused. It runs again only when every reason is released (pause-stack.ts), so
 * closing one screen cannot start the flight under another. Wave 1 uses menu (the pause menu),
 * panel (a screen opened from it: settings, drones, replays, measurements, import), controls (the
 * Controls screen) and scene (leaving for the scene picker); hidden and export are for wave 2-4.
 */
export type PauseReason = 'menu' | 'panel' | 'hidden' | 'scene' | 'export' | 'controls';

export interface AppEvents {
    /** every runner event, in order */
    sim: SimEvent;
    /** once per rendered frame, after the shell's own frame work (quality, input, voxels, crash view, HUD) */
    frame: { now: number };
    /** a new life of the flight model (wave 2: respawns); not emitted in wave 1 */
    life: { index: number; reason: RespawnReason | 'start' };
    /** a new scene session (E.4 scene switching); not emitted in wave 1 */
    session: FlightSession;
    pause: { on: boolean; reasons: readonly PauseReason[] };
    /** the walls were switched on or off (C, the switch): the new flight model is in already */
    walls: { on: boolean };
    /** back from a crash to flying (ctx.clearCrash): whatever shows the crash takes it away */
    crashCleared: null;
}

/** The scene flown: its id and, for a showcase scene, its title, author, licence and walls default. */
export interface SceneRef {
    id: string;
    meta?: ShowcaseScene;
}

/** The pilot's walls switch for this scan (app/walls.ts); the UI block and C both use it. */
export interface WallsHost extends WallsSwitch {
    /** `remember` (default true): keep the choice for this scan (the test hook's set does not) */
    set(on: boolean, remember?: boolean): void;
}

export interface FlightContext {
    readonly ui: HTMLElement;
    readonly canvas: HTMLCanvasElement;
    /** created once per page by the flight session today; the shell keeps it across scenes in E.4 */
    readonly renderer: SplatRenderer;
    /**
     * The preferences store (@gsfpv/prefs). null until the lead wires it (the contract step before
     * wave 2: a store on LocalStorageBackend, migration run, __gsfpv.prefs); nothing reads it yet.
     */
    readonly prefs: PrefsStore | null;
    /** replaced on scene switch (E.4); listen to events.session */
    session: FlightSession;
    /** replaced with the session */
    scene: SceneRef;
    readonly controls: Controls;
    /** the input in use and its screen: the Controls screen, the keyboard, the touch sticks */
    readonly input: InputHost;
    readonly crash: CrashView;
    readonly hud: Hud;
    readonly keys: KeyRouter;
    readonly menu: MenuRegistry;
    readonly events: Bus<AppEvents>;
    readonly hook: TestHook;
    /** the frame governor, the settings' quality ceiling and cinema's full detail */
    readonly quality: Quality;
    readonly walls: WallsHost;
    /** the voxel grid (V); the walls block in the walls menu and in settings shows it too */
    readonly voxels: VoxelController;
    /** a pause stack: resumes only when every reason is released */
    pause(reason: PauseReason): void;
    resume(reason: PauseReason): void;
    /** Back from a crash to flying (v0.2 afterCrashCleared): the crash panel goes, the crash camera hands the view back, a replay stops. */
    clearCrash(): void;
}

/** A feature installs its parts into the context; the returned function (if any) takes them out again. */
export interface Feature { id: string; install(ctx: FlightContext): (() => void) | void }

export interface MenuItem { id: string; action: ActionId | null; labelKey: string; order: number; section: 'flight' | 'scene' | 'setup' | 'tools'; run(): void; enabled?(): boolean }

/**
 * The pause menu's items, and the menu that shows them. `id` is the item's data-action on the page.
 * Picking an item closes the menu, runs the item, then releases the 'menu' pause: an item that opens
 * a screen takes that screen's own pause reason inside run(), so the flight never runs in between.
 * While the menu is up, a key shown beside an item runs that item.
 */
export interface MenuRegistry {
    add(item: MenuItem): () => void;
    items(): readonly MenuItem[];
    readonly isOpen: boolean;
    /** P, Esc, the Pause button, a hidden tab; nothing while another dialog is up */
    open(): void;
    /** close without running an item (the panel's x, or the Controls screen taking over) */
    close(): void;
}

/** Synchronous typed events: listeners run in the order they subscribed. */
export class Bus<E> {
    private map = new Map<keyof E, ((v: never) => void)[]>();

    on<K extends keyof E>(k: K, cb: (v: E[K]) => void): () => void {
        const list = this.map.get(k) ?? [];
        list.push(cb as (v: never) => void);
        this.map.set(k, list);
        return () => {
            const i = list.indexOf(cb as (v: never) => void);
            if (i >= 0) list.splice(i, 1);
        };
    }

    emit<K extends keyof E>(k: K, v: E[K]): void {
        // a copy: a listener that unsubscribes (or subscribes) while this runs does not shift the rest
        for (const cb of [...(this.map.get(k) ?? [])]) (cb as (v: E[K]) => void)(v);
    }
}

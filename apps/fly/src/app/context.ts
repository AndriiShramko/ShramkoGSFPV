// What every feature of the flight page installs into (docs/architecture-v03.md 1.1). The shell
// (flight.ts) builds one FlightContext per flight and installs FEATURES into it; a feature owns its
// files and reaches the others only through this object and its events.
import type { SimEvent, RespawnReason } from '@gsfpv/sim-core';
import type { ActionId, PrefsStore } from '@gsfpv/prefs';
import type { SplatRenderer } from '@gsfpv/render-pc';
import type { FlightSession } from '../session';
import type { Controls } from '../controls';
import type { CrashView } from '../crashview';
import type { Hud } from '../ui/hud';
import type { ShowcaseScene } from '../ui/scenes';
import type { KeyRouter } from './keys';
import type { InputHost } from './input';
import type { TestHook } from './test-hook';

/**
 * Why the flight is paused. The flight runs again only when every reason is released, so closing
 * one screen cannot start the flight under another. `bake`: walls are being built from the splats.
 */
export type PauseReason = 'menu' | 'panel' | 'hidden' | 'scene' | 'export' | 'controls' | 'bake';

export interface AppEvents {
    sim: SimEvent;                      // every runner event, in order
    frame: { now: number };
    life: { index: number; reason: RespawnReason | 'start' };
    session: FlightSession;             // a new scene session (E.4)
    pause: { on: boolean; reasons: readonly PauseReason[] };
}

/** The scene flown: its id and, for a showcase scene, its title, author and licence. */
export interface SceneRef { id: string; meta?: ShowcaseScene }

export interface FlightContext {
    readonly ui: HTMLElement;
    readonly canvas: HTMLCanvasElement;
    readonly renderer: SplatRenderer;   // created once by the shell (E.4)
    /** null until the lead wires the store (the contract step before wave 2) */
    readonly prefs: PrefsStore | null;
    session: FlightSession;             // replaced on scene switch; listen to events.session
    scene: SceneRef;                    // replaced with the session
    readonly controls: Controls;
    /** the input in use and its screens: the Controls screen, keyboard, touch sticks */
    readonly input: InputHost;
    readonly crash: CrashView;
    readonly hud: Hud;
    readonly keys: KeyRouter;
    readonly menu: MenuRegistry;
    readonly events: Bus<AppEvents>;
    readonly hook: TestHook;
    pause(reason: PauseReason): void;   // a pause stack: resumes only when every reason is released
    resume(reason: PauseReason): void;
}

export interface Feature { id: string; install(ctx: FlightContext): (() => void) | void }

export interface MenuItem { id: string; action: ActionId | null; labelKey: string; order: number; section: 'flight' | 'scene' | 'setup' | 'tools'; run(): void; enabled?(): boolean }

/**
 * The pause menu's items, and the surface that shows them. `id` is the item's data-action in the
 * page. Picking an item closes the menu, runs the item, then releases the 'menu' pause: an item
 * that opens a screen takes that screen's own pause reason inside run(), so the flight never runs
 * in between. While the menu is up, a key shown beside an item runs that item.
 */
export interface MenuRegistry {
    add(item: MenuItem): () => void;
    items(): readonly MenuItem[];
    readonly isOpen: boolean;
    open(): void;
    /** close without running an item (the panel's x, or another screen taking over) */
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

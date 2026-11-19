// The course editor's seam (design C:/dev/.gsfpv-lanes/designs/edit4.md, section 1.1, "Shared contract"): the named events,
// services and calls through which the editor's parts (course/editor/parts/*.ts) talk to the hub (app/builtin/course.ts)
// and to each other. The types are the contract as the design wrote it; SeamBus is the one event and service registry the
// hub builds its EditorSeam on. No DOM here.
//
// Lane edit4b wrote this file because stage S0 (which was to write it before the four parts branched) was never built:
// the types are the design's, member for member, so another part written against the same contract fits.
import type { TrackFile, TrackGate } from '@shramko/sonic-fpv';
import type { VoxelCollision } from '@gsfpv/collision';
import type { Course, CourseProblem, EditAction, EditOutcome, EditorState } from '@gsfpv/tracks';
import type { FlownPose, Q4, V3 } from './drag';
import type { FlownTransform } from './check-core';

export type Gate = TrackGate;
export type Handle = 'move' | 'turn' | 'size';
export type HandleAxis = 'x' | 'y' | 'z' | 'xyz';
export type ChangeBy = EditAction['kind'] | 'drag' | 'fix' | 'piece' | 'clear' | 'new' | 'restore' | 'generate';
export type SelectBy = 'click' | 'key' | 'add' | 'point' | 'undo' | 'open';
export type PointReason = 'problem' | 'fixed' | 'added' | 'message';

export interface DragEvent {
    readonly phase: 'start' | 'move' | 'end' | 'cancel';
    readonly index: number;
    readonly id: string;
    readonly handle: Handle;
    readonly axis: HandleAxis;
    /** the stand-in now (flown frame) */
    readonly pose: FlownPose;
    /** the gate when the press began */
    readonly base: FlownPose;
}

export interface SaveProblem {
    readonly status: number | null;
    readonly code: string;
    readonly detail: string;
    readonly retryAfterS: number | null;
}

export interface EditorEvents {
    /** index -1: none (empty course) */
    selected: { index: number; id: string | null; by: SelectBy };
    /** after every accepted change (one undo step) */
    changed: { course: Course; by: ChangeBy };
    drag: DragEvent;
    problems: { problems: readonly CourseProblem[] };
    mode: { mode: 'edit' | 'fly' };
    opened: { course: Course; source: 'generated' | 'server' | 'new' | 'draft' };
    closed: Record<string, never>;
    /** once per drawn frame in mode 'edit' */
    frame: { w: number; h: number };
    saveRefused: { problems: readonly CourseProblem[] };
    saveFailed: { problem: SaveProblem; draftKept: boolean };
    saved: { id: string; version: number };
}

/** A step that drops the pilot's gates: what it is, how many gates go, whether they were saved. */
export interface LossQuestion {
    readonly what: 'generate' | 'clear' | 'new' | 'open-other' | 'restore';
    readonly gates: number;
    readonly unsaved: boolean;
}

export interface MenuItem {
    readonly id: string;
    readonly labelKey: string;
    readonly run: () => void;
}

export interface GateBarButton {
    readonly id: string;
    readonly labelKey: string;
    readonly path: string;
    readonly run: () => void;
}

/** Services: provided by one part, called by any. */
export interface Services {
    frameSelection(): void;
    frameAll(): void;
    /** select (no camera move), flash, edge arrow */
    pointAt(index: number, reason: PointReason): void;
    /** true: go on and drop the work; false: keep it */
    confirmLoss(q: LossQuestion): Promise<boolean>;
    /** true: the drone is armed at the start and flies the course; false: back to editing (disarm) */
    testFlight(on: boolean): void;
    saveFlow(): Promise<void>;
    placeFor(click: { o: V3; d: V3; hit: number | null }): { pos: V3; quat: Q4; after: number };
    pieceMenu(): readonly MenuItem[];
}

export interface EditorSeam {
    on<K extends keyof EditorEvents>(k: K, f: (e: EditorEvents[K]) => void): () => void;
    emit<K extends keyof EditorEvents>(k: K, e: EditorEvents[K]): void;
    provide<K extends keyof Services>(k: K, f: Services[K]): void;
    call<K extends keyof Services>(k: K, ...a: Parameters<Services[K]>): ReturnType<Services[K]>;
    state(): EditorState | null;
    flown(): FlownTransform;
    scale(): number;
    sceneId(): string;
    /** flown-frame walls or null before they load */
    walls(): VoxelCollision | null;
    ray(o: V3, d: V3, max: number): number | null;
    /** CSS px x, y and depth; null behind the eye */
    project(p: V3): [number, number, number] | null;
    /** one undo step; emits changed/selected */
    apply(a: EditAction, by: ChangeBy): EditOutcome;
    /** one undo step (EditAction 'replace') */
    replace(gates: readonly Gate[], by: ChangeBy, selected?: number): void;
    /** NEVER moves the camera */
    select(index: number, by: SelectBy): void;
    /** new identity: source 'new', saved null, changed true */
    startNew(course: TrackFile): void;
    saveNow(name: string, title: string): Promise<{ ok: true; id: string; version: number } | { ok: false; problem: SaveProblem }>;
    /** the edited course as a file */
    trackNow(): TrackFile;
    /** a new generated course; no question (the caller asks first) */
    generate(seed: number | null): void;
    /** top-bar line; 'problem' stays until the next action */
    say(text: string, level: 'did' | 'warn' | 'problem'): void;
    /** extra button in the selected gate's bar */
    gateBar(b: GateBarButton): void;
    menu(id: 'add' | 'course', items: readonly MenuItem[]): void;
    /** read-only probe data under __gsfpvEditView().edit4 */
    hook(part: 'a' | 'b' | 's' | 'c', data: Record<string, unknown>): void;
}

type Listener = (e: never) => void;

/** The event and service registry under an EditorSeam: listeners by event, one provider per service (the last wins). */
export class SeamBus {
    private readonly listeners = new Map<keyof EditorEvents, Set<Listener>>();
    private readonly services = new Map<keyof Services, (...a: never[]) => unknown>();

    on<K extends keyof EditorEvents>(k: K, f: (e: EditorEvents[K]) => void): () => void {
        let set = this.listeners.get(k);
        if (!set) this.listeners.set(k, (set = new Set()));
        set.add(f as Listener);
        return () => { set.delete(f as Listener); };
    }

    emit<K extends keyof EditorEvents>(k: K, e: EditorEvents[K]): void {
        for (const f of [...(this.listeners.get(k) ?? [])]) (f as (e: EditorEvents[K]) => void)(e);
    }

    provide<K extends keyof Services>(k: K, f: Services[K]): void {
        this.services.set(k, f as (...a: never[]) => unknown);
    }

    has(k: keyof Services): boolean {
        return this.services.has(k);
    }

    call<K extends keyof Services>(k: K, ...a: Parameters<Services[K]>): ReturnType<Services[K]> {
        const f = this.services.get(k);
        if (!f) throw new Error(`editor seam: no part provides ${k}`);
        return (f as (...x: Parameters<Services[K]>) => ReturnType<Services[K]>)(...a);
    }
}

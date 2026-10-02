// Replays of format /2 lives in the page (C.9): the crash replay, a saved flight played back, the
// check that a saved flight replays to the hash it was saved with (B15), and the trajectory export,
// which is recomputed from the log (there is no live trajectory array any more, D-f).
//
// Every life replays on its own, from its header: the params come from the header (presetSha256
// + overrides, D-g), never from the session, and the walls are the ones whose hash the header
// names. A life flown on walls this page does not have cannot replay here.
import { LifePlayer, SIM_CORE_VERSION, lifeHeaderProblem, presetSha256, sha256Hex, trajPoint } from '@gsfpv/sim-core';
import type { ContactWorld, Life, LifeHeader, PresetJson, ReplayDeps, Sim, SimEvent, TrajectoryPoint } from '@gsfpv/sim-core';
import { PRESETS } from '../presets';
import { IDENTITY, isIdentity, worldUnder } from './world';
import type { BaseWalls } from './world';

let bySha: Map<string, PresetJson> | null = null;

/** A preset of this build by its sha256 (a saved file embeds its own: header.presetJson). */
export function presetBySha(sha: string): PresetJson | null {
    if (!bySha) bySha = new Map(Object.values(PRESETS).map((p) => [presetSha256(p), p]));
    return bySha.get(sha) ?? null;
}

/**
 * The walls this page has: their digest, their contact world and the scan's own collision, all
 * untransformed (E.7: a life replays under its header's transform and its world records).
 */
export interface WallsSource extends BaseWalls {
    collisionSha256: string | null;
    world: ContactWorld | null;
}

/** Why a life cannot replay in this page, or null. */
export function lifeProblem(h: LifeHeader, walls: WallsSource): string | null {
    if (h.simCore !== SIM_CORE_VERSION) return `flown with ${h.simCore}, this page runs ${SIM_CORE_VERSION}`;
    const p = lifeHeaderProblem(h);
    if (p) return p;
    if (!h.presetJson && !presetBySha(h.presetSha256)) return `preset ${h.preset} (${h.presetSha256.slice(0, 12)}) is not in this build`;
    if (h.collisionSha256 !== null && (h.collisionSha256 !== walls.collisionSha256 || !walls.world)) return 'flown on other walls';
    if (h.collisionSha256 !== null && h.scene && !isIdentity({ s: h.scene.transform[0], t: h.scene.transform.slice(1) }) && !walls.collision) return 'flown on rescaled walls this page cannot rebuild';
    return null;
}

/** ReplayDeps for one life: its walls (none when it flew without), its preset. */
export function depsFor(h: LifeHeader, walls: WallsSource): ReplayDeps {
    return {
        preset: (sha) => (h.presetJson && sha === h.presetSha256 ? h.presetJson : presetBySha(sha)),
        // the header scene's transform, or a world record's (E.7), over the scan's own walls
        world: (scene, ev) => {
            if (h.collisionSha256 === null) return null;
            const tr = ev ?? (scene ? { s: scene.transform[0], t: scene.transform.slice(1) } : IDENTITY);
            return worldUnder(walls, tr);
        }
    };
}

/** Plays lives one after another (each from its own header), stepped to any tick. */
export class LivesPlayer {
    readonly lives: readonly Life[];
    readonly endTick: number;
    private readonly walls: WallsSource;
    private readonly hash: boolean;
    private idx = 0;
    private player: LifePlayer;
    /** called after every step, in tick order across the lives */
    onStep: ((sim: Sim) => void) | null = null;
    /** every event of the replayed model (a crash, a respawn), as the runner emitted it in flight */
    onEvent: ((e: SimEvent) => void) | null = null;
    /**
     * The scene transform [s, tx, ty, tz] the life is at now: its header's, then each world record's
     * (E.7). The video export draws the scan under it (F.3).
     */
    transform: [number, number, number, number] = [1, 0, 0, 0];

    constructor(lives: readonly Life[], walls: WallsSource, endTick: number, o: { hash?: boolean } = {}) {
        if (lives.length === 0) throw new Error('no lives to play');
        this.lives = lives;
        this.walls = walls;
        this.hash = o.hash === true;
        this.endTick = Math.min(endTick, lives[lives.length - 1].endTick);
        this.player = this.open(0);
    }

    private open(i: number): LifePlayer {
        const life = this.lives[i];
        const sc = life.header.scene;
        this.transform = sc ? [sc.transform[0], sc.transform[1], sc.transform[2], sc.transform[3]] : [1, 0, 0, 0];
        const base = depsFor(life.header, this.walls);
        const deps: ReplayDeps = { ...base, world: (scene, ev) => {
            if (ev) this.transform = [ev.s, ev.t[0], ev.t[1], ev.t[2]];
            return base.world(scene, ev);
        } };
        const p = new LifePlayer(life, deps, Math.min(life.endTick, this.endTick), { hash: this.hash });
        p.onStep = (sim) => this.onStep?.(sim);
        p.onEvent = (e) => this.onEvent?.(e);
        this.idx = i;
        return p;
    }

    get sim(): Sim {
        return this.player.sim;
    }

    get done(): boolean {
        return this.sim.tick >= this.endTick;
    }

    /** Steps until min(tick, endTick); `lifeDone` gets each life's hash (option hash) as it ends. */
    stepTo(tick: number, lifeDone?: (life: Life, hash: string) => void): void {
        const to = Math.min(tick, this.endTick);
        for (;;) {
            this.player.stepTo(to);
            if (!this.player.done || this.idx === this.lives.length - 1) break;
            if (this.hash) lifeDone?.(this.lives[this.idx], this.player.digest());
            this.player = this.open(this.idx + 1);
        }
        if (this.hash && this.done) lifeDone?.(this.lives[this.idx], this.player.digest());
    }
}

/** One digest for several lives: sha256 of their hashes in order (what a saved flight is checked against). */
export function sessionHash(hashes: readonly string[]): string {
    let s = '';
    for (const h of hashes) s += `${h},`;
    // sim-core's sha256Hex wants bytes; the hashes are ASCII hex
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return sha256Hex(bytes);
}

/**
 * Replays lives to `endTick`: each life's hash (as Life.traceHash would read), the session hash,
 * and the position every `every` ticks (B15: how far a tampered log moves the path).
 */
export function replayLivesTrack(lives: readonly Life[], walls: WallsSource, endTick: number, every = 100): { hashes: string[]; hash: string; track: number[] } {
    const pl = new LivesPlayer(lives, walls, endTick, { hash: true });
    const track: number[] = [];
    const hashes: string[] = [];
    pl.onStep = (sim) => { if (sim.tick % every === 0) track.push(sim.s[0], sim.s[1], sim.s[2]); };
    pl.stepTo(endTick, (_life, h) => hashes.push(h));
    return { hashes, hash: sessionHash(hashes), track };
}

/** The trajectory export from the kept lives: one point every `every` ticks (100 per second at 10). */
export function trajectoryOf(lives: readonly Life[], walls: WallsSource, endTick: number, every = 10): TrajectoryPoint[] {
    const out: TrajectoryPoint[] = [];
    const pl = new LivesPlayer(lives, walls, endTick);
    pl.onStep = (sim) => { if (sim.tick % every === 0) out.push(trajPoint(sim)); };
    pl.stepTo(endTick);
    return out;
}

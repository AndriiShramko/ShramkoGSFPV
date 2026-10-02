// Scene rotation (docs/architecture-v03.md E.3, E.5; the owner's item 10): which scene N (next),
// Shift+N (random) and F (next favourite) load, and which one follows a crash when scenes.autoSwitch
// is on. Pure: the curated list and the library come in through deps, the random numbers through rng.
//   - random order: a shuffle bag per source: no scene comes twice before every scene of the
//     source has come once, and the current scene never comes;
//   - sequential: the source's own order, after the current scene, wrapping;
//   - skipped: scenes without walls (unless allowNoWalls), scenes that failed to load in the last
//     24 h. `skip: false` turns the skipping off (the tests' negative control).
// Random SuperSplat scenes by likes (E.6 phase 2) are not here yet: Shift+N draws from the curated list.
import { failedRecently } from './library';
import type { SceneLibraryData } from './library';

export type RotationSource = 'curated' | 'favourites' | 'history';
export type RotationOrder = 'random' | 'sequential';

/** What the rotation needs of a curated scene. */
export interface RotationScene { id: string; collision: boolean | null }

export interface RotationDeps {
    curated(): readonly RotationScene[];
    library(): SceneLibraryData;
    now?(): number;
}

export interface RotationRules {
    /** scenes.allowNoWalls: scenes without walls may come too */
    allowNoWalls: boolean;
    /** default true; false: nothing is skipped (negative control) */
    skip?: boolean;
}

export class SceneRotation {
    private readonly deps: RotationDeps;
    private readonly rng: () => number;
    /** per source: the scenes still to come before the bag is refilled */
    private readonly bags = new Map<string, string[]>();

    constructor(deps: RotationDeps, rng: () => number = Math.random) {
        this.deps = deps;
        this.rng = rng;
    }

    /** The source's scenes in their own order, after the skipping rules. */
    candidates(source: RotationSource, rules: RotationRules): string[] {
        const lib = this.deps.library();
        const now = this.deps.now?.() ?? Date.now();
        const curated = this.deps.curated();
        const walls = (id: string): boolean | null => {
            const c = curated.find((s) => s.id === id);
            if (c && c.collision !== null) return c.collision;
            return lib.history.find((e) => e.id === id)?.hasCollision ?? null;
        };
        const ids = source === 'curated' ? curated.map((s) => s.id) : source === 'favourites' ? lib.favourites : lib.history.map((e) => e.id);
        const out: string[] = [];
        for (const id of ids) {
            if (out.includes(id)) continue;
            if (rules.skip !== false) {
                // unknown (null) counts as walls: a never-opened favourite is not left out on a guess
                if (!rules.allowNoWalls && walls(id) === false) continue;
                if (failedRecently(lib, id, now)) continue;
            }
            out.push(id);
        }
        return out;
    }

    /** N, and the scene after a crash with scenes.autoSwitch on. null: no other scene to go to. */
    next(source: RotationSource, current: string | null, order: RotationOrder, rules: RotationRules): string | null {
        const list = this.candidates(source, rules);
        return order === 'sequential' ? after(list, current) : this.draw(source, list, current);
    }

    /** F: the next favourite after the current scene, in the favourites' order (newest star first). */
    nextFavourite(current: string | null, rules: RotationRules): string | null {
        return after(this.candidates('favourites', rules), current);
    }

    /** Shift+N: a random curated scene (its own bag, so random never repeats either). */
    random(current: string | null, rules: RotationRules): string | null {
        return this.draw('random', this.candidates('curated', rules), current);
    }

    private draw(key: string, list: readonly string[], current: string | null): string | null {
        const pool = list.filter((id) => id !== current);
        if (pool.length === 0) return null;
        // a scene that left the source (unstarred, failed) is dropped from the bag
        let bag = (this.bags.get(key) ?? []).filter((id) => pool.includes(id));
        if (bag.length === 0) bag = this.shuffle(pool);
        const id = bag.shift()!;
        this.bags.set(key, bag);
        return id;
    }

    private shuffle(ids: readonly string[]): string[] {
        const a = [...ids];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
}

/** The scene after `current` in `list`, wrapping; the first when current is not in it; never current. */
function after(list: readonly string[], current: string | null): string | null {
    const i = current === null ? -1 : list.indexOf(current);
    for (let k = 1; k <= list.length; k++) {
        const id = list[(i + k + list.length) % list.length];
        if (id !== current) return id;
    }
    return null;
}

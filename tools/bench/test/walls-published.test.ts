// Walls W2: the order the page looks for a scan's walls in (apps/fly/src/session/loader.ts):
// shipped beside the scan, else published on this site, else none (the page's own build is offered).
// No network: the loader's download is a stand-in that answers per URL.
import { describe, expect, it } from 'vitest';
import * as L from '../../../apps/fly/src/session/loader';
import type { LoadedWalls } from '../../../apps/fly/src/session/loader';

const ORIGIN = 'http://localhost:5800';
const SHIPPED = 'https://cdn.example/70b50d42/v1/scene.voxel.json';
const PUBLISHED = `${ORIGIN}/walls/70b50d42/v1/scene.voxel.json`;

const walls = (sha: string): LoadedWalls => ({ collision: {} as LoadedWalls['collision'], world: {} as LoadedWalls['world'], sha256: sha, ms: 1 });

/** a download stand-in: per URL walls, null (403/404: none there) or a thrown error; it records what was asked */
function stand(answers: Record<string, LoadedWalls | null | Error>) {
    const asked: string[] = [];
    const load = async (u: string): Promise<LoadedWalls | null> => {
        asked.push(u);
        const a = answers[u];
        if (a instanceof Error) throw a;
        return a ?? null;
    };
    return { asked, load };
}

describe('walls W2: shipped, else published, else the browser build', () => {
    it('the loader exports the order', () => {
        expect(typeof (L as Record<string, unknown>).wallsPlaces).toBe('function');
        expect(typeof (L as Record<string, unknown>).firstWalls).toBe('function');
    });

    it('places: shipped first when the scan has a walls URL, the published one on this site after it', () => {
        const order = L.wallsPlaces?.({ id: '70b50d42', version: 1, collisionUrl: SHIPPED }, ORIGIN);
        expect(order).toEqual([{ from: 'shipped', url: SHIPPED }, { from: 'published', url: PUBLISHED }]);
        const noShipped = L.wallsPlaces?.({ id: '70b50d42', version: 1, collisionUrl: null }, ORIGIN);
        expect(noShipped).toEqual([{ from: 'published', url: PUBLISHED }]);
        // a new upload of the scan (v2) never takes the walls of v1
        expect(L.publishedWallsUrl?.('70b50d42', 2, ORIGIN)).toBe(`${ORIGIN}/walls/70b50d42/v2/scene.voxel.json`);
    });

    it('shipped walls win and the published file is not even asked for', async () => {
        const s = stand({ [SHIPPED]: walls('a'), [PUBLISHED]: walls('b') });
        const w = await L.firstWalls?.(L.wallsPlaces({ id: '70b50d42', version: 1, collisionUrl: SHIPPED }, ORIGIN), s.load);
        expect(w?.sha256).toBe('a');
        expect(w?.from).toBe('shipped');
        expect(s.asked).toEqual([SHIPPED]);
    });

    it('no shipped walls: the published ones are used', async () => {
        const s = stand({ [SHIPPED]: null, [PUBLISHED]: walls('b') });
        const w = await L.firstWalls?.(L.wallsPlaces({ id: '70b50d42', version: 1, collisionUrl: SHIPPED }, ORIGIN), s.load);
        expect(w?.sha256).toBe('b');
        expect(w?.from).toBe('published');
        expect(s.asked).toEqual([SHIPPED, PUBLISHED]);
    });

    it('a scan the CDN says has no walls goes straight to the published ones', async () => {
        const s = stand({ [PUBLISHED]: walls('b') });
        const w = await L.firstWalls?.(L.wallsPlaces({ id: '70b50d42', version: 1, collisionUrl: null }, ORIGIN), s.load);
        expect(w?.from).toBe('published');
        expect(s.asked).toEqual([PUBLISHED]);
    });

    it('nothing published (404) or a page instead of a file: null, never an error (the page offers its build)', async () => {
        const none = stand({ [SHIPPED]: null, [PUBLISHED]: null });
        expect(await L.firstWalls?.(L.wallsPlaces({ id: '70b50d42', version: 1, collisionUrl: SHIPPED }, ORIGIN), none.load)).toBeNull();
        const page = stand({ [SHIPPED]: null, [PUBLISHED]: new SyntaxError('Unexpected token < in JSON') });
        expect(await L.firstWalls?.(L.wallsPlaces({ id: '70b50d42', version: 1, collisionUrl: SHIPPED }, ORIGIN), page.load)).toBeNull();
    });

    it('a broken shipped file stays an error, as before', async () => {
        const s = stand({ [SHIPPED]: new Error('voxel data 500') });
        await expect(L.firstWalls?.(L.wallsPlaces({ id: '70b50d42', version: 1, collisionUrl: SHIPPED }, ORIGIN), s.load)).rejects.toThrow('voxel data 500');
    });
});

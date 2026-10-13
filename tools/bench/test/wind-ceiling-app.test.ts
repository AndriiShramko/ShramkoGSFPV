// The fly app's side of v0.7 lane E (docs/wip/v07-e.md section 6), without a page: which wind a scan
// flies in (session/wind-source.ts: the pilot's mode over the catalogue, the live wind from lane A's
// /api/wind, the custom numbers), what the HUD's wind dial says (ui/wind-view.ts), and which collision
// ceiling a scan flies with and how its height reads (session/ceiling-source.ts). Each with a control.
import { describe, expect, it } from 'vitest';
import { MemoryBackend, PrefsStore, SCHEMA } from '../../../packages/prefs/src';
import { resolver } from '../../../packages/prefs/test/helpers';
import { chooseWind, customWind, fetchLiveWind, parseLiveWind, windFor } from '../../../apps/fly/src/session/wind-source';
import type { LiveWind } from '../../../apps/fly/src/session/wind-source';
import { windDialView, windSide, wrap180 } from '../../../apps/fly/src/ui/wind-view';
import { aboveStart, scanHeight, sceneCeiling, storedCeiling } from '../../../apps/fly/src/session/ceiling-source';

const WINDY = { wind: { fromDeg: 300, speed: 6, gust: 3, source: 'manual' as const }, compassDeg: 15 };
const CUSTOM = { fromDeg: 90, speed: 5, gust: 1 };
const LIVE: LiveWind = { fromDeg: 200, speed: 7.5, gust: 4, at: '2026-10-13T08:00:00Z' };

/** A store as the page has one, its curated defaults from these catalogue entries. */
function store(scenes: Record<string, Record<string, unknown>> = {}): PrefsStore {
    return new PrefsStore(SCHEMA, new MemoryBackend(), resolver({}, scenes));
}

/** A fetch that answers `status` with `body` once, and counts its calls. */
function fakeFetch(status: number, body: unknown, delayMs = 0): typeof fetch & { calls: string[] } {
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (delayMs) await new Promise((r, j) => { const t = setTimeout(r, delayMs); init?.signal?.addEventListener('abort', () => { clearTimeout(t); j(new Error('aborted')); }); });
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch & { calls: string[] };
    f.calls = calls;
    return f;
}

describe('which wind a scan flies in', () => {
    it('off: none; scene: the catalogue\'s (none without one); custom: the pilot\'s; the compass comes from the scene', () => {
        expect(chooseWind('off', WINDY, CUSTOM, LIVE).spec).toBeNull();
        expect(chooseWind('scene', WINDY, CUSTOM, null).spec).toMatchObject({ fromDeg: 300, speed: 6, gust: 3, compassDeg: 15, hasCompass: true, source: 'scene' });
        expect(chooseWind('scene', undefined, CUSTOM, null).spec).toBeNull();
        expect(chooseWind('custom', undefined, CUSTOM, null).spec).toMatchObject({ ...CUSTOM, compassDeg: 0, hasCompass: false, source: 'custom' });
        // still air is no wind at all (the flight model then has no wind field)
        expect(chooseWind('custom', WINDY, { fromDeg: 10, speed: 0, gust: 0 }, null).spec).toBeNull();
    });

    it('now: the live wind; without one the scan\'s own (said), else still air (said); control: the live answer wins over the scan\'s', () => {
        expect(chooseWind('now', WINDY, CUSTOM, LIVE)).toMatchObject({ spec: { fromDeg: 200, speed: 7.5, gust: 4, source: 'now', at: LIVE.at }, note: null });
        expect(chooseWind('now', WINDY, CUSTOM, null)).toMatchObject({ spec: { source: 'scene', speed: 6 }, note: 'now-fallback-scene' });
        expect(chooseWind('now', undefined, CUSTOM, null)).toEqual({ mode: 'now', spec: null, note: 'now-none' });
    });

    it('lane A\'s answer is read strictly: the contract\'s fields and ranges, source "now", ok true', () => {
        const good = { ok: true, fromDeg: 200, speed: 7.5, gust: 4, at: LIVE.at, source: 'now' };
        expect(parseLiveWind(good)).toEqual(LIVE);
        expect(parseLiveWind({ ...good, ok: false })).toBeNull();
        expect(parseLiveWind({ ...good, source: 'climate' })).toBeNull();
        expect(parseLiveWind({ ...good, speed: 31 })).toBeNull();
        expect(parseLiveWind({ ...good, fromDeg: 'north' })).toBeNull();
    });

    it('the request goes to /api/wind/<id>?mode=now; a 404 (no location), a bad id or no answer in time give null', async () => {
        const ok = fakeFetch(200, { ok: true, fromDeg: 200, speed: 7.5, gust: 4, at: LIVE.at, source: 'now' });
        expect(await fetchLiveWind('0230d903', ok)).toEqual(LIVE);
        expect(ok.calls).toEqual(['/api/wind/0230d903?mode=now']);
        expect(await fetchLiveWind('0230d903', fakeFetch(404, { error: 'no geo' }))).toBeNull();
        const never = fakeFetch(200, {});
        expect(await fetchLiveWind('../admin', never)).toBeNull();
        expect(never.calls).toEqual([]);
        expect(await fetchLiveWind('0230d903', fakeFetch(200, { ok: true, fromDeg: 1, speed: 1, gust: 1, at: 'x', source: 'now' }, 500), 50)).toBeNull();
    });

    it('from the store: the default mode flies the scan\'s wind; custom numbers are per scan; now asks once; control: off asks nothing', async () => {
        const s = store();
        expect(s.get('wind.mode')).toBe('scene');
        expect(await windFor(s, '0230d903', WINDY, null)).toMatchObject({ source: 'scene', speed: 6 });
        s.set('wind.mode', 'custom');
        s.set('wind.speed', 9, { scene: '0230d903' });
        expect(customWind(s, '0230d903').speed).toBe(9);
        expect(customWind(s, '70b50d42').speed).toBe(4); // another scan keeps its own (the default)
        expect(await windFor(s, '0230d903', WINDY, null)).toMatchObject({ source: 'custom', speed: 9, fromDeg: 270, gust: 2 });
        s.set('wind.mode', 'now');
        const f = fakeFetch(200, { ok: true, fromDeg: 200, speed: 7.5, gust: 4, at: LIVE.at, source: 'now' });
        expect(await windFor(s, '0230d903', WINDY, f)).toMatchObject({ source: 'now', speed: 7.5 });
        expect(f.calls.length).toBe(1);
        s.set('wind.mode', 'off');
        const g = fakeFetch(200, {});
        expect(await windFor(s, '0230d903', WINDY, g)).toBeNull();
        expect(g.calls).toEqual([]);
    });
});

describe('the HUD\'s wind dial', () => {
    it('a wind blowing to +x seen from a nose to -z (heading 0) is a crosswind from the left, to the right of the nose', () => {
        const v = windDialView(0, [4, 0, 0], null);
        expect(v.toRelDeg).toBeCloseTo(90, 9);
        expect(v.side).toBe('left');
        expect(v.speed).toBeCloseTo(4, 9);
        expect(v.northRelDeg).toBeNull();
    });

    it('turned right 90 the same wind is a tailwind; facing it, a headwind; still air shows no arrow', () => {
        expect(windDialView(90, [4, 0, 0], null).side).toBe('tail');
        expect(windDialView(-90, [4, 0, 0], null).side).toBe('head');
        expect(windDialView(0, [0, 0.4, 0], 0).toRelDeg).toBeNull();
        expect(windSide(-100)).toBe('left');
        expect(wrap180(540)).toBe(180);
    });

    it('N is where north is: compass 0 puts it on the nose at heading 0, behind after a half turn; control: a compass of 90 puts it to the left', () => {
        expect(windDialView(0, null, 0).northRelDeg).toBeCloseTo(0, 9);
        expect(windDialView(180, null, 0).northRelDeg).toBeCloseTo(180, 9);
        // the scene's forward axis points east: north is a left turn of 90 deg
        expect(windDialView(0, null, 90).northRelDeg).toBeCloseTo(-90, 9);
    });
});

describe('which collision ceiling a scan flies with', () => {
    const cat = { '0230d903': { ceilingM: 42.5 } };

    it('the default is the admin\'s height for the scan; a scan without one has none; off and custom are per scan', () => {
        const s = store(cat);
        expect(storedCeiling(s, '0230d903')).toBe(42.5);
        expect(sceneCeiling(s, '0230d903')).toBe(42.5);
        expect(storedCeiling(s, '70b50d42')).toBeNull(); // no catalogue height: 10 000 m, nothing ignored
        s.set('scene.ceiling', 'off', { scene: '0230d903' });
        expect(storedCeiling(s, '0230d903')).toBeNull();
        s.set('scene.ceiling', 'custom', { scene: '0230d903' });
        expect(storedCeiling(s, '0230d903')).toBe(42.5); // custom without a height of its own: the scan's
        s.set('scene.ceilingM', 12, { scene: '0230d903' });
        expect(storedCeiling(s, '0230d903')).toBe(12);
        expect(storedCeiling(s, '70b50d42')).toBeNull();
        // control: the scan's own height is not the custom one
        expect(sceneCeiling(s, '0230d903')).toBe(42.5);
    });

    it('heights read as metres above the start at the size flown, and back to scan metres (Float32)', () => {
        const f = { transform: { s: 4, t: [0, -2, 0] }, spawn: [0, 6, 0] };
        expect(aboveStart(f, 5)).toBe(4 * 5 - 2 - 6);
        expect(scanHeight(f, aboveStart(f, 5))).toBe(Math.fround(5));
        // control: at scale 1 the same height reads differently
        expect(aboveStart({ transform: { s: 1, t: [0, -2, 0] }, spawn: [0, 6, 0] }, 5)).not.toBe(aboveStart(f, 5));
    });
});

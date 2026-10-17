// The scene settings a share link carries (src/shared-settings.ts, v0.9 item 15): the text each writes and
// reads, strictly. The table is packages/scenes/test/fixtures/shared-links.json, read by apps/api/tests/
// test_feedback.py as well (the /s/<id> page's link), so the two writers cannot drift.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flyDeepLink, isEmptyShared, parseSharedSettings, readShared, sameShared, sharedQuery, stripSharedParams, appendShared } from '../src';
import type { SceneRender, SharedSettings } from '../src';

const TABLE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'shared-links.json'), 'utf8')) as {
    rows: { render: SceneRender | null; shared: SharedSettings; link: string }[];
    queries: { query: string; shared: SharedSettings }[];
    objects: { body: unknown; kept: SharedSettings }[];
};

describe('the link a share carries', () => {
    it('every row of the table: the deep link, then the settings in their fixed order', () => {
        expect(TABLE.rows.length).toBeGreaterThan(8);
        for (const r of TABLE.rows) expect(appendShared(flyDeepLink('/en/fly/', '2f1ddf5f', r.render ?? undefined), r.shared), JSON.stringify(r)).toBe(r.link);
    });

    it('control: a link written without the settings (the base build) is wrong for every row that has some', () => {
        const wrong = TABLE.rows.filter((r) => flyDeepLink('/en/fly/', '2f1ddf5f', r.render ?? undefined) !== r.link);
        expect(wrong.length).toBe(TABLE.rows.filter((r) => !isEmptyShared(r.shared)).length);
        expect(wrong.length).toBeGreaterThan(8);
    });

    it('every row reads back to the same settings and the same render (what the receiver gets)', () => {
        for (const r of TABLE.rows) {
            const q = new URL(r.link, 'https://gsfpv.flyreelstudio.eu').searchParams;
            expect(parseSharedSettings(q), r.link).toEqual(r.shared);
        }
    });

    it('queries: each parameter is read on its own, strictly; an unusable one is ignored and the rest still count', () => {
        for (const c of TABLE.queries) expect(parseSharedSettings(new URLSearchParams(c.query)), c.query).toEqual(c.shared);
    });

    it('bodies: a POST /api/share body is read as strictly, numbers rounded to what a link carries', () => {
        for (const c of TABLE.objects) expect(readShared(c.body), JSON.stringify(c.body)).toEqual(c.kept);
    });

    it('control: a lenient reader (Number() on the text) would let through what the table refuses', () => {
        const lenient = (v: string): number | undefined => (Number.isFinite(Number(v)) ? Number(v) : undefined);
        const refused = ['1e2', '', '3x', '0x10', ' 5 '];
        expect(refused.filter((v) => lenient(v) !== undefined).length).toBeGreaterThan(2); // 1e2, '' (0), 0x10, ' 5 '
        for (const v of refused) expect(parseSharedSettings(new URLSearchParams({ sz: v })).size, v).toBeUndefined();
    });

    it('the settings the receiver strips on a scene switch are exactly the ones this module reads, not the drone', () => {
        const q = new URLSearchParams('scene=aaaaaa01&sz=3&wl=0&fl=4&wd=off&ce=off&drone=pavo20pro-3s&budget=8&lat=1');
        stripSharedParams(q);
        expect(q.toString()).toBe('scene=aaaaaa01&drone=pavo20pro-3s&budget=8&lat=1');
    });

    it('sameShared compares after rounding; the canonical text has no trailing zeros and no exponent', () => {
        expect(sameShared({ size: 3 }, readShared({ size: 3.0004 }))).toBe(true);
        expect(sameShared({ size: 3 }, { size: 3.001 })).toBe(false);
        expect(sharedQuery({ size: 2.50, ceiling: 0.1 + 0.2, wind: { fromDeg: 0, speed: 0, gust: 0 } })).toBe('sz=2.5&wd=0,0,0&ce=0.3');
        expect(sharedQuery({ ceiling: -0.001 })).toBe('ce=0');
    });
});

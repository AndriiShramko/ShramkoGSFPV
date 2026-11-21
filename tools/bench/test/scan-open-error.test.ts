// Why a scan does not open (lane n-scan S3, apps/fly/src/session/open-error.ts): every failure of a scene load is
// one of four reasons ('too-large', 'gone', 'unknown-format', 'network') with one plain line `scene.open.<kind>`
// in all four languages; a single SOG is checked before it loads (version, size, 404), also with ?render=off; the
// engine reading zero splats is a failure, not "ready". Recorded meta.json files of
// packages/scenes/test/fixtures/superspl-kinds.json; no network.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SceneError } from '../../../packages/scenes/src/index';
import { NoSplatsError, UnsupportedFormatError, holdsNoSplats } from '../../../packages/render-pc/src/lod';
import { OPEN_ERROR_KINDS, OpenError, deviceSplatLimit, failureCode, failureText, openCheck, openErrorOf, openMessage } from '../../../apps/fly/src/session/open-error';

interface Kind { id: string; kind: string; meta?: { version?: number; count?: number } }
const KINDS = (JSON.parse(readFileSync(new URL('../../../packages/scenes/test/fixtures/superspl-kinds.json', import.meta.url), 'utf8')) as { kinds: Kind[] }).kinds;
const metaOf = (id: string): Record<string, unknown> => {
    const k = KINDS.find((x) => x.id === id);
    if (!k?.meta) throw new Error(`no recorded meta.json for ${id}`);
    return k.meta as Record<string, unknown>;
};
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const locale = (lang: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../../packages/i18n/locales/fly/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>;
const EN = locale('en');
const say = (key: string, vars?: Record<string, string>): string => (EN[key] ?? `?${key}`).replace(/\{(\w+)\}/g, (_, v: string) => vars?.[v] ?? '');

/** A desktop: 8192 px textures, Chrome's capped 8 GB. */
const DESKTOP = deviceSplatLimit({ maxTextureSize: 8192, memoryGB: 8 });
const single = (id: string) => ({ id, contentUrl: `https://d28zzqy0iyovbz.cloudfront.net/${id}/v1/meta.json`, contentKind: 'meta' as const });
const answer = (status: number, body?: unknown) => async (): Promise<Response> => new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('the four reasons and their lines', () => {
    it('every reason has one line in every language, and it says what to do next', () => {
        for (const lang of LANGS) {
            const m = locale(lang);
            for (const kind of OPEN_ERROR_KINDS) expect(m[`scene.open.${kind}`], `${lang} scene.open.${kind}`).toMatch(/\S.*[.!]\s*\S.*/);
        }
    });

    it('a newer SOG, an empty read, a 404 and a dead server each get their reason', () => {
        expect(openErrorOf(new UnsupportedFormatError('SOG version 4', 'meta.json is SOG version 4'))).toBe('unknown-format');
        expect(openErrorOf(new NoSplatsError('meta.json holds no splat'))).toBe('unknown-format');
        expect(openErrorOf(new SceneError('not-found', 'scene 1234abcd: no content file to open'))).toBe('gone');
        expect(openErrorOf(new Error('meta.json: HTTP 404'))).toBe('gone');
        expect(openErrorOf(new SceneError('network', 'scene: the scan could not be read'))).toBe('network');
        expect(openErrorOf(new TypeError('Failed to fetch'))).toBe('network');
        expect(openErrorOf(new OpenError('too-large', 'x'))).toBe('too-large');
        // lines of their own: a link that is no link, a scene its author removed, GSAF, a damaged file
        for (const code of ['invalid-link', 'blocked', 'unsupported', 'broken'] as const) expect(openErrorOf(new SceneError(code, code))).toBeNull();
    });

    it('the scene list shows the plain line, never "Something went wrong" with the engine\'s text', () => {
        const e = new UnsupportedFormatError('SOG version 4', 'meta.json is SOG version 4; the engine reads SOG 1, 2, 3');
        const text = failureText(failureCode(e), e.message, say);
        expect(text).toBe(EN['scene.open.unknown-format']);
        expect(text).not.toContain('SOG version');
        expect(failureText('unsupported', '', say)).toBe(EN['scenes.unsupported']);
        expect(failureText('blocked', '', say)).toBe(EN['error.blocked']);
        expect(failureCode(new Error('engine exploded'))).toBe('generic');
    });

    it('a failed scene switch tells the reason as a problem that stays to be read', () => {
        expect(openMessage('too-large', say)).toEqual({ kind: 'problem', text: EN['scene.open.too-large'], key: 'scene.open', from: 'scene' });
        expect(openMessage('generic', say)).toBeNull();
    });
});

describe('the check before a single SOG loads', () => {
    it('a39abad1 (SOG v3, 1.0 M splats) and the heavy 5c0f892e (14.1 M) open on a desktop', async () => {
        await expect(openCheck(single('a39abad1'), answer(200, metaOf('a39abad1')), DESKTOP)).resolves.toBeUndefined();
        await expect(openCheck(single('5c0f892e'), answer(200, metaOf('5c0f892e')), DESKTOP)).resolves.toBeUndefined();
    });

    it('a scan too large for the device says so before a byte of it loads', async () => {
        const phone = deviceSplatLimit({ maxTextureSize: 4096, memoryGB: 4 });
        expect(phone).toBe(12_000_000);
        await expect(openCheck(single('5c0f892e'), answer(200, metaOf('5c0f892e')), phone)).rejects.toMatchObject({ kind: 'too-large' });
        await expect(openCheck(single('a39abad1'), answer(200, { ...metaOf('a39abad1'), count: 400_000_000 }), DESKTOP)).rejects.toMatchObject({ kind: 'too-large' });
    });

    it('a newer SOG version and a vanished file are named before loading', async () => {
        await expect(openCheck(single('a39abad1'), answer(200, { ...metaOf('a39abad1'), version: 4 }), DESKTOP)).rejects.toMatchObject({ kind: 'unknown-format' });
        await expect(openCheck(single('a39abad1'), answer(404), DESKTOP)).rejects.toMatchObject({ kind: 'gone' });
    });

    it('a streamed scan is never refused for its size: its coarse level is the lighter version', async () => {
        let asked = 0;
        const get = async (): Promise<Response> => { asked++; return new Response('{}'); };
        await openCheck({ id: '2f1ddf5f', contentUrl: 'https://cdn/2f1ddf5f/v1/lod-meta.json', contentKind: 'lod-meta' }, get, 1);
        expect(asked).toBe(0);
    });

    it('the device limit: the texture side and the memory, the smaller wins', () => {
        expect(deviceSplatLimit({ maxTextureSize: 8192, memoryGB: 8 })).toBe(24_000_000);
        expect(deviceSplatLimit({ maxTextureSize: 2048 })).toBe(2048 * 2048);
    });
});

describe('zero splats read is a failure', () => {
    it('a single file with no splat fails; a streamed octree is not judged at load', () => {
        expect(holdsNoSplats({ numSplats: 0 })).toBe(true);
        expect(holdsNoSplats({ numSplats: 996301 })).toBe(false);
        expect(holdsNoSplats({ octree: {}, numSplats: 0 })).toBe(false);
        expect(holdsNoSplats(null)).toBe(false);
    });
});

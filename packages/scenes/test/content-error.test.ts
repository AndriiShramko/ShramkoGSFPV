import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { noContentError, SceneError, SCENE_ERROR_CODES } from '../src/index';
import type { ContentAttempt } from '../src/index';

// v0.8 lane C, review R3: a scene none of whose content files opens. A damaged lod-meta.json with nothing
// to fall back to used to end as the engine's own English message under "Something went wrong" in every
// language; it is now SceneError 'broken', shown as the fly locale's error.broken.

const LOD = 'https://cdn.example/abcd1234/v2/lod-meta.json';
const META = 'https://cdn.example/abcd1234/v2/meta.json';

/** A file that arrived damaged (the renderer threw render-pc BrokenFileError). */
const damaged = (url: string, verified = true): ContentAttempt => ({ url, error: 'lod-meta.json is not an octree the engine can open: lodLevels missing', verified, broken: true, e: new Error('damaged') });
/** A file that failed for another reason (HTTP, the engine's own error). */
const failed = (url: string, verified = true): ContentAttempt => ({ url, error: 'meta.json: HTTP 503', verified, broken: false, e: new Error('meta.json: HTTP 503') });

/** The rule before the fix (session loadContent at 6d50b81): it did not know a damaged file. */
function before(id: string, failures: readonly ContentAttempt[]): unknown {
    const first = failures[0];
    if (!first) return new SceneError('not-found', `scene ${id}: no content file to open`);
    if (failures.some((x) => !x.verified)) return new SceneError('network', `scene ${id}: the scan could not be read (${first.error})`);
    return first.e;
}

/** The picker's code for an error (apps/fly app/flight.ts: anything that is not a SceneError is 'generic'). */
const codeOf = (e: unknown): string => (e instanceof SceneError ? e.code : 'generic');

describe('noContentError', () => {
    it('nothing to try is not-found', () => {
        expect(codeOf(noContentError('abcd1234', []))).toBe('not-found');
    });

    it('a damaged lod-meta.json and nothing to fall back to is broken; the reason stays in the message', () => {
        const e = noContentError('abcd1234', [damaged(LOD)]);
        expect(codeOf(e)).toBe('broken');
        expect((e as Error).message).toContain('lodLevels missing');
        expect((e as Error).message).toContain(LOD);
        // control: the rule before the fix showed the pilot the engine's English text ('generic')
        expect(codeOf(before('abcd1234', [damaged(LOD)]))).toBe('generic');
    });

    it('every file damaged is broken, even one whose lookup did not answer (it did arrive)', () => {
        expect(codeOf(noContentError('abcd1234', [damaged(LOD), damaged(META, false)]))).toBe('broken');
        expect(codeOf(before('abcd1234', [damaged(LOD), damaged(META, false)]))).toBe('network');
    });

    it('a damaged file and an unconfirmed file that did not arrive is network (the next try may open it)', () => {
        expect(codeOf(noContentError('abcd1234', [damaged(LOD), failed(META, false)]))).toBe('network');
    });

    it('a failure that is not damage keeps the file\'s own error (unchanged from before)', () => {
        const only = failed(META);
        expect(noContentError('abcd1234', [only])).toBe(only.e);
        expect(before('abcd1234', [only])).toBe(only.e);
    });
});

/** The fly locale's keys (packages/i18n/locales/fly/<lang>.json). */
function flyKeys(lang: string): Set<string> {
    return new Set(Object.keys(JSON.parse(readFileSync(new URL(`../../i18n/locales/fly/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>));
}

/** The picker's key for a code (apps/fly ui/scenes.ts showError). */
const pickerKey = (code: string): string => (code === 'unsupported' ? 'scenes.unsupported' : `error.${code}`);

/** Codes whose picker text is missing in a language. */
function missing(codes: readonly string[], lang: string): string[] {
    const keys = flyKeys(lang);
    return codes.filter((c) => !keys.has(pickerKey(c)));
}

describe('every SceneErrorCode has picker text', () => {
    it.each(['en', 'es', 'pl', 'ru'])('%s', (lang) => {
        expect(SCENE_ERROR_CODES).toContain('broken');
        expect(missing(SCENE_ERROR_CODES, lang)).toEqual([]);
        // control: the same check finds a code that has no text
        expect(missing([...SCENE_ERROR_CODES, 'no-such-code'], lang)).toEqual(['no-such-code']);
    });
});

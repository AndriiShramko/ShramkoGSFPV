import { describe, expect, it } from 'vitest';
import { CONTENT_FILES, contentOrder } from '../src/content';
import type { ContentKind, ContentSeen } from '../src/content';

// v0.8 lane C (the owner's item 8): the order a scene folder's files are opened in, levels of detail first.
const DIR = 'https://cdn.example/abcd1234/v2';
const order = (lod: ContentSeen, meta: ContentSeen) => contentOrder(DIR, { 'lod-meta': lod, meta }).map((c) => `${c.kind}${c.verified ? '' : '?'}`);

/** The rule before v0.8 (resolveScene): the first confirmed file only, lod-meta.json before meta.json. */
function firstConfirmed(seen: Record<ContentKind, ContentSeen>): ContentKind[] {
    const k = CONTENT_FILES.find((c) => seen[c.kind] === 'yes')?.kind;
    return k ? [k] : [];
}

describe('contentOrder', () => {
    it('levels of detail come first in the table', () => {
        expect(CONTENT_FILES.map((c) => c.file)).toEqual(['lod-meta.json', 'meta.json']);
    });

    it.each([
        ['yes', 'yes', ['lod-meta', 'meta']],
        ['yes', 'no', ['lod-meta']],
        ['no', 'yes', ['meta']],
        ['yes', 'unknown', ['lod-meta', 'meta?']],
        ['unknown', 'yes', ['lod-meta?', 'meta']],
        ['unknown', 'unknown', []],
        ['unknown', 'no', []],
        ['no', 'no', []]
    ] as Array<[ContentSeen, ContentSeen, string[]]>)('lod-meta %s, meta %s -> %j', (lod, meta, want) => {
        expect(order(lod, meta)).toEqual(want);
    });

    it('urls are the folder plus the file name, with or without a trailing slash', () => {
        expect(contentOrder(`${DIR}/`, { 'lod-meta': 'yes', meta: 'yes' }).map((c) => c.url)).toEqual([`${DIR}/lod-meta.json`, `${DIR}/meta.json`]);
        expect(contentOrder(DIR, { 'lod-meta': 'no', meta: 'yes' })[0].url).toBe(`${DIR}/meta.json`);
    });

    it('negative control: the old first-confirmed rule loses the levels of detail when the lod-meta lookup drops', () => {
        const seen = { 'lod-meta': 'unknown', meta: 'yes' } as Record<ContentKind, ContentSeen>;
        expect(firstConfirmed(seen)).toEqual(['meta']);
        expect(contentOrder(DIR, seen)[0].kind).toBe('lod-meta');
        // and where both agree (both confirmed), the old rule and the new one open the same file first
        const both = { 'lod-meta': 'yes', meta: 'yes' } as Record<ContentKind, ContentSeen>;
        expect(contentOrder(DIR, both)[0].kind).toBe(firstConfirmed(both)[0]);
    });
});

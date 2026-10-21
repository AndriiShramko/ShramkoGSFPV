// The vendored SuperSplat renderer (packages/render-pc/src/vendor/supersplat-viewer, v11 lane S) stays what UPSTREAM.md says
// it is: an unmodified file hashes to its upstream git blob, a modified one keeps exactly its marked "GSFPV:" edits, the
// licence text is the one upstream ships, and nothing outside the vendor folder is imported by it. Controls: a changed
// byte, a lost marker, a licence with a word changed, an import that leaves the folder each fail their own check.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..', 'src', 'vendor', 'supersplat-viewer');

/** The git blob id of a text (what `git hash-object` prints): sha1 of "blob <bytes>\0<content>", line endings as in the repo (LF). */
function gitBlobId(text: string): string {
    const body = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
    return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest('hex');
}

/**
 * The pinned upstream blobs (commit 88482a6e4a145520cddf4d9c3d9e00481ae558c1) and how many lines marked "GSFPV:" the file may carry.
 * A marked line can cover two edits (the renderer's raster pass: `override` and `?? null`): 4 lines hold 5 edits there, 1 line holds 1
 * in the resident-set reader, so 6 edits in two vendored files (UPSTREAM.md lists each with its line).
 */
const VENDORED: Record<string, { blob: string; edits: number }> = {
    'render/stochastic-splat-renderer.ts': { blob: '4ecc457e540a07b02960dd7a53063491f05a080b', edits: 4 },
    'render/resident-set.ts': { blob: '830531af626c161c86b74225216747504aa67f53', edits: 1 },
    'render/splat-source.ts': { blob: '50e660389a99a68f6721a13827bb269ed968442b', edits: 0 },
    'render/splat-source-workbuffer.ts': { blob: '7eca4ab9769d70160f9e07b1fe88bb4478c94c77', edits: 0 },
    'render/xr-rate-map.ts': { blob: '89151f3105065b404e746a04c44421d7803523e6', edits: 0 },
    'render/shaders/projector.ts': { blob: '96a8d875734d9e85d1e621770db7bb43528b4797', edits: 0 },
    'render/shaders/order.ts': { blob: 'b46e86d5200f7fafd2094e0e58164c1bad9a7a86', edits: 0 },
    'render/shaders/args.ts': { blob: '0cb1bf2e7a52af855668c07b01d1662dd40c8fe1', edits: 0 },
    'render/shaders/raster.ts': { blob: 'fbb5f5b03ab6c8dceef8d8af2d3878dc8297fab2', edits: 0 },
    'render/shaders/taa.ts': { blob: '3f42b226d18627c00932fa13ef542ec29467303c', edits: 0 },
    'render/shaders/compose.ts': { blob: 'f458b78c3e1ae1331259d6527d9ea332de2f0803', edits: 0 },
    'render/shaders/reduce.ts': { blob: '8ecf134c92f21e2386094dc9db7b4a78bad783d6', edits: 0 },
    'render/shaders/interleave.ts': { blob: '9cf219ea42807624630561088d25a4af81864eb1', edits: 0 },
    'render/shaders/warp.ts': { blob: 'ce16117a41a9c98c5a8895cf0c901cfb4ec7fc4d', edits: 0 }
};

const LICENSE_BLOB = 'a034c81d27315ccdb767eae329b870ad03b6835b';

/** The marked edits in a text (lines holding the marker). */
function markerCount(text: string): number {
    return text.split('\n').filter((l) => l.includes('GSFPV:')).length;
}

const read = (rel: string): string => readFileSync(join(DIR, rel), 'utf8');

describe('git blob id', () => {
    it('matches git hash-object for a known text', () => {
        // `printf 'hello\n' | git hash-object --stdin` = ce013625030ba8dba906f756967f9e9ca394464a
        expect(gitBlobId('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    });
    it('treats CRLF as LF (the repo stores LF)', () => {
        expect(gitBlobId('a\r\nb\r\n')).toBe(gitBlobId('a\nb\n'));
    });
});

describe('vendored SuperSplat renderer', () => {
    for (const [rel, want] of Object.entries(VENDORED)) {
        if (want.edits === 0) {
            it(`${rel} is byte-identical to upstream`, () => {
                expect(gitBlobId(read(rel))).toBe(want.blob);
            });
        } else {
            it(`${rel} carries exactly its ${want.edits} marked edits`, () => {
                const text = read(rel);
                expect(markerCount(text)).toBe(want.edits);
                // an edited file is no longer upstream's blob (a revert that lost its markers would be)
                expect(gitBlobId(text)).not.toBe(want.blob);
            });
        }
    }

    it('keeps the licence text upstream ships', () => {
        expect(gitBlobId(read('LICENSE-supersplat-viewer'))).toBe(LICENSE_BLOB);
    });

    it('imports nothing outside its folder but the engine and its two stand-ins', () => {
        const importRe = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g;
        for (const rel of Object.keys(VENDORED)) {
            const text = read(rel);
            let m: RegExpExecArray | null;
            while ((m = importRe.exec(text))) {
                const spec = m[1];
                if (spec === 'playcanvas') continue;
                expect(spec.startsWith('./') || spec === '../picker', `${rel} imports ${spec}`).toBe(true);
            }
        }
    });

    it('has the two stand-ins under the upstream names', () => {
        expect(read('picker.ts')).toContain('captureCameraSnapshot');
        expect(read('picker.ts')).toContain('createPickCameraSnapshot');
        expect(read('render/splat-source-direct.ts')).toContain('DirectSplatSource');
        expect(read('render/splat-source-direct.ts')).toContain('not vendored');
    });
});

/**
 * The local edits as UPSTREAM.md lists them: [file, line in OUR file, what the line holds]. Six in two vendored files (five on four marker
 * lines in the renderer, one in the resident-set reader) and a seventh in the stand-in picker.ts. A marker line sits on the edit's line or
 * one or two lines above it (the raster pass's `override` and `?? null` share one marker).
 */
const EDITS: [string, number, string][] = [
    ['render/resident-set.ts', 220, 'this.set!.files[i]'],
    ['render/stochastic-splat-renderer.ts', 362, 'override execute()'],
    ['render/stochastic-splat-renderer.ts', 363, '?? null'],
    ['render/stochastic-splat-renderer.ts', 381, 'override execute()'],
    ['render/stochastic-splat-renderer.ts', 2168, 'device.backBuffer!.flipY'],
    ['render/stochastic-splat-renderer.ts', 2574, 'interleaveMesh?.destroy()'],
    ['picker.ts', 30, 'if (!cam) return;']
];

/** What is wrong between a copy of UPSTREAM.md's "Local changes" list and the source (empty: they agree). */
function editProblems(doc: string): string[] {
    const bad: string[] = [];
    const from = doc.indexOf('## Local changes'), to = doc.indexOf('## Stand-ins');
    const items = doc.slice(from, to).split('\n').filter((l) => /^\d+\. `/.test(l));
    if (items.length !== EDITS.length) bad.push(`the list has ${items.length} items, the source has ${EDITS.length} edits`);
    EDITS.forEach(([file, line, token], i) => {
        const base = file.split('/').pop() as string;
        const item = items[i] ?? '';
        if (!item.startsWith(`${i + 1}. \`${base}\``)) bad.push(`item ${i + 1} does not start with ${base}`);
        if (!new RegExp(`line ${line}\\b`).test(item)) bad.push(`item ${i + 1} does not say line ${line}`);
        const src = read(file).replace(/\r\n/g, '\n').split('\n');
        if (!(src[line - 1] ?? '').includes(token)) bad.push(`${file}:${line} does not hold ${token}`);
        if (![0, 1, 2].some((up) => (src[line - 1 - up] ?? '').includes('GSFPV:'))) bad.push(`${file}:${line} has no GSFPV marker on or just above it`);
    });
    // every marker line of a vendored file is covered by an edit above
    for (const [rel, want] of Object.entries(VENDORED)) {
        if (want.edits === 0) continue;
        const lines = read(rel).replace(/\r\n/g, '\n').split('\n');
        lines.forEach((l, k) => {
            if (!l.includes('GSFPV:')) return;
            if (!EDITS.some(([f, line]) => f === rel && [0, 1, 2].includes(line - 1 - k))) bad.push(`${rel}:${k + 1} is a marker no listed edit covers`);
        });
    }
    return bad;
}

describe('UPSTREAM.md and the source agree on the local edits (review finding F6: four documents counted them four ways)', () => {
    const doc = readFileSync(join(DIR, 'UPSTREAM.md'), 'utf8');
    it('the list names every edit with its real line, the source holds it there, every marker line is covered', () => {
        expect(editProblems(doc)).toEqual([]);
    });
    it('PROVENANCE.md and D85 say six edits in two vendored files', () => {
        const prov = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'PROVENANCE.md'), 'utf8');
        const dec = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'decisions.md'), 'utf8');
        expect(prov).toContain('two carry six marked one-line type edits');
        expect(dec).toContain('six marked one-line type edits in two of the vendored files');
    });
    it('control: a list with one wrong line, a missing item or an edit that moved is seen', () => {
        expect(editProblems(doc.replace('line 362', 'line 361')).join('|')).toContain('item 2 does not say line 362');
        expect(editProblems(doc.replace(/^3\. `stochastic.*$/m, '')).join('|')).toContain('the list has 6 items');
        expect(editProblems(doc.replace('line 2168', 'line 2169').replace('2168 (', '2169 (')).join('|')).toContain('item 5 does not say line 2168');
    });
});

describe('the guard has teeth (negative controls)', () => {
    it('one changed byte breaks the blob', () => {
        const t = read('render/shaders/taa.ts');
        expect(gitBlobId(t)).toBe(VENDORED['render/shaders/taa.ts'].blob);
        expect(gitBlobId(t.replace('const', 'let'))).not.toBe(VENDORED['render/shaders/taa.ts'].blob);
    });
    it('a lost marker is seen', () => {
        const t = read('render/resident-set.ts');
        expect(markerCount(t)).toBe(1);
        expect(markerCount(t.replace('GSFPV:', 'edit:'))).toBe(0);
    });
    it('a licence with one word changed is seen', () => {
        expect(gitBlobId(read('LICENSE-supersplat-viewer').replace('Permission', 'Prohibition'))).not.toBe(LICENSE_BLOB);
    });
    it('an import that leaves the folder is seen', () => {
        const importRe = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g;
        const bad = "import { x } from '../../app/something';";
        const m = importRe.exec(bad);
        expect(m && !(m[1].startsWith('./') || m[1] === '../picker' || m[1] === 'playcanvas')).toBe(true);
    });
});

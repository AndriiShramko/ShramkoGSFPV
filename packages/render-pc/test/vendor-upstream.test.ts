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

// Records the real CDN layout of a few SuperSplat scenes into cdn-layout.json, which the resolver tests
// replay offline. Refresh: `node packages/scenes/test/fixtures/record.mjs` (about 1,300 small requests).
// For every scene: settings.json of v1..v64 (a plain GET, as the resolver asks it) and, for v1 and every
// version that has settings, a HEAD of each file the resolver may look for, and which of those files
// are stored with a Content-Encoding (a one-byte range of such a file fails the whole fetch in Chrome).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CDN = 'https://d28zzqy0iyovbz.cloudfront.net';
const MAX_V = 64;
const FILES = ['lod-meta.json', 'meta.json', 'scene.compressed.ply', 'scene.voxel.json'];

/** id -> why it is in the set (versions and formats as the explore API and superspl.at's viewer named them). */
const SCENES = {
    '9d09ab82': 'item 8: public, republished once; v1 deleted, v2 streamed (lod-meta) with walls',
    '39e63ce9': 'showcase: v1 streamed with walls',
    '7a475d38': 'showcase: v1 streamed with walls',
    '887f27aa': 'showcase: v1 streamed with walls',
    ddea3bba: 'v2 streamed with walls (15 MB .bin)',
    '3994d932': 'stale v1 left beside the current v2, single-file SOG (meta)',
    '534f5d7d': 'stale v3 v5 v7 v9 beside the current v10, meta',
    '9c1aba09': 'stale v3 SOG beside the current v5 streamed: the format changed between versions',
    f41cc5f3: 'stale v2 three below the current v5 (the widest gap in the catalogue), meta',
    d2d4ae2d: 'v26, meta',
    cdf3de4b: 'v28 (the highest in the catalogue), streamed',
    '49b32aba': 'v1 from 2025 in the older SOGS layout (meta)',
    cc75cd86: 'v1 streamed, lod-meta.json stored gzip-encoded (recent uploads)',
    ed14f498: 'v1 streamed with walls, lod-meta.json stored gzip-encoded',
    '8830149e': 'v1 legacy compressed PLY',
    '528c3eea': 'v1 legacy compressed PLY (2025, format field empty in the API)',
    '00000000': 'no such scene'
};

async function status(url, head) {
    for (let i = 0; i < 3; i++) {
        try {
            const r = await fetch(url, head ? { method: 'HEAD' } : undefined);
            const body = head ? '' : await r.text();
            if (r.status < 500) return { s: r.status, body, enc: r.headers.get('content-encoding') };
        } catch { /* retry */ }
    }
    throw new Error(`no stable answer for ${url}`);
}

async function pool(jobs, n = 8) {
    const out = new Array(jobs.length);
    let next = 0;
    await Promise.all(Array.from({ length: n }, async () => {
        while (next < jobs.length) {
            const i = next++;
            out[i] = await jobs[i]();
        }
    }));
    return out;
}

const scenes = {};
for (const [id, why] of Object.entries(SCENES)) {
    const vs = Array.from({ length: MAX_V }, (_, i) => i + 1);
    const got = await pool(vs.map((v) => () => status(`${CDN}/${id}/v${v}/settings.json`, false)));
    const settings = got.map((g) => g.s);
    const bodies = {};
    got.forEach((g, i) => { if (g.s === 200) bodies[String(i + 1)] = JSON.parse(g.body); });
    const dirs = [1, ...vs.filter((v, i) => settings[i] === 200 && v !== 1)];
    const keys = dirs.flatMap((v) => FILES.map((f) => `v${v}/${f}`));
    const heads = await pool(keys.map((k) => () => status(`${CDN}/${id}/${k}`, true)));
    const files = Object.fromEntries(heads.map((g, i) => [keys[i], g.s]));
    const encoded = keys.filter((k, i) => heads[i].s === 200 && heads[i].enc);
    scenes[id] = { why, settings, files, encoded, bodies };
    console.log(id, 'settings in', dirs.filter((v) => settings[v - 1] === 200).join(',') || '-', JSON.stringify(files));
}

// one scene per line; anything outside ASCII escaped so the fixture stays plain ASCII
const NL = String.fromCharCode(10);
const rows = Object.entries(scenes).map(([id, s]) => `  ${JSON.stringify(id)}: ${JSON.stringify(s)}`);
const text = ['{', ` "recorded": ${JSON.stringify(new Date().toISOString())},`, ` "cdn": ${JSON.stringify(CDN)},`, ' "scenes": {', rows.join(`,${NL}`), ' }', '}', ''].join(NL);
let ascii = '';
for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i); // UTF-16 units: a pair becomes two escapes, which JSON reads back
    ascii += u < 128 ? text[i] : `\\u${u.toString(16).padStart(4, '0')}`;
}
writeFileSync(fileURLToPath(new URL('./cdn-layout.json', import.meta.url)), ascii);

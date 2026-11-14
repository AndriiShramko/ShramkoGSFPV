// Published walls on the wire (walls stage V1-finish): for every <id>/v<N>/scene.voxel.bin under a release dir,
// the bytes on disk, after gzip -9 (what nginx gzip_static sends when a .gz sits beside the file) and after
// brotli (for comparison; the hub's nginx has no brotli module). With --write it leaves scene.voxel.bin.gz
// beside each bin (gzip_static serves it to every browser that accepts gzip).
// Usage: node tools/walls/wire-size.mjs <release dir> [--write] [--brotli <quality 0-11>]
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const args = process.argv.slice(2);
const dir = args[0];
const write = args.includes('--write');
const bi = args.indexOf('--brotli');
const bq = bi >= 0 ? Number(args[bi + 1]) : 9;
const rows = [];
for (const id of readdirSync(dir)) {
    const p = join(dir, id);
    if (!statSync(p).isDirectory()) continue;
    for (const v of readdirSync(p)) {
        const bin = join(p, v, 'scene.voxel.bin');
        if (!existsSync(bin)) continue;
        const raw = readFileSync(bin);
        let t = Date.now();
        const gz = gzipSync(raw, { level: 9 });
        const gzS = (Date.now() - t) / 1000;
        t = Date.now();
        const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: bq, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
        const brS = (Date.now() - t) / 1000;
        if (write) writeFileSync(bin + '.gz', gz);
        const row = { id, v, raw: raw.length, gzip9: gz.length, gzipShare: +(gz.length / raw.length).toFixed(4), gzipS: gzS, brotli: br.length, brotliQ: bq, brotliShare: +(br.length / raw.length).toFixed(4), brotliS: brS };
        rows.push(row);
        console.log(JSON.stringify(row));
    }
}
const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
console.log(JSON.stringify({ total: { raw: sum('raw'), gzip9: sum('gzip9'), brotli: sum('brotli') } }));

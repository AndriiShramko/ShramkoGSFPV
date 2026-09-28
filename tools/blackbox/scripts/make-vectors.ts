// Turn a CSV written by the official blackbox_decode into the compact test vector the decoder test
// checks: the column list, the row count, a SHA-256 of the rows in canonical form, and a few rows in
// clear. Run once per fixture; the output is committed next to the fixture.
//
//   npx tsx tools/blackbox/scripts/make-vectors.ts <excerpt.bbl> <official.csv> <out.json> "<source note>" [--drop-last]
//
// --drop-last: the excerpt was cut in the middle of a frame. blackbox_decode (master) still emits
// that frame (it does not check the byte after a frame), with the missing bytes read as zero;
// our decoder drops it. The vector leaves it out.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [bbl, csv, out, note] = process.argv.slice(2);
const dropLast = process.argv.includes('--drop-last');
const lines = readFileSync(csv, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
const header = lines[0].split(',').map((s) => s.trim().replace(/\s*\(.*\)\s*$/, ''));
const rows = lines.slice(1, dropLast ? -1 : undefined).map((l) => l.split(',').map((s) => Number(s.trim())));
const canon = rows.map((r) => r.join(',')).join('\n');
const vec = {
    note,
    excerptSha256: createHash('sha256').update(readFileSync(bbl)).digest('hex'),
    decoder: 'blackbox_decode (github.com/betaflight/blackbox-tools, master f832acf9cd9dbe5ad8220de1a5f4eb4021523d72) --unit-vbat raw --unit-amperage raw --unit-flags raw',
    columns: header,
    rows: rows.length,
    rowsSha256: createHash('sha256').update(canon).digest('hex'),
    firstRows: rows.slice(0, 3),
    lastRow: rows[rows.length - 1]
};
writeFileSync(out, JSON.stringify(vec, null, 1) + '\n');
console.log(`${rows.length} rows, ${header.length} columns -> ${out}`);

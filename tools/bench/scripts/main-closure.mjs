// What a page of the simulator downloads before it runs: the entry chunk and every chunk it imports statically (transitively), each
// compressed on its own as a server sends it (gzip level 6 and 9, brotli). Since Fly by Sound loads lazily (docs/wip/v12-int.md step 4)
// Rolldown moves the modules main shares with the lazy chunks into chunks main imports statically, so main-*.js alone understates
// what every visitor fetches: measure this closure instead. The base of v0.12 (v03-lead a1ea872) is 2,911,471 B, 838,687 gzip level 9.
//   node tools/bench/scripts/main-closure.mjs apps/fly/dist/assets            (after `vite build` in apps/fly, or dist/fly/assets of a release)
//   node tools/bench/scripts/main-closure.mjs <assets> '^admin-.*\.js$'        (another entry)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const dir = process.argv[2];
if (!dir) throw new Error('usage: main-closure.mjs <assets folder> [entry file regex]');
const entryRe = new RegExp(process.argv[3] ?? '^main-.*\\.js$');
const entry = readdirSync(dir).find((f) => entryRe.test(f));
if (!entry) throw new Error(`no entry matching ${entryRe} in ${dir}`);
const order = [];
const seen = new Set();
const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    order.push(f);
    const src = readFileSync(join(dir, f), 'utf8');
    // static imports only: `import ... from "./x.js"` and `import "./x.js"`; a dynamic import("./x.js") is not followed
    const re = /(?:^|[;\s}])(?:import|export)\s*(?:[\w${},*\s]+from\s*)?["']\.\/([\w.$-]+\.js)["']/g;
    for (const m of src.matchAll(re)) visit(m[1]);
};
visit(entry);
const total = { raw: 0, gz6: 0, gz9: 0, br: 0 };
const files = order.map((f) => {
    const b = readFileSync(join(dir, f));
    const row = { file: f, raw: b.length, gz6: zlib.gzipSync(b).length, gz9: zlib.gzipSync(b, { level: 9 }).length, br: zlib.brotliCompressSync(b).length };
    for (const k of Object.keys(total)) total[k] += row[k];
    return row;
});
console.log(JSON.stringify({ entry, files, total }, null, 1));

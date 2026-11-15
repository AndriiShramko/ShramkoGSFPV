// Lane course3 F2-fast-course: summary of a V8 .cpuprofile (node --cpu-prof): per function the self and the inclusive
// time (a function counted once per sample however deep it recurs) and the sample count, top N of each.
//   node tools/bench/scripts/cpuprof-top.mjs <file.cpuprofile> [N]
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const N = Number(process.argv[3] ?? 25);
const prof = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map();
for (const n of prof.nodes) byId.set(n.id, n);
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const keyOf = (n) => {
    const f = n.callFrame;
    const url = (f.url || '').replace(/^.*\/(packages|apps|tools|node_modules)\//, '$1/');
    return `${f.functionName || '(anon)'} ${url}:${f.lineNumber + 1}`;
};
const self = new Map(), incl = new Map();
const deltas = prof.timeDeltas ?? [];
let total = 0;
for (let i = 0; i < prof.samples.length; i++) {
    const dt = (deltas[i + 1] ?? deltas[i] ?? 0) / 1000;
    total += dt;
    let id = prof.samples[i];
    const k0 = keyOf(byId.get(id));
    self.set(k0, (self.get(k0) ?? 0) + dt);
    const seen = new Set();
    while (id !== undefined) {
        const k = keyOf(byId.get(id));
        if (!seen.has(k)) {
            seen.add(k);
            incl.set(k, (incl.get(k) ?? 0) + dt);
        }
        id = parent.get(id);
    }
}
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, N).map(([k, v]) => `${Math.round(v)}\t${k}`).join('\n');
console.log(`total ms ${Math.round(total)}`);
console.log('--- inclusive ms');
console.log(top(incl));
console.log('--- self ms');
console.log(top(self));

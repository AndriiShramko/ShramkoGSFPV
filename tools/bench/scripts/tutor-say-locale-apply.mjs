// Lane tutor-say S3: applies tools/bench/scripts/tutor-say-locale-patch.json to the four fly/sonic dictionaries (the same keys in
// en, es, pl, ru): deletes the keys under "delete", sets every key under "set" in each language (a new key goes in sorted place
// among its prefix, an old one keeps its place). Run: node tools/bench/scripts/tutor-say-locale-apply.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../../packages/i18n/locales/fly/sonic/', import.meta.url);
const patch = JSON.parse(readFileSync(new URL('./tutor-say-locale-patch.json', import.meta.url), 'utf8'));
for (const l of ['en', 'es', 'pl', 'ru']) {
    const file = new URL(`${l}.json`, root);
    const d = JSON.parse(readFileSync(file, 'utf8'));
    for (const k of patch.delete) delete d[k];
    let entries = Object.entries(d);
    for (const [k, v] of Object.entries(patch.set)) {
        if (typeof v[l] !== 'string') throw new Error(`${k}: no ${l}`);
        const i = entries.findIndex(([x]) => x === k);
        if (i >= 0) entries[i] = [k, v[l]];
        else {
            // after the last key that sorts before it, so a new family stays together
            let at = entries.length;
            for (let j = 0; j < entries.length; j++) if (entries[j][0] < k) at = j + 1;
            entries.splice(at, 0, [k, v[l]]);
        }
    }
    writeFileSync(file, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
    console.log(l, entries.length);
}

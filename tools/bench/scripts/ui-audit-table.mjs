// Lane uiaudit: the panel table of docs/wip/uiaudit.md from the JSON files of ui-audit-probe.mjs.
// Usage: node ui-audit-table.mjs <prefix> [sizes]   (reads <prefix><WxH>.json for each size; prints markdown)
// One row per panel. Per size: the panel's rectangle, IN (whole in view) or OUT, S (scrolls inside), CLIP
// (taller than its box or the view and no scroll); then the first close control: WxH, out (off the view),
// cov (something lies over it). Ways: which of Esc, the same key or chip, a click outside, the close control
// closed it (y/n, '-' not tried). Min font: the smallest text over all sizes.
import { readFileSync, existsSync } from 'node:fs';
const [prefix, sizesArg] = process.argv.slice(2);
const sizes = (sizesArg ?? '1920x1080,1366x768,1280x720,844x390,390x844').split(',');
const runs = Object.fromEntries(sizes.filter((s) => existsSync(`${prefix}${s}.json`)).map((s) => [s, JSON.parse(readFileSync(`${prefix}${s}.json`, 'utf8'))]));
const names = [...new Set(Object.values(runs).flatMap((r) => Object.keys(r.panels)))];
const yn = (v) => (v === true ? 'y' : v === false ? 'n' : v === undefined ? '-' : String(v));
const rows = [];
rows.push(`| panel | opens with | ${sizes.join(' | ')} | Esc / again / outside / control | min font | no name or symbol only |`);
rows.push(`|${'---|'.repeat(sizes.length + 5)}`);
for (const n of names) {
    const cells = [];
    let open = '', ways = '', minFont = Infinity;
    const bad = new Set();
    for (const s of sizes) {
        const p = runs[s]?.panels[n];
        if (!p) { cells.push('n/a'); continue; }
        open ||= p.open;
        if (p.missing || !p.m) { cells.push(p.error ? 'error' : 'none'); continue; }
        const m = p.m;
        const c = m.closers.find((x) => x.tag !== 'summary' || n === 'walls-menu' || n === 'credit') ?? null;
        const where = `${m.rect.w}x${m.rect.h}@${m.rect.x},${m.rect.y} ${m.inView ? 'IN' : 'OUT'}${m.scrolls ? ' S' : ''}${m.clipped ? ' CLIP' : ''}`;
        const close = c ? ` x:${c.rect.w}x${c.rect.h}${c.inView ? '' : ' out'}${c.covered ? ` cov(${c.coveredBy ?? c.covered})` : ''}` : ' x:none';
        cells.push(where + close + (m.coversOthersClose.length ? ` OVER(${m.coversOthersClose.join(',')})` : ''));
        if (m.minFont !== null && m.minFont < minFont) minFont = m.minFont;
        for (const b of [...m.noName.map((x) => `noname ${x}`), ...m.symbolOnly]) bad.add(b);
        if (!ways && p.ways) {
            const w = p.ways; const ctl = Object.keys(w).find((k) => k.startsWith('control:'));
            ways = `${yn(w.esc)} / ${yn(w.again)} / ${yn(w.outside)} / ${ctl ? `${yn(w[ctl])} (${ctl.slice(8, 30)})` : '-'}`;
        }
    }
    rows.push(`| ${n} | ${open} | ${cells.join(' | ')} | ${ways || '-'} | ${minFont === Infinity ? '-' : minFont} | ${[...bad].slice(0, 4).join('; ').replace(/\|/g, '/') || '-'} |`);
}
console.log(rows.join('\n'));

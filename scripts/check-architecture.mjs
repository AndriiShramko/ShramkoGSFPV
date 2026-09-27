// Architecture rules that CI enforces (a light replacement for dependency-cruiser):
//  1. packages/sim-core imports nothing outside itself and never touches DOM globals.
//  2. packages/collision imports nothing but itself (vendored code + our wrappers), no DOM.
//  3. apps/site never imports playcanvas or the simulator packages.
//  4. no Betaflight-looking identifiers were pasted into our sources (formulas only, no GPL code).
//  5. packages/prefs touches no DOM globals outside src/browser.ts (v0.3 design 1.4), so the store,
//     the schema and the catalogue builder run in Node tests and in the catalogue generator.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const problems = [];

function walk(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const n of readdirSync(dir)) {
        if (n === 'node_modules' || n === '.next' || n === 'out' || n === 'dist') continue;
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx|mjs|js)$/.test(n)) out.push(p);
    }
    return out;
}

const importRe = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
function imports(file) {
    const s = readFileSync(file, 'utf8');
    const out = [];
    let m;
    while ((m = importRe.exec(s))) out.push(m[1] ?? m[2]);
    return { s, out };
}

const DOM = /\b(window|document|navigator|localStorage|requestAnimationFrame|HTMLElement)\s*[.(]/;

for (const f of walk(join(ROOT, 'packages', 'sim-core', 'src'))) {
    const { s, out } = imports(f);
    for (const i of out) if (!i.startsWith('.')) problems.push(`sim-core imports ${i} (${f})`);
    if (DOM.test(s)) problems.push(`sim-core touches the DOM (${f})`);
    if (/Math\.(random|sin|cos|tan|atan2?|exp|log|pow)\s*\(/.test(s) && !f.endsWith('dmath.ts')) problems.push(`sim-core uses non-deterministic Math (${f})`);
    if (/\bDate\.now\s*\(|performance\.now\s*\(/.test(s)) problems.push(`sim-core reads a clock (${f})`);
}
for (const f of walk(join(ROOT, 'packages', 'collision', 'src'))) {
    const { s, out } = imports(f);
    for (const i of out) if (!i.startsWith('.')) problems.push(`collision imports ${i} (${f})`);
    if (DOM.test(s)) problems.push(`collision touches the DOM (${f})`);
}
// Rule 5 (design 1.4), wider than DOM above: the store must not reach storage, the page or IndexedDB
// by itself either. It reads code only: comments, string literals, template text and regex literals
// are blanked first (prefs prose says "the document (A.4)" everywhere), while the code inside a
// template's ${...} stays. Any use of a global's name counts, not only `name.` or `name(`: a bare
// `window`, `const ls = localStorage`, `globalThis.indexedDB ?? null` all reach the page (the
// review's bypasses, docs/wip/wave1-reports.json prefsReview). globalThis and self count by
// themselves, so an alias (`const G = globalThis`) or an index (`globalThis['localStorage']`) is
// caught too. Not counted: a property access (`o.location`), and an object key or type member
// (`{ document: 1 }`, `{ location: string }`).
const PREFS_GLOBALS = ['window', 'self', 'globalThis', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'indexedDB', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'HTMLElement'];
const PREFS_DOM = new RegExp(`(?<![\\w$.])(?:${PREFS_GLOBALS.join('|')})(?![\\w$])`, 'g');
/** `{ document: 1 }`, `(o: { location: string; ... })`: a key or member, not the global */
const isKey = (code, at, len) => /[{,;]\s*$/.test(code.slice(Math.max(0, at - 40), at)) && /^\s*\??:/.test(code.slice(at + len, at + len + 8));
function prefsDomHits(code) {
    return [...code.matchAll(PREFS_DOM)].filter((m) => !isKey(code, m.index, m[0].length)).map((m) => m[0]);
}
const PREFS_BROWSER = join(ROOT, 'packages', 'prefs', 'src', 'browser.ts');
/** Keywords after which a `/` starts a regex literal, not a division. */
const REGEX_AFTER_WORD = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|instanceof|yield|await)$/;
/**
 * The code of a JS/TS source with comments, string literals, template text and regex literals
 * replaced by spaces (line breaks kept). A small scanner, not a parser: enough to tell text from code.
 */
function codeOnly(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    const blank = (s) => s.replace(/[^\n]/g, ' ');
    /** open `${` expressions: the brace depth inside each */
    const tpl = [];
    let last = ''; // the code emitted so far, trimmed, for the regex-or-division choice
    const emit = (s) => { out += s; if (/\S/.test(s)) last = (last + s).slice(-32).trimEnd(); };
    const text = (from, to) => { out += blank(src.slice(from, to)); };
    /** scans a template's text from i (after ` or }) to its end or to the next ${ */
    const templateText = () => {
        const start = i;
        while (i < n && src[i] !== '`' && !(src[i] === '$' && src[i + 1] === '{')) i += src[i] === '\\' ? 2 : 1;
        text(start, i);
        if (src[i] === '`') { out += ' '; i++; last = '"'; return; }
        if (i < n) { out += '  '; i += 2; tpl.push(0); last = '{'; }
    };
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; text(i, end); i = end; continue; }
        if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; text(i, end); i = end; continue; }
        if (c === "'" || c === '"') {
            const start = i++;
            while (i < n && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
            i++;
            text(start, Math.min(i, n));
            last = '"';
            continue;
        }
        if (c === '`') { out += ' '; i++; templateText(); continue; }
        if (c === '/' && (last === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || REGEX_AFTER_WORD.test(last))) {
            const start = i++;
            let cls = false;
            while (i < n && src[i] !== '\n' && (cls || src[i] !== '/')) {
                if (src[i] === '\\') i++;
                else if (src[i] === '[') cls = true;
                else if (src[i] === ']') cls = false;
                i++;
            }
            i++;
            while (i < n && /[a-z]/i.test(src[i])) i++;
            text(start, Math.min(i, n));
            last = '"';
            continue;
        }
        if (tpl.length && c === '{') tpl[tpl.length - 1]++;
        if (tpl.length && c === '}') {
            if (tpl[tpl.length - 1] === 0) { tpl.pop(); out += ' '; i++; templateText(); continue; }
            tpl[tpl.length - 1]--;
        }
        emit(c);
        i++;
    }
    return out;
}
for (const f of walk(join(ROOT, 'packages', 'prefs', 'src'))) {
    if (f === PREFS_BROWSER) continue;
    const hits = prefsDomHits(codeOnly(readFileSync(f, 'utf8')));
    if (hits.length) problems.push(`prefs touches the DOM outside browser.ts (${f}: ${[...new Set(hits)].join(', ')})`);
}
for (const f of walk(join(ROOT, 'apps', 'site'))) {
    const { out } = imports(f);
    for (const i of out) if (/^(playcanvas|@gsfpv\/(render-pc|sim-core|collision|crash|input|prefs))/.test(i)) problems.push(`site imports ${i} (${f})`);
}
const BF = /\b(currentControlRateProfile|pidRuntime|rcCommandf|applyBetaflightRates|pidCoefficient|FEEDFORWARD_SCALE\s*\*)/;
for (const f of [...walk(join(ROOT, 'packages')), ...walk(join(ROOT, 'apps'))]) {
    if (f.includes(`${join('collision', 'src', 'vendor')}`)) continue;
    const s = readFileSync(f, 'utf8');
    if (BF.test(s)) problems.push(`Betaflight identifier found (${f})`);
}

if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
}
console.log('architecture rules: ok');

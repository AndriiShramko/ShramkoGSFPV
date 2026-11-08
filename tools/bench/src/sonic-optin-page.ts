// v0.12 v12-optin (docs/wip/v12-optin.md): Fly by Sound only for those who choose it, in the real page. A RELEASE build of this tree
// served with nginx's enforced CSP and its /fly/ language redirect (tools/bench/scripts/serve-csp.mjs), headless Chrome on the GPU,
// the keyboard only (and one click on a link, as a sighted pilot would).
//   A  an ordinary page (no ?sonic=, a scan flown logic-only): Fly by Sound is named nowhere until the pause menu is opened, which has
//      one item for it, a link that opens /{lang}/sound/ in a new tab (the flight stays paused under the menu); T U I Z G change
//      nothing (no panel, note, caption, speech, sound context, hook); the pause menu's key list and the K card name none of them; L
//      opens the picture share panel; no chunk and no text of the mode is fetched. In Polish the item is Polish and leads to /pl/sound/.
//   B  a ?sonic= page, the sender ("my screen reader speaks", speed 2, theme Clear and calm mode on, and his own speech and volume
//      settings): the pause menu lists T U I Z G and has the mode's own item, not the ordinary one; I answers; L copies a link with the
//      lesson (in the Winter Garden lesson also its scan and size) and his sound settings, nothing personal, said and put in the
//      captions, which are the live region; K says the keys.
//   C  the receivers (fresh browser profiles, the default sound): the copied link (no language in it) lands on /en/fly/ with the start
//      screen offering that lesson; nothing sounds before a key press; the link's sound is in force (Clear, calm) and not saved; Enter
//      starts that lesson; Keep saves it; the Winter Garden link starts that lesson on its scan at x5; a link to a lesson this release
//      lacks shows the start screen's note instead.
//   D  /en/sound/: its start link is such a link and opens the start screen; its key list has nine keys, L and K among them.
// A check that proves an absence has its control in the same run: the same probe finds the thing where it exists (B for A, A for B).
//   node scripts/build-release.mjs
//   node tools/bench/scripts/serve-csp.mjs dist <port>                       (another shell)
//   cd tools/bench && SITE=http://localhost:<port> npx tsx src/sonic-optin-page.ts
// Holds C:/dev/.gpu-lock. Evidence: evidence/<date>/sonic-optin-page.json (exit 1 when a check fails).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { defaultPrefs } from '../../../packages/sonic-fpv/src';
import type { SonicPrefs } from '../../../packages/sonic-fpv/src';
import { SONIC_LINK_PARAMS, sonicLinkPath } from '../../../packages/scenes/src/sonic-link';
import { launchChrome } from './browser';
import { REPO, writeEvidence } from './evidence';
import { lock, sleep, unlock } from './sonic-garden-pilot';

const SITE = (process.env.SITE ?? '').replace(/\/$/, '');
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(SITE)) throw new Error('SITE=http://localhost:<port> of a local release build is needed (never the live site)');
console.log(`sonic-optin-page target: ${SITE}`);
process.on('SIGINT', () => {
    unlock();
    process.exit(130);
});

const fly = (l: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const ns of ['sonicentry', 'sonic']) Object.assign(out, JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', ns, `${l}.json`), 'utf8')) as Record<string, string>);
    return out;
};
const SITE_EN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'site', 'en.json'), 'utf8')) as { sound: { h1: string; start: { button: string } } };
const EN = fly('en');
const PL = fly('pl');
const SOUND_KEYS = ['KeyT', 'KeyU', 'KeyI', 'KeyZ', 'KeyG'];
const SOUND_CAPS = ['T', 'U', 'I', 'Z', 'G'];
const SOUND_ACTIONS = ['sonic.record', 'sonic.send', 'sonic.status', 'sonic.repeat', 'sonic.glossary'];
/** Texts that are only in the mode's chunks now (the start screen's intro, a key of the mode's, a v12-optin text). */
const MARKERS = ['Learn to fly a drone by ear', 'Fly by Sound: start or stop recording', 'sonic.link.keep'];

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 300)}`);
};

/** The prefs document a profile starts from: the warning seen, and these sound settings. */
const doc = (sonic: Partial<SonicPrefs>): object => ({
    format: 'gsfpv-prefs',
    version: SCHEMA_VERSION,
    app: '0.3.0',
    savedAt: '2026-11-08T00:00:00.000Z',
    settings: { global: {}, drone: {}, scene: {} },
    collections: { sonic: { v: 1, prefs: { ...defaultPrefs(), ...sonic }, progress: {}, current: null }, ui: { v: 1, warned: true } }
});
/** The page's init script: the prefs above (once), a count of AudioContexts made, every line given to the browser's voice. */
const initScript = (d: object): string => `(() => {
  window.__name = (f) => f;
  try { if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(d))}); } catch (e) {}
  const Orig = window.AudioContext;
  window.__acCount = 0;
  if (Orig) window.AudioContext = class extends Orig { constructor(o) { super(o); window.__acCount++; } };
  window.__spoken = [];
  try { const s = window.speechSynthesis; const sp = s.speak.bind(s); s.speak = (u) => { window.__spoken.push(u.text); return sp(u); }; } catch (e) {}
})();`;

/** Polls `read` until `pred` (no waitForFunction: the release's CSP refuses a predicate made with new Function). */
async function until<T>(what: string, read: () => Promise<T>, pred: (v: T) => boolean, ms = 30000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
        const v = await read();
        if (pred(v)) return v;
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v).slice(0, 400)}`);
        await sleep(100);
    }
}

interface Watch {
    errors: string[];
    requests: string[];
    scripts: { url: string; found: string[] }[];
    done: () => Promise<void>;
}
/** Page errors, every request, and the markers found in every script and style the page fetched. */
function watch(page: Page): Watch {
    const w: Watch = { errors: [], requests: [], scripts: [], done: async () => undefined };
    const pending: Promise<void>[] = [];
    page.on('pageerror', (e) => w.errors.push(e.message.slice(0, 300)));
    page.on('request', (r) => w.requests.push(new URL(r.url()).pathname));
    page.on('response', (r) => {
        if (r.status() >= 400 && !/\/favicon\.ico$/.test(r.url())) w.errors.push(`${r.status()} ${r.url()}`.slice(0, 300));
        const type = r.request().resourceType();
        if (type !== 'script' && type !== 'stylesheet') return;
        pending.push(r.text().then((body) => void w.scripts.push({ url: new URL(r.url()).pathname, found: MARKERS.filter((m) => body.includes(m)) })).catch(() => undefined));
    });
    w.done = async () => void (await Promise.all(pending));
    return w;
}
const MODE_CHUNK = /\/fly\/assets\/(lazy-start|feature|session)-[\w-]+\.js$/;

interface Snap {
    panels: number;
    sonicStart: boolean;
    captions: string | null;
    recorder: boolean;
    hookSonic: string;
    hookLink: unknown;
    spoken: number;
    contexts: number;
    note: string | null;
    title: string;
}
/** What a key could have changed on the page: panels shown, the mode's start screen, captions and recorder, hooks, speech, sound, the HUD's note. */
const snap = (page: Page): Promise<Snap> =>
    page.evaluate(() => {
        const w = window as unknown as { __gsfpv?: Record<string, unknown>; __spoken?: string[]; __acCount?: number };
        const shown = (e: Element): boolean => !(e as HTMLElement).hidden && e.getClientRects().length > 0;
        const note = document.querySelector<HTMLElement>('.hud-note');
        const cap = document.querySelector('[data-testid="sonic-captions"]');
        return {
            panels: [...document.querySelectorAll('.panel')].filter(shown).length,
            sonicStart: !!document.querySelector('.sonic-start'),
            captions: cap ? cap.textContent : null,
            recorder: !!document.querySelector('.sonicrec-toggle'),
            hookSonic: typeof w.__gsfpv?.sonic,
            hookLink: w.__gsfpv?.sonicLink ?? null,
            spoken: (w.__spoken ?? []).length,
            contexts: w.__acCount ?? 0,
            note: note && !note.hidden ? note.textContent : null,
            title: document.title
        };
    });

const ready = (page: Page): Promise<string | null> => page.evaluate(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status ?? null);

interface SpeechEvent { kind: string; key?: string; text?: string }
interface Probe { lesson: string | null; events: SpeechEvent[]; walls: { scene: string; scale: number; builtin: boolean } }
const probe = (page: Page): Promise<Probe | null> =>
    page.evaluate(() => {
        const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: (e?: boolean) => unknown } }).__gsfpv;
        return h?.status === 'ready' && h.sonic ? (h.sonic(true) as Probe) : null;
    });
const spokenSince = (p: Probe | null, n: number): SpeechEvent[] => (p ? p.events.slice(n).filter((e) => e.kind === 'speech' && e.key !== 'speech.end') : []);
const eventCount = async (page: Page): Promise<number> => (await probe(page))?.events.length ?? 0;
const savedSound = (page: Page): Promise<{ theme?: string; calm?: boolean } | null> =>
    page.evaluate(() => {
        try {
            return (JSON.parse(localStorage.getItem('gsfpv.prefs.v1') ?? 'null') as { collections?: { sonic?: { prefs?: { theme?: string; calm?: boolean } } } } | null)?.collections?.sonic?.prefs ?? null;
        } catch {
            return null;
        }
    });

/** The pause menu (Esc), then what it shows: its items, the actions and caps of its key list, how often it names the mode. */
async function pauseMenu(page: Page): Promise<{ items: string[]; keys: { action: string; caps: string[] }[]; sound: { href: string | null; target: string | null; rel: string | null; text: string; tag: string } | null; namesInMenu: number; namesInBody: number }> {
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pause-menu', { timeout: 10000 });
    return page.evaluate(() => {
        const menu = document.querySelector('.pause-menu') as HTMLElement;
        const count = (s: string): number => s.split('Fly by Sound').length - 1;
        const a = menu.querySelector<HTMLElement>('[data-action="pause.sound"]');
        return {
            items: [...menu.querySelectorAll<HTMLElement>('.sum-menu [data-action]')].map((e) => e.dataset.action ?? ''),
            keys: [...menu.querySelectorAll<HTMLElement>('[data-testid="summary-keys"] [data-key-action]')].map((li) => ({ action: li.dataset.keyAction ?? '', caps: [...li.querySelectorAll('kbd')].map((k) => k.textContent ?? '') })),
            sound: a ? { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), text: a.textContent ?? '', tag: a.tagName } : null,
            namesInMenu: count(menu.innerText),
            namesInBody: count(document.body.innerText)
        };
    });
}

// ------------------------------------------------------------------ A: an ordinary page

async function ordinary(ctx: BrowserContext, out: Record<string, unknown>): Promise<void> {
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(`${SITE}/en/fly/?scene=39e63ce9&nowarn=1&render=off`);
    await until('the flight', () => ready(page), (v) => v === 'ready', 120000);
    await sleep(1500);
    const before = await page.evaluate(() => document.body.innerText.split('Fly by Sound').length - 1);
    check('A: an ordinary flight names Fly by Sound nowhere on the page before the pause menu is opened', before === 0, { occurrences: before });

    // a key no binding has, so the page's own first-key effects (the motor sound's AudioContext) are behind us
    await page.keyboard.press('KeyJ');
    await sleep(600);
    const keys: { key: string; changed: string[] }[] = [];
    for (const code of SOUND_KEYS) {
        const a = await snap(page);
        await page.keyboard.press(code);
        await sleep(700);
        const b = await snap(page);
        keys.push({ key: code, changed: (Object.keys(a) as (keyof Snap)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])) });
    }
    out.plainKeys = keys;
    check('A: T U I Z G change nothing on an ordinary page (no panel, start screen, caption, recorder, hook, speech, sound context or HUD note)', keys.every((k) => k.changed.length === 0), keys);

    const menu = await pauseMenu(page);
    out.plainMenu = menu;
    const capsListed = menu.keys.flatMap((k) => k.caps);
    check('A: the pause menu\'s key list names none of the mode\'s keys (no sonic.* row, no T U I Z G cap); it lists 20 shortcuts and the flying keys', menu.keys.length > 0 && !menu.keys.some((k) => k.action.startsWith('sonic.')) && !SOUND_CAPS.some((c) => capsListed.includes(c)), { rows: menu.keys.length, actions: menu.keys.map((k) => k.action) });
    check('A: the pause menu has exactly one item for the mode, a link to /en/sound/ in a new tab, worded "Fly by Sound: audio-only training for blind pilots (beta)"', menu.items.filter((i) => i === 'pause.sound').length === 1 && !menu.items.includes('pause.sonic') && menu.sound?.tag === 'A' && menu.sound.href === '/en/sound/' && menu.sound.target === '_blank' && (menu.sound.rel ?? '').includes('noopener') && menu.sound.text === EN['sonic.menu.page'], menu.sound);
    check('A: with the menu open the page names Fly by Sound once: that item', menu.namesInMenu === 1 && menu.namesInBody === 1, { menu: menu.namesInMenu, body: menu.namesInBody });

    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), page.click('[data-action="pause.sound"]')]);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForSelector('h1', { timeout: 15000 });
    const landed = await popup.evaluate(() => ({ url: location.pathname, h1: document.querySelector('h1')?.textContent ?? '', start: [...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === '/en/fly/?sonic=start').length }));
    const stillPaused = await page.evaluate(() => !!document.querySelector('.pause-menu'));
    out.plainPopup = { ...landed, stillPaused };
    check('A: the item opens /en/sound/ (the page about the mode, its start button inside) in a new tab; the flight stays paused under its menu', landed.url === '/en/sound/' && landed.h1 === SITE_EN.sound.h1 && landed.start === 1 && stillPaused, out.plainPopup);
    await popup.close();
    await page.keyboard.press('Escape');
    await until('the menu to close', () => page.evaluate(() => !document.querySelector('.pause-menu')), (v) => v, 5000);

    await page.keyboard.press('KeyK');
    const card = await until('the K card', () => page.evaluate(() => {
        const c = document.querySelector('[data-testid="how-to-fly"]') as HTMLElement | null;
        return c ? { text: c.innerText, caps: [...c.querySelectorAll('kbd')].map((k) => k.textContent ?? '') } : null;
    }), (v) => v !== null, 10000);
    out.plainCard = card;
    check('A: K opens the "How to fly" card, which names neither the mode nor its keys', !!card && !card.text.includes('Fly by Sound') && !SOUND_CAPS.some((c) => card.caps.includes(c)), card?.caps);
    await page.keyboard.press('Escape');
    await sleep(500);

    await page.keyboard.press('KeyL');
    const share = await until('the share panel', () => page.evaluate(() => ({ panel: !!document.querySelector('.panel.share'), link: (window as unknown as { __gsfpv: { sonicLink?: unknown } }).__gsfpv.sonicLink ?? null })), (v) => v.panel, 10000).catch(() => ({ panel: false, link: null }));
    check('A: L opens the picture share panel, not a link of the mode (control of B\'s L)', share.panel && share.link === null, share);
    await page.keyboard.press('Escape');
    await sleep(300);

    await w.done();
    const chunks = w.requests.filter((u) => MODE_CHUNK.test(u));
    const holding = w.scripts.filter((s) => s.found.length > 0);
    out.plainFetched = { scripts: w.scripts.map((s) => s.url), chunks, holding };
    check('A: no chunk of the mode was requested (lazy-start, feature, session) and no fetched script or style holds a text of the mode', w.scripts.length >= 3 && chunks.length === 0 && holding.length === 0, { chunks, holding });
    check('A: no page error', w.errors.length === 0, w.errors);
    await page.close();

    // the same item in Polish: its words and its address in the page's language
    const pl = await ctx.newPage();
    await pl.goto(`${SITE}/pl/fly/?scene=39e63ce9&nowarn=1&render=off`);
    await until('the Polish flight', () => ready(pl), (v) => v === 'ready', 120000);
    await sleep(800);
    const plMenu = await pauseMenu(pl);
    out.plainPolish = plMenu.sound;
    check('A: in Polish the item says the Polish line and leads to /pl/sound/', plMenu.sound?.href === '/pl/sound/' && plMenu.sound.text === PL['sonic.menu.page'], plMenu.sound);
    await pl.close();
}

// ------------------------------------------------------------------ B: the sender in the mode

async function sender(ctx: BrowserContext, out: Record<string, unknown>): Promise<{ hover: string; garden: string }> {
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(`${SITE}/en/fly/?sonic=hover-height`);
    await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    await until('the lesson', () => probe(page), (p) => p?.lesson === 'hover-height', 90000);
    await sleep(1500);

    const menu = await pauseMenu(page);
    out.modeMenu = { items: menu.items, keys: menu.keys.filter((k) => k.action.startsWith('sonic.')) };
    const modeKeys = menu.keys.filter((k) => SOUND_ACTIONS.includes(k.action));
    check('B (control of A): in the mode the pause menu lists T U I Z G with their caps, and has the mode\'s own item, not the ordinary one', modeKeys.map((k) => k.caps.join('')).join(' ') === SOUND_CAPS.join(' ') && menu.items.includes('pause.sonic') && !menu.items.includes('pause.sound'), out.modeMenu);
    await page.keyboard.press('Escape');
    await until('the menu to close', () => page.evaluate(() => !document.querySelector('.pause-menu')), (v) => v, 5000);
    await sleep(500);

    const a = await snap(page);
    const n0 = await eventCount(page);
    await page.keyboard.press('KeyI');
    const said = await until('the status', () => probe(page), (p) => spokenSince(p, n0).some((e) => e.key === 'status.lesson'), 10000);
    await sleep(700);
    const b = await snap(page);
    check('B (control of A): in the mode I answers (status.lesson said, the captions changed): the probe that found A\'s keys idle sees them here', spokenSince(said, n0).some((e) => e.key === 'status.lesson') && a.captions !== b.captions, spokenSince(said, n0).map((e) => e.key));

    // L: the link of this lesson, his sound settings in it, nothing personal
    const n1 = await eventCount(page);
    await page.keyboard.press('KeyL');
    const copied = await until('the link', () => page.evaluate(() => (window as unknown as { __gsfpv: { sonicLink?: { url: string; copied: boolean | null } | null } }).__gsfpv.sonicLink ?? null), (v) => v !== null && v.copied !== null, 10000);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e: Error) => `<read failed: ${e.message.slice(0, 80)}>`);
    const want = `${SITE}${sonicLinkPath({ lesson: 'hover-height', sound: { theme: 'clear', calm: true } })}`;
    const names = [...new URL(copied?.url ?? 'http://x/').searchParams.keys()];
    out.hoverLink = { copied, clipboard: clip, want, names };
    check('B: L copies the link of this lesson with his sound settings: /fly/?sonic=hover-height&st=clear&sc=1, in the clipboard', copied?.copied === true && copied.url === want && clip === want, out.hoverLink);
    check('B: nothing personal in it: only the link\'s own parameters (his speaking speed, screen reader, motor sound and a volume are set and not there)', names.length > 0 && names.every((n) => (Object.values(SONIC_LINK_PARAMS) as string[]).includes(n)) && !/speech|voice|motor|gain|caption|=2(&|$)/i.test(copied?.url ?? ''), names);
    const line = await until('the line', () => probe(page), (p) => spokenSince(p, n1).some((e) => e.key === 'sonic.say.linkCopied'), 10000);
    const caps = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="sonic-captions"]');
        return { live: c?.getAttribute('aria-live') ?? null, text: c?.textContent ?? '' };
    });
    out.hoverSaid = { said: spokenSince(line, n1).map((e) => e.key), captions: caps };
    check('B: it is said (sonic.say.linkCopied) and captioned in the captions region, which is a polite live region in screen-reader mode', caps.live === 'polite' && caps.text.includes(EN['sonic.say.linkCopied'] ?? '<none>'), out.hoverSaid);

    // K: the mode's own key help, said
    const n2 = await eventCount(page);
    await page.keyboard.press('KeyK');
    const help = await until('the key help', () => probe(page), (p) => spokenSince(p, n2).some((e) => e.key === 'help.digits'), 15000);
    const lines = spokenSince(help, n2).filter((e) => (e.key ?? '').startsWith('help.') || e.key === 'sonic.say.helpShare');
    out.keyHelp = lines.map((e) => [e.key, e.text]);
    const order = ['help.intro', 'help.record', 'help.send', 'help.status', 'help.repeat', 'help.glossary', 'sonic.say.helpShare', 'help.reset', 'help.next', 'help.digits'];
    const capsSaid = lines.slice(1, -1).map((e) => /\b([A-Z])\b/.exec((e.text ?? '').replace(/^\w+ /, ''))?.[1] ?? '');
    check('B: K says the mode\'s keys in order, each with its key (T U I Z G L R N), then the digits; no "How to fly" card', lines.map((e) => e.key).join(',') === order.join(',') && capsSaid.join('') === 'TUIZGLRN' && !(await page.$('[data-testid="how-to-fly"]')), { keys: lines.map((e) => e.key), caps: capsSaid });

    // the Winter Garden lesson, chosen on the start screen over the flight: the link names its scan and size
    await pauseMenu(page);
    await page.click('[data-action="pause.sonic"]');
    await page.waitForSelector('#sonic-start:not([hidden])', { timeout: 10000 });
    await page.focus('[data-testid="sonic-lesson"][data-lesson="free-garden"]');
    await page.keyboard.press('Enter');
    const garden = await until('the Winter Garden lesson', () => probe(page), (p) => p?.lesson === 'free-garden' && p.walls.scene === '7a475d38' && !p.walls.builtin, 240000);
    await sleep(1000);
    await page.keyboard.press('KeyL');
    const gl = await until('the garden link', () => page.evaluate(() => (window as unknown as { __gsfpv: { sonicLink?: { url: string; copied: boolean | null } | null } }).__gsfpv.sonicLink ?? null), (v) => v !== null && v.copied !== null && v.url.includes('free-garden'), 10000);
    const wantGarden = `${SITE}${sonicLinkPath({ lesson: 'free-garden', scene: '7a475d38', size: 5, sound: { theme: 'clear', calm: true } })}`;
    out.gardenLink = { link: gl, want: wantGarden, walls: garden?.walls };
    check('B: in the Winter Garden lesson L\'s link names the lesson, its scan and its size: /fly/?sonic=free-garden&scene=7a475d38&sz=5&st=clear&sc=1', gl?.copied === true && gl.url === wantGarden && Math.abs((garden?.walls.scale ?? 0) - 5) < 1e-9, out.gardenLink);

    await w.done();
    const found = new Set(w.scripts.flatMap((s) => s.found));
    out.modeFetched = { chunks: w.requests.filter((u) => MODE_CHUNK.test(u)), found: [...found] };
    check('B (control of A): a ?sonic= page fetches the mode\'s chunks and the texts A did not', ['lazy-start', 'feature', 'session'].every((n) => w.requests.some((u) => MODE_CHUNK.test(u) && u.includes(`/${n}-`))) && MARKERS.every((m) => found.has(m)), out.modeFetched);
    check('B: no page error', w.errors.length === 0, w.errors);
    await page.close();
    return { hover: copied?.url ?? want, garden: gl?.url ?? wantGarden };
}

// ------------------------------------------------------------------ C: the receivers

async function receivers(newCtx: () => Promise<BrowserContext>, links: { hover: string; garden: string }, out: Record<string, unknown>): Promise<void> {
    {
        const ctx = await newCtx();
        const page = await ctx.newPage();
        const w = watch(page);
        await page.goto(links.hover);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await sleep(800);
        const seen = await page.evaluate(() => {
            const first = document.querySelector<HTMLElement>('.sonic-actions button');
            const w2 = window as unknown as { __gsfpv?: { sonic?: unknown }; __acCount?: number };
            return {
                url: location.pathname + location.search,
                first: first ? { testid: first.dataset.testid ?? null, lesson: first.dataset.lesson ?? null, text: first.textContent ?? '' } : null,
                contexts: w2.__acCount ?? 0,
                hook: typeof w2.__gsfpv?.sonic,
                note: document.querySelector('[data-testid="sonic-visit"]')?.textContent ?? null,
                theme: (document.getElementById('sonic-theme') as HTMLSelectElement | null)?.value ?? null,
                calm: (document.getElementById('sonic-calm') as HTMLInputElement | null)?.checked ?? null
            };
        });
        const saved = await savedSound(page);
        out.receiver = { seen, saved };
        check('C: the link, with no language, lands on /en/fly/ with the same query; the start screen offers that lesson first; nothing sounds yet (no AudioContext, no flight)', seen.url === new URL(links.hover).search.replace(/^/, '/en/fly/') && seen.first?.testid === 'sonic-start-asked' && seen.first.lesson === 'hover-height' && seen.contexts === 0 && seen.hook === 'undefined', seen);
        check('C: the link\'s sound is in force for the visit (Clear, calm on; the note names both) and not saved (his saved sound is still Soft, calm off)', seen.theme === 'clear' && seen.calm === true && (seen.note ?? '').includes('Sound theme: Clear') && (seen.note ?? '').includes('Calm mode: on') && saved?.theme === 'soft' && saved.calm === false, out.receiver);
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        const p = await until('the receiver\'s lesson', () => probe(page), (v) => v?.lesson === 'hover-height', 90000);
        await sleep(1000);
        const after = await savedSound(page);
        check('C: Enter starts that lesson; flying it saves nothing of the link\'s sound', p?.lesson === 'hover-height' && after?.theme === 'soft' && after.calm === false, { lesson: p?.lesson, saved: after });
        check('C: no page error', w.errors.length === 0, w.errors);
        await ctx.close();
    }
    {
        const ctx = await newCtx();
        const page = await ctx.newPage();
        await page.goto(links.hover);
        await page.waitForSelector('[data-testid="sonic-visit-keep"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-visit-keep"]');
        await page.keyboard.press('Enter');
        const saved = await until('the kept settings', () => savedSound(page), (v) => v?.theme === 'clear', 5000).catch(() => null);
        const note = await page.evaluate(() => !!document.querySelector('[data-testid="sonic-visit"]'));
        out.keep = { saved, noteLeft: note };
        check('C: "Keep these settings" saves the link\'s sound (Clear, calm on) and the note goes', saved?.theme === 'clear' && saved.calm === true && !note, out.keep);
        await ctx.close();
    }
    {
        const ctx = await newCtx();
        const page = await ctx.newPage();
        await page.goto(links.garden);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        const first = await page.evaluate(() => document.querySelector<HTMLElement>('.sonic-actions button')?.dataset.lesson ?? null);
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        const p = await until('the Winter Garden lesson', () => probe(page), (v) => v?.lesson === 'free-garden' && v.walls.scene === '7a475d38' && !v.walls.builtin, 240000);
        out.gardenReceiver = { first, walls: p?.walls };
        check('C: the Winter Garden link offers that lesson and Enter starts it on its scan (7a475d38) at x5', first === 'free-garden' && p?.walls.scene === '7a475d38' && Math.abs((p?.walls.scale ?? 0) - 5) < 1e-9, out.gardenReceiver);
        await ctx.close();
    }
    {
        const ctx = await newCtx();
        const page = await ctx.newPage();
        await page.goto(`${SITE}/fly/?sonic=rings-ninth&st=clear`);
        await page.waitForSelector('#sonic-start', { timeout: 60000 });
        const seen = await page.evaluate(() => ({ unknown: document.querySelector('[data-testid="sonic-unknown"]')?.textContent ?? null, asked: !!document.querySelector('[data-testid="sonic-start-asked"]') }));
        out.unknownLink = seen;
        check('C (control): a link to a lesson this release lacks opens the start screen with its note and offers no such lesson', (seen.unknown ?? '').includes('rings-ninth') && !seen.asked, seen);
        await ctx.close();
    }
}

// ------------------------------------------------------------------ D: the site's page about the mode

async function soundPage(ctx: BrowserContext, out: Record<string, unknown>): Promise<void> {
    const page = await ctx.newPage();
    await page.goto(`${SITE}/en/sound/`);
    await page.waitForSelector('h1', { timeout: 30000 });
    const want = sonicLinkPath({ lesson: 'start', sound: {} }, '/en/fly/');
    const seen = await page.evaluate((href) => ({
        start: [...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === href).map((a) => a.textContent ?? ''),
        kbd: [...document.querySelectorAll('#sound-keys ~ ul kbd, section[aria-labelledby="sound-keys"] kbd')].map((k) => k.textContent ?? '')
    }), want);
    out.soundPage = seen;
    check('D: /en/sound/: its start link is the mode\'s link (/en/fly/?sonic=start, the same writer as L); its key list has nine keys, L and K among them', seen.start.length === 1 && seen.start[0] === SITE_EN.sound.start.button && seen.kbd.join(' ') === 'T U I Z G R N L K', seen);
    await page.click(`a[href="${want}"]`);
    await page.waitForSelector('#sonic-start', { timeout: 60000 });
    const opened = await page.evaluate(() => ({ url: location.pathname + location.search, beginning: !!document.querySelector('[data-testid="sonic-start-beginning"]'), hook: typeof (window as unknown as { __gsfpv?: { sonic?: unknown } }).__gsfpv?.sonic }));
    check('D: following it opens the mode\'s start screen (nothing runs before a key press)', opened.url === want && opened.beginning && opened.hook === 'undefined', opened);
    await page.close();
}

async function main(): Promise<void> {
    await lock();
    const { browser } = await launchChrome({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const out: Record<string, unknown> = {};
    try {
        const make = async (sonic: Partial<SonicPrefs>, clipboard = false): Promise<BrowserContext> => {
            const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
            if (clipboard) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE });
            await ctx.addInitScript({ content: initScript(doc(sonic)) });
            return ctx;
        };
        // the ordinary pilot: nothing of the mode in his settings
        const plain = await make({});
        await ordinary(plain, out);
        await plain.close();
        // the sender: a screen reader speaks (the engine is silent and the captions are the live region), and his own sound language
        const send = await make({ selfVoice: false, speechRate: 2, theme: 'clear', calm: true, motorSound: true, layerGainDb: { safety: -6 } }, true);
        const links = await sender(send, out);
        await send.close();
        // the receivers: the default sound, a screen reader speaks
        await receivers(() => make({ selfVoice: false, speechRate: 2 }), links, out);
        const site = await make({});
        await soundPage(site, out);
        await site.close();
    } catch (e) {
        check('the run reached its end', false, String(e).slice(0, 400));
    } finally {
        await browser.close().catch(() => undefined);
        unlock();
    }
    const passed = checks.filter((c) => c.pass).length;
    const file = writeEvidence('sonic-optin-page', { site: SITE, checks, passed, total: checks.length, result: out });
    console.log(`${passed} of ${checks.length} checks passed; ${file}`);
    process.exitCode = passed === checks.length && checks.length > 0 ? 0 : 1;
}

main().catch((e) => {
    unlock();
    console.error(e);
    process.exit(2);
});

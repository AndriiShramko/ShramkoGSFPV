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
// The independent review's fixes (docs/wip/v12-optin-review.md), in the same parts:
//   A  the item is one line in en, es, pl and ru at 1280x720 and 375x812 (control: the item as it was wraps in the same menu), last of
//      the menu's items, and says to a screen reader that it opens a new tab (R8); no application region on an ordinary page (R5).
//   B  the flight has the focus in a labelled role="application" region, and gets it back after the pause menu (R5); the mode's key
//      list names L and K as the mode's (R4); K holds the flight while the keys are said and lets it go when they end, a key cuts
//      them, with the "How to fly" card up K closes it (R4); a copied L opens no field (the control of E); the top bar's Share gives
//      the lesson's link in the field, not the picture panel (R3).
//   C  Keep comes after Start and the note describes the primary Start (R6); the running lesson's address keeps what of the link
//      stands; the reviewer's probe: link, Keep, Calm mode off, reload: no note and his value (a reload before Keep still has the
//      note, its control); "Use my own settings" (R2).
//   E  a refused clipboard (writeText rejects, execCommand returns false), the app speaking with captions on and with them off: L
//      selects the link in a focused field, says so with the lesson's name, puts nothing in the captions; Esc goes back (R1).
//   D  also the screen reader's line under the key list (R5).
// A check that proves an absence has its control in the same run: the same probe finds the thing where it exists (B for A, A for B).
// And the whole of A has one more: run with PARTS=A on a build of v0.12 as released (8ce53fb), it must fail where that release
// showed the mode to everyone (EVIDENCE_SUFFIX=-base keeps that evidence apart).
//   node scripts/build-release.mjs
//   node tools/bench/scripts/serve-csp.mjs dist <port>                       (another shell)
//   cd tools/bench && SITE=http://localhost:<port> npx tsx src/sonic-optin-page.ts
// Holds C:/dev/.gpu-lock. Evidence: evidence/<date>/sonic-optin-page.json (exit 1 when a check fails).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { SCHEMA_VERSION, pageBindings } from '../../../packages/prefs/src';
import { defaultPrefs } from '../../../packages/sonic-fpv/src';
import type { SonicPrefs } from '../../../packages/sonic-fpv/src';
import { SONIC_LINK_PARAMS, sonicLinkPath } from '../../../packages/scenes/src/sonic-link';
import { launchChrome } from './browser';
import { REPO, writeEvidence } from './evidence';
import { lock, sleep, unlock } from './sonic-garden-pilot';

const SITE = (process.env.SITE ?? '').replace(/\/$/, '');
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(SITE)) throw new Error('SITE=http://localhost:<port> of a local release build is needed (never the live site)');
/** PARTS=A: the ordinary page only (the control run: a build of the release before this lane, v0.12 at 8ce53fb, must fail it). */
const PARTS = process.env.PARTS;
console.log(`sonic-optin-page target: ${SITE}${PARTS ? `, parts ${PARTS}` : ''}`);
process.on('SIGINT', () => {
    unlock();
    process.exit(130);
});

const fly = (l: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const ns of ['sonicentry', 'sonic']) Object.assign(out, JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', ns, `${l}.json`), 'utf8')) as Record<string, string>);
    return out;
};
const SITE_EN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'site', 'en.json'), 'utf8')) as { sound: { h1: string; start: { button: string }; keys: { reader: string } } };
const EN = fly('en');
const PL = fly('pl');
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
/** The menu item's words in each language (review R8: one line), and the item as it was before the review (the control: two lines). */
const ITEM = Object.fromEntries(LANGS.map((l) => [l, fly(l)['sonic.menu.page'] ?? ''])) as Record<(typeof LANGS)[number], string>;
const ITEM_BEFORE = 'Fly by Sound: audio-only training for blind pilots (beta)';
/** The main dictionary's "(opens in a new tab)" and the mode's key list words for L and K (review R8, R4). */
const MAIN_EN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'en.json'), 'utf8')) as Record<string, string>;
const KEYS_EN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'sonickeys', 'en.json'), 'utf8')) as Record<string, string>;
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
    /** answers of 400 and over from other hosts: the scene CDN answers 403 for the versions of a scan the loader probes and that do not exist */
    elsewhere: string[];
    requests: string[];
    scripts: { url: string; found: string[] }[];
    done: () => Promise<void>;
}
/** Page errors and failed answers of this site, every request, and the markers found in every script and style the page fetched. */
function watch(page: Page): Watch {
    const w: Watch = { errors: [], elsewhere: [], requests: [], scripts: [], done: async () => undefined };
    const pending: Promise<void>[] = [];
    page.on('pageerror', (e) => w.errors.push(e.message.slice(0, 300)));
    page.on('request', (r) => w.requests.push(new URL(r.url()).pathname));
    page.on('response', (r) => {
        if (r.status() >= 400 && !/\/favicon\.ico$/.test(r.url())) (r.url().startsWith(`${SITE}/`) ? w.errors : w.elsewhere).push(`${r.status()} ${r.url()}`.slice(0, 300));
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
async function pauseMenu(page: Page): Promise<{ items: string[]; keys: { action: string; caps: string[]; label: string }[]; sound: { href: string | null; target: string | null; rel: string | null; text: string; label: string; newTab: string; tag: string } | null; namesInMenu: number; namesInBody: number }> {
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pause-menu', { timeout: 10000 });
    return page.evaluate(() => {
        const menu = document.querySelector('.pause-menu') as HTMLElement;
        const count = (s: string): number => s.split('Fly by Sound').length - 1;
        const a = menu.querySelector<HTMLElement>('[data-action="pause.flyBySound"]');
        return {
            items: [...menu.querySelectorAll<HTMLElement>('.sum-menu [data-action]')].map((e) => e.dataset.action ?? ''),
            keys: [...menu.querySelectorAll<HTMLElement>('[data-testid="summary-keys"] [data-key-action]')].map((li) => ({ action: li.dataset.keyAction ?? '', caps: [...li.querySelectorAll('kbd')].map((k) => k.textContent ?? ''), label: li.querySelector(':scope > span:last-child')?.textContent ?? '' })),
            sound: a ? { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), text: a.textContent ?? '', label: a.querySelector('.pm-label')?.textContent ?? '', newTab: a.querySelector('.visually-hidden')?.textContent ?? '', tag: a.tagName } : null,
            namesInMenu: count(menu.innerText),
            namesInBody: count(document.body.innerText)
        };
    });
}

/**
 * Review R8: how many lines the menu item's label takes with each of `texts` in it, in the open menu as it is laid out at this size
 * (the label's height over its line height); the item's own words are put back after.
 */
async function labelLines(page: Page, texts: readonly string[]): Promise<number[]> {
    return page.evaluate((all) => {
        const label = document.querySelector<HTMLElement>('.pause-menu [data-action="pause.flyBySound"] .pm-label');
        if (!label) return all.map(() => -1);
        const own = label.textContent;
        const lineH = parseFloat(getComputedStyle(label).lineHeight);
        const out = all.map((text) => {
            label.textContent = text;
            return Math.round(label.getBoundingClientRect().height / lineH);
        });
        label.textContent = own;
        return out;
    }, [...texts]);
}

/** Where the focus is: its test id, role and label (review R5). */
const focusNow = (page: Page): Promise<{ testid: string | null; role: string | null; label: string | null; tag: string }> =>
    page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return { testid: a?.dataset?.testid ?? null, role: a?.getAttribute('role') ?? null, label: a?.getAttribute('aria-label') ?? null, tag: a?.tagName ?? '' };
    });

/** The flight is paused (the session's own flag, window.__gsfpv.session). */
const pausedNow = (page: Page): Promise<boolean | null> => page.evaluate(() => (window as unknown as { __gsfpv?: { session?: { paused?: boolean } } }).__gsfpv?.session?.paused ?? null);

/** The mode's link field (sonic/link-panel.ts, review R1 R3): shown, focused, its value and what of it is selected, its status line. */
const linkField = (page: Page): Promise<{ shown: boolean; focused: boolean; value: string; selected: string; status: string; picturePanel: boolean }> =>
    page.evaluate(() => {
        const f = document.querySelector<HTMLInputElement>('[data-testid="sonic-link-url"]');
        return {
            shown: !!document.querySelector('[data-testid="sonic-link"]'),
            focused: !!f && document.activeElement === f,
            value: f?.value ?? '',
            selected: f && f.selectionStart !== null && f.selectionEnd !== null ? f.value.slice(f.selectionStart, f.selectionEnd) : '',
            status: document.querySelector('[data-testid="sonic-link-status"]')?.textContent ?? '',
            picturePanel: !!document.querySelector('.panel.share')
        };
    });

// ------------------------------------------------------------------ A: an ordinary page

/** The Controls screen of a first flight ("How will you fly?"): the keyboard, chosen with the keyboard. Its keys are its own while it is up. */
async function chooseKeyboard(page: Page): Promise<void> {
    await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 20000 });
    await page.focus('.screen.radio [data-action="radio-keyboard"]');
    await page.keyboard.press('Enter');
    await until('the Controls screen to go', () => page.evaluate(() => !document.querySelector('.screen.radio')), (v) => v, 10000);
    await sleep(800);
}

/** What a key changed on the page (the fields of Snap that differ before and after it). */
async function pressAndDiff(page: Page, code: string): Promise<string[]> {
    const a = await snap(page);
    await page.keyboard.press(code);
    await sleep(700);
    const b = await snap(page);
    return (Object.keys(a) as (keyof Snap)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

async function ordinary(ctx: BrowserContext, out: Record<string, unknown>): Promise<void> {
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(`${SITE}/en/fly/?scene=39e63ce9&nowarn=1&render=off`);
    await until('the flight', () => ready(page), (v) => v === 'ready', 120000);
    await chooseKeyboard(page);
    const before = await page.evaluate(() => document.body.innerText.split('Fly by Sound').length - 1);
    check('A: an ordinary flight names Fly by Sound nowhere on the page before the pause menu is opened', before === 0, { occurrences: before });

    // a key no binding has, so the page's own first-key effects (the motor sound's AudioContext) are behind us
    await page.keyboard.press('KeyJ');
    await sleep(600);
    const keys: { key: string; changed: string[] }[] = [];
    for (const code of SOUND_KEYS) keys.push({ key: code, changed: await pressAndDiff(page, code) });
    // control: the same probe sees a key the page does route (H: the HUD's text off, its note says so), so the keys reach the router
    const h = await pressAndDiff(page, 'KeyH');
    await page.keyboard.press('KeyH');
    await sleep(400);
    out.plainKeys = { sound: keys, controlH: h };
    check('A: T U I Z G change nothing on an ordinary page (no panel, start screen, caption, recorder, hook, speech, sound context or HUD note); control: H, pressed the same way, does', keys.every((k) => k.changed.length === 0) && h.includes('note'), out.plainKeys);

    const menu = await pauseMenu(page);
    out.plainMenu = menu;
    const capsListed = menu.keys.flatMap((k) => k.caps);
    check('A: the pause menu\'s key list names none of the mode\'s keys (no sonic.* row, no T U I Z G cap); it lists the 21 bindings of an ordinary page (20 shortcuts, and Space among the flying keys)', menu.keys.length === pageBindings().length && !menu.keys.some((k) => k.action.startsWith('sonic.')) && !SOUND_CAPS.some((c) => capsListed.includes(c)), { rows: menu.keys.length, actions: menu.keys.map((k) => k.action) });
    check(`A: the pause menu has exactly one item for the mode, a link to /en/sound/ in a new tab, worded "${EN['sonic.menu.page']}", last of the menu's items, and a screen reader hears "${MAIN_EN['pause.newTab']}" (review R8)`, menu.items.filter((i) => i === 'pause.flyBySound').length === 1 && menu.items.at(-1) === 'pause.flyBySound' && !menu.items.includes('pause.sonic') && menu.sound?.tag === 'A' && menu.sound.href === '/en/sound/' && menu.sound.target === '_blank' && (menu.sound.rel ?? '').includes('noopener') && menu.sound.label === EN['sonic.menu.page'] && menu.sound.newTab.trim() === MAIN_EN['pause.newTab'], { sound: menu.sound, last: menu.items.at(-1) });
    check('A: with the menu open the page names Fly by Sound once: that item', menu.namesInMenu === 1 && menu.namesInBody === 1, { menu: menu.namesInMenu, body: menu.namesInBody });
    // review R8: one line in every language, on a computer and on a phone; control: the item as it was, measured the same way, wraps
    const wide = await labelLines(page, [...LANGS.map((l) => ITEM[l]), ITEM_BEFORE]);
    await page.setViewportSize({ width: 375, height: 812 });
    await sleep(500);
    const phone = await labelLines(page, [...LANGS.map((l) => ITEM[l]), ITEM_BEFORE]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await sleep(500);
    out.itemLines = { langs: LANGS, at1280x720: wide, at375x812: phone, before: ITEM_BEFORE };
    check('A: the item is one line in en, es, pl and ru at 1280x720 and at 375x812 (review R8); control: the item as it was takes two lines in the same menu', wide.slice(0, 4).every((n) => n === 1) && phone.slice(0, 4).every((n) => n === 1) && (wide[4] ?? 0) >= 2 && (phone[4] ?? 0) >= 2, out.itemLines);
    const region = await page.evaluate(() => document.querySelectorAll('[role="application"]').length);
    check('A: an ordinary page has no application region for screen readers (the mode\'s, review R5; its control is B)', region === 0, { regions: region });

    if (menu.sound) {
        const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), page.click('[data-action="pause.flyBySound"]')]);
        await popup.waitForLoadState('domcontentloaded');
        await popup.waitForSelector('h1', { timeout: 15000 });
        const landed = await popup.evaluate(() => ({ url: location.pathname, h1: document.querySelector('h1')?.textContent ?? '', start: [...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === '/en/fly/?sonic=start').length }));
        const stillPaused = await page.evaluate(() => !!document.querySelector('.pause-menu'));
        out.plainPopup = { ...landed, stillPaused };
        check('A: the item opens /en/sound/ (the page about the mode, its start button inside) in a new tab; the flight stays paused under its menu', landed.url === '/en/sound/' && landed.h1 === SITE_EN.sound.h1 && landed.start === 1 && stillPaused, out.plainPopup);
        await popup.close();
    } else check('A: the item opens /en/sound/ (the page about the mode, its start button inside) in a new tab; the flight stays paused under its menu', false, 'no such item');
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
    check('A: no page error, and no request to this site failed', w.errors.length === 0, { errors: w.errors, otherHosts: w.elsewhere });
    await page.close();

    // the same item in Polish: its words and its address in the page's language
    const pl = await ctx.newPage();
    await pl.goto(`${SITE}/pl/fly/?scene=39e63ce9&nowarn=1&render=off`);
    await until('the Polish flight', () => ready(pl), (v) => v === 'ready', 120000);
    // the same profile chose the keyboard on the first page: the Controls screen may not ask again
    await sleep(1500);
    if (await pl.$('.screen.radio [data-action="radio-keyboard"]')) await chooseKeyboard(pl);
    const plMenu = await pauseMenu(pl);
    out.plainPolish = plMenu.sound;
    check('A: in Polish the item says the Polish line and leads to /pl/sound/', plMenu.sound?.href === '/pl/sound/' && plMenu.sound.label === PL['sonic.menu.page'], plMenu.sound);
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
    const focused = await focusNow(page);
    out.flightFocus = focused;
    check('B: once the lesson flies the focus is on the mode\'s labelled role="application" region, where a screen reader passes every key on (review R5; control: A has none)', focused.testid === 'sonic-flight' && focused.role === 'application' && focused.label === EN['sonic.flight.label'], focused);

    const menu = await pauseMenu(page);
    out.modeMenu = { items: menu.items, keys: menu.keys.filter((k) => k.action.startsWith('sonic.') || k.action === 'share.open' || k.action === 'help.keys') };
    const modeKeys = menu.keys.filter((k) => SOUND_ACTIONS.includes(k.action));
    check('B (control of A): in the mode the pause menu lists T U I Z G with their caps, and has the mode\'s own item, not the ordinary one', modeKeys.map((k) => k.caps.join('')).join(' ') === SOUND_CAPS.join(' ') && menu.keys.length === pageBindings({ sonic: true }).length && menu.items.includes('pause.sonic') && !menu.items.includes('pause.flyBySound'), out.modeMenu);
    const rowL = menu.keys.find((k) => k.action === 'share.open')?.label;
    const rowK = menu.keys.find((k) => k.action === 'help.keys')?.label;
    check('B: the mode\'s key list names L and K as the mode\'s: "copy a link to this lesson", "hear the keys" (review R4)', rowL === KEYS_EN['keys.sonic.shareLink'] && rowK === KEYS_EN['keys.sonic.hearKeys'], { L: rowL, K: rowK });
    await page.keyboard.press('Escape');
    await until('the menu to close', () => page.evaluate(() => !document.querySelector('.pause-menu')), (v) => v, 5000);
    await sleep(500);
    const back = await focusNow(page);
    check('B: when the pause menu closes the focus is back on the flight\'s region (review R5)', back.testid === 'sonic-flight', back);

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
    const noField = await linkField(page);
    check('B (control of E): a copied L opens no field and no picture panel: the link is in the clipboard and the line says so', !noField.shown && !noField.picturePanel, noField);

    // K: the mode's own key help, said while the flight waits (review R4)
    const n2 = await eventCount(page);
    await page.keyboard.press('KeyK');
    const heldAt = await until('the flight to wait for the keys', () => pausedNow(page), (v) => v === true, 3000).catch(() => false);
    const help = await until('the key help', () => probe(page), (p) => spokenSince(p, n2).some((e) => e.key === 'help.digits'), 15000);
    const lines = spokenSince(help, n2).filter((e) => (e.key ?? '').startsWith('help.') || e.key === 'sonic.say.helpShare');
    out.keyHelp = lines.map((e) => [e.key, e.text]);
    const order = ['help.intro', 'help.record', 'help.send', 'help.status', 'help.repeat', 'help.glossary', 'sonic.say.helpShare', 'help.reset', 'help.next', 'help.digits'];
    const capsSaid = lines.slice(1, -1).map((e) => /\b([A-Z])\b/.exec((e.text ?? '').replace(/^\w+ /, ''))?.[1] ?? '');
    check('B: K says the mode\'s keys in order, each with its key (T U I Z G L R N), then the digits; no "How to fly" card', lines.map((e) => e.key).join(',') === order.join(',') && capsSaid.join('') === 'TUIZGLRN' && !(await page.$('[data-testid="how-to-fly"]')), { keys: lines.map((e) => e.key), caps: capsSaid });
    const t0 = Date.now();
    const goesOn = await until('the flight to go on when the keys are said', () => pausedNow(page), (v) => v === false, 60000).catch(() => true);
    out.keyHelpHold = { heldAt, wentOnAfterMs: Date.now() - t0 };
    check('B: the flight waits while the keys are said and goes on by itself when they end (review R4)', heldAt === true && goesOn === false, out.keyHelpHold);
    // a key cuts them: K, then J (bound to nothing)
    const n3 = await eventCount(page);
    await page.keyboard.press('KeyK');
    await until('the flight to wait again', () => pausedNow(page), (v) => v === true, 3000).catch(() => false);
    await sleep(400);
    await page.keyboard.press('KeyJ');
    const cut = await until('the cut', () => probe(page), (p) => spokenSince(p, n3).some((e) => e.key === 'sonic.say.helpCut'), 5000).catch(() => null);
    const afterCut = await pausedNow(page);
    out.keyHelpCut = { said: spokenSince(cut, n3).map((e) => e.key).slice(-3), pausedAfter: afterCut };
    check('B: any key cuts the keys: "Back to the flight." is said and the flight goes on at once (review R4)', !!cut && afterCut === false, out.keyHelpCut);
    // with the "How to fly" card up (opened from the pause menu) K closes it and says nothing (the card's own K; control: A's K opens it)
    await pauseMenu(page);
    await page.click('[data-action="pause.howtofly"]');
    await page.waitForSelector('[data-testid="how-to-fly"]', { timeout: 10000 });
    const n4 = await eventCount(page);
    await page.keyboard.press('KeyK');
    const closed = await until('the card to close', () => page.evaluate(() => !document.querySelector('[data-testid="how-to-fly"]')), (v) => v, 5000).catch(() => false);
    await sleep(600);
    const saidOverCard = spokenSince(await probe(page), n4).map((e) => e.key);
    out.keyOverCard = { closed, said: saidOverCard };
    check('B: with the "How to fly" card up K closes it and says no key (review R4)', closed === true && !saidOverCard.some((k) => (k ?? '').startsWith('help.')), out.keyOverCard);
    await until('the flight to go on after the card', () => pausedNow(page), (v) => v === false, 5000).catch(() => undefined);

    // the visible Share in the mode: the lesson's link, copied and shown in the field, not the picture panel (review R3). A sighted
    // helper pauses first (Esc: the game scheme's flight holds the mouse), then clicks the pause menu's Share, or the top bar's
    const visibleShare = async (selector: string): Promise<{ field: Awaited<ReturnType<typeof linkField>> | null; clipboard: string; gone: boolean; pausedAfter: boolean | null }> => {
        await page.evaluate(() => navigator.clipboard.writeText('-'));
        await page.keyboard.press('Escape');
        await page.waitForSelector('.pause-menu', { timeout: 10000 });
        await page.click(selector);
        const field = await until('the link field', () => linkField(page), (v) => v.shown, 5000).catch(() => null);
        const clipboard = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
        await page.keyboard.press('Escape');
        const gone = await until('the field to close', () => linkField(page), (v) => !v.shown, 5000).then(() => true).catch(() => false);
        const pausedAfter = await until('the flight to go on', () => pausedNow(page), (v) => v === false, 5000).catch(() => true);
        return { field, clipboard, gone, pausedAfter };
    };
    const shareOk = (r: Awaited<ReturnType<typeof visibleShare>>): boolean => !!r.field && r.field.value === want && r.field.focused && r.field.selected === want && !r.field.picturePanel && r.field.status === EN['sonic.link.copied'] && r.clipboard === want && r.gone && r.pausedAfter === false;
    const menuShare = await visibleShare('[data-action="pause.share"]');
    const topShare = await visibleShare('[data-action="share-top"]');
    out.visibleShare = { menu: menuShare, top: topShare, want };
    check('B: in the mode the pause menu\'s Share and the top bar\'s Share copy the lesson\'s link and show it selected in the field, with no picture panel; Escape closes it and the flight goes on (review R3)', shareOk(menuShare) && shareOk(topShare), out.visibleShare);

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
    check('B: no page error, and no request to this site failed', w.errors.length === 0, { errors: w.errors, otherHosts: w.elsewhere });
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
        // review R6: from the section's heading, Tab reaches Start before Keep; the note describes the primary Start
        const order = await page.evaluate(() => {
            const sec = document.getElementById('sonic-sec-start');
            const controls = sec ? [...sec.querySelectorAll<HTMLElement>('button, input, select, a[href]')].map((e) => e.dataset.testid ?? e.tagName) : [];
            const primary = sec?.querySelector<HTMLElement>('.sonic-actions .btn.primary');
            const describedBy = primary?.getAttribute('aria-describedby') ?? null;
            return { controls, primary: primary?.dataset.testid ?? null, describedBy, description: describedBy ? document.getElementById(describedBy)?.textContent ?? null : null };
        });
        out.receiverOrder = order;
        check('C: Start comes before "Keep these settings" and "Use my own settings", and the note describes the primary Start (review R6)', order.controls[0] === 'sonic-start-asked' && order.controls.indexOf('sonic-start-asked') < order.controls.indexOf('sonic-visit-keep') && order.controls.indexOf('sonic-visit-keep') < order.controls.indexOf('sonic-visit-own') && order.primary === 'sonic-start-asked' && (order.description ?? '').includes('Sound theme: Clear'), order);
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        const p = await until('the receiver\'s lesson', () => probe(page), (v) => v?.lesson === 'hover-height', 90000);
        await sleep(1000);
        const after = await savedSound(page);
        check('C: Enter starts that lesson; flying it saves nothing of the link\'s sound', p?.lesson === 'hover-height' && after?.theme === 'soft' && after.calm === false, { lesson: p?.lesson, saved: after });
        const address = await page.evaluate(() => location.search);
        check('C: the running lesson\'s address is its own link with what of the link still stands (a reload offers it with its note, review R2)', address === '?sonic=hover-height&st=clear&sc=1', { address });
        check('C: no page error, and no request to this site failed', w.errors.length === 0, { errors: w.errors, otherHosts: w.elsewhere });
        await ctx.close();
    }
    {
        const ctx = await newCtx();
        const page = await ctx.newPage();
        await page.goto(links.hover);
        await page.waitForSelector('[data-testid="sonic-visit-keep"]', { timeout: 60000 });
        // the control of the reload below: before Keep a reload still reads the link (the note is back, its sound in force)
        await page.reload();
        await page.waitForSelector('#sonic-start', { timeout: 60000 });
        await sleep(500);
        const before = await page.evaluate(() => ({ note: !!document.querySelector('[data-testid="sonic-visit"]'), calm: (document.getElementById('sonic-calm') as HTMLInputElement | null)?.checked ?? null }));
        await page.focus('[data-testid="sonic-visit-keep"]');
        await page.keyboard.press('Enter');
        const saved = await until('the kept settings', () => savedSound(page), (v) => v?.theme === 'clear', 5000).catch(() => null);
        const note = await page.evaluate(() => !!document.querySelector('[data-testid="sonic-visit"]'));
        const keptAddress = await page.evaluate(() => location.search);
        out.keep = { reloadBefore: before, saved, noteLeft: note, address: keptAddress };
        check('C: "Keep these settings" saves the link\'s sound (Clear, calm on), the note goes and so does the link\'s sound from the address (review R2)', saved?.theme === 'clear' && saved.calm === true && !note && keptAddress === '?sonic=hover-height', out.keep);
        // the reviewer's probe: Calm mode off (his own now), then a reload: no note, calm off, nothing of the link in the address
        await page.click('#sonic-calm');
        await until('calm off saved', () => savedSound(page), (v) => v?.calm === false, 5000).catch(() => null);
        await page.reload();
        await page.waitForSelector('#sonic-start', { timeout: 60000 });
        await sleep(500);
        const reloaded = await page.evaluate(() => ({ note: !!document.querySelector('[data-testid="sonic-visit"]'), calm: (document.getElementById('sonic-calm') as HTMLInputElement | null)?.checked ?? null, theme: (document.getElementById('sonic-theme') as HTMLSelectElement | null)?.value ?? null, address: location.search }));
        const savedAfter = await savedSound(page);
        out.keepReload = { reloaded, saved: savedAfter };
        check('C: the reviewer\'s probe: link, Keep, Calm mode off, reload: no note, calm off as he set it (theme Clear kept); control: a reload before Keep still had the note and calm on (review R2)', before.note && before.calm === true && !reloaded.note && reloaded.calm === false && reloaded.theme === 'clear' && reloaded.address === '?sonic=hover-height' && savedAfter?.calm === false, out.keepReload);
        await ctx.close();
    }
    {
        // "Use my own settings": the link's sound goes, nothing is saved, the address loses it, a reload brings nothing back (review R2)
        const ctx = await newCtx();
        const page = await ctx.newPage();
        await page.goto(links.hover);
        await page.waitForSelector('[data-testid="sonic-visit-own"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-visit-own"]');
        await page.keyboard.press('Enter');
        await until('the note to go', () => page.evaluate(() => !document.querySelector('[data-testid="sonic-visit"]')), (v) => v, 5000).catch(() => undefined);
        const own = await page.evaluate(() => ({ note: !!document.querySelector('[data-testid="sonic-visit"]'), calm: (document.getElementById('sonic-calm') as HTMLInputElement | null)?.checked ?? null, theme: (document.getElementById('sonic-theme') as HTMLSelectElement | null)?.value ?? null, address: location.search }));
        const savedOwn = await savedSound(page);
        await page.reload();
        await page.waitForSelector('#sonic-start', { timeout: 60000 });
        await sleep(500);
        const ownReloaded = await page.evaluate(() => !!document.querySelector('[data-testid="sonic-visit"]'));
        out.own = { own, saved: savedOwn, noteAfterReload: ownReloaded };
        check('C: "Use my own settings": the note goes, his own sound is in force (Soft, calm off), nothing saved, the address and a reload carry nothing of the link (review R2)', !own.note && own.calm === false && own.theme === 'soft' && own.address === '?sonic=hover-height' && savedOwn?.theme === 'soft' && savedOwn.calm === false && !ownReloaded, out.own);
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

// ------------------------------------------------------------------ E: a refused clipboard (review R1)

/** The browser refuses both ways of copying: the Clipboard API rejects, execCommand('copy') answers false. */
const REFUSE = `(() => {
  try { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new DOMException('refused', 'NotAllowedError')) }); } catch (e) {}
  document.execCommand = () => false;
})();`;
const TITLE_EN = (JSON.parse(readFileSync(join(REPO, 'packages', 'sonic-fpv', 'locales', 'en.json'), 'utf8')) as Record<string, string>)['lesson.hover-height.title'] ?? '<no title>';

async function refused(newCtx: (sonic: Partial<SonicPrefs>) => Promise<BrowserContext>, out: Record<string, unknown>): Promise<void> {
    const setups: [string, Partial<SonicPrefs>][] = [['the app speaks, captions on', {}], ['the app speaks, captions off', { captions: false }]];
    const seen: Record<string, unknown> = {};
    for (const [name, sonic] of setups) {
        const ctx = await newCtx(sonic);
        await ctx.addInitScript({ content: REFUSE });
        const page = await ctx.newPage();
        const w = watch(page);
        await page.goto(`${SITE}/en/fly/?sonic=hover-height`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        await until('the lesson', () => probe(page), (p) => p?.lesson === 'hover-height', 90000);
        await sleep(1500);
        const n = await eventCount(page);
        await page.keyboard.press('KeyL');
        const field = await until('the link field', () => linkField(page), (v) => v.shown, 10000).catch(() => null);
        const p = await until('the line', () => probe(page), (v) => spokenSince(v, n).some((e) => e.key === 'sonic.say.linkSelected'), 10000).catch(() => null);
        const line = spokenSince(p, n).find((e) => e.key === 'sonic.say.linkSelected');
        const hook = await page.evaluate(() => (window as unknown as { __gsfpv: { sonicLink?: unknown } }).__gsfpv.sonicLink ?? null);
        const captions = await page.evaluate(() => document.querySelector('[data-testid="sonic-captions"]')?.textContent ?? '');
        const paused = await pausedNow(page);
        await page.keyboard.press('Escape');
        const closed = await until('the field to close', () => linkField(page), (v) => !v.shown, 5000).then(() => true).catch(() => false);
        const goesOn = await until('the flight to go on', () => pausedNow(page), (v) => v === false, 5000).catch(() => true);
        const want = `${SITE}/fly/?sonic=hover-height`;
        seen[name] = { field, line: line?.text ?? null, hook, captionsHaveLink: captions.includes('sonic='), pausedUnderField: paused, closed, pausedAfter: goesOn, errors: w.errors };
        check(`E (${name}): with the clipboard refused L selects the whole link in a focused field, says so with the lesson's name and the keys, puts no link in the captions; Esc closes it and the flight goes on (review R1; control: B's copied L opens no field)`,
            !!field && field.value === want && field.focused && field.selected === want && !field.picturePanel && !!line?.text && line.text.includes(TITLE_EN) && line.text.includes('Control and C') && !/caption/i.test(line.text) && (hook as { copied?: boolean } | null)?.copied === false && !captions.includes('sonic=') && paused === true && closed && goesOn === false && w.errors.length === 0,
            seen[name]);
        await ctx.close();
    }
    out.refused = seen;
}

// ------------------------------------------------------------------ D: the site's page about the mode

async function soundPage(ctx: BrowserContext, out: Record<string, unknown>): Promise<void> {
    const page = await ctx.newPage();
    await page.goto(`${SITE}/en/sound/`);
    await page.waitForSelector('h1', { timeout: 30000 });
    const want = sonicLinkPath({ lesson: 'start', sound: {} }, '/en/fly/');
    const seen = await page.evaluate((href) => ({
        start: [...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === href).map((a) => a.textContent ?? ''),
        kbd: [...document.querySelectorAll('#sound-keys ~ ul kbd, section[aria-labelledby="sound-keys"] kbd')].map((k) => k.textContent ?? ''),
        keysText: document.querySelector('section[aria-labelledby="sound-keys"]')?.textContent ?? ''
    }), want);
    out.soundPage = { ...seen, keysText: undefined };
    check('D: /en/sound/: its start link is the mode\'s link (/en/fly/?sonic=start, the same writer as L); its key list has nine keys, L and K among them', seen.start.length === 1 && seen.start[0] === SITE_EN.sound.start.button && seen.kbd.join(' ') === 'T U I Z G R N L K', seen);
    check('D: under the key list, the line for a screen reader in browse mode (review R5)', seen.keysText.includes(SITE_EN.sound.keys.reader), { reader: SITE_EN.sound.keys.reader });
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
        if (PARTS !== 'A') {
            // the sender: a screen reader speaks (the engine is silent and the captions are the live region), and his own sound language
            const send = await make({ selfVoice: false, speechRate: 2, theme: 'clear', calm: true, motorSound: true, layerGainDb: { safety: -6 } }, true);
            const links = await sender(send, out);
            await send.close();
            // the receivers: the default sound, a screen reader speaks
            await receivers(() => make({ selfVoice: false, speechRate: 2 }), links, out);
            // a refused clipboard, the app speaking (review R1)
            await refused((sonic) => make(sonic), out);
            const site = await make({});
            await soundPage(site, out);
            await site.close();
        }
    } catch (e) {
        check('the run reached its end', false, String(e).slice(0, 400));
    } finally {
        await browser.close().catch(() => undefined);
        unlock();
    }
    const passed = checks.filter((c) => c.pass).length;
    const file = writeEvidence('sonic-optin-page', { site: SITE, parts: PARTS ?? 'ABCD', checks, passed, total: checks.length, result: out });
    console.log(`${passed} of ${checks.length} checks passed; ${file}`);
    process.exitCode = passed === checks.length && checks.length > 0 ? 0 : 1;
}

main().catch((e) => {
    unlock();
    console.error(e);
    process.exit(2);
});

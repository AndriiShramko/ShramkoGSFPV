// v0.12 v12-optin (docs/wip/v12-optin.md): Fly by Sound only for those who choose it. The owner's message 40: the sound mode is not
// pressed on pilots who did not choose it; a curious sighted pilot can still find it; blind pilots share links that carry the mode.
// Here, in Node: the pause menu's one way in on an ordinary page (the feature shim) and its words in the four languages; the link that
// carries the mode (@gsfpv/scenes sonic-link.ts), what L and K do in the mode (sonic/mode-keys.ts) and what opening a link starts. The
// keys of the mode are tested where they are defined (packages/prefs/test/keymap.test.ts, tools/bench/test/app-keys.test.ts), the
// visit layer of a link's sound settings with the other SonicSetup tests (sonic-audio.test.ts); the page by
// tools/bench/src/sonic-optin-page.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_THEME_IDS, SHIPPED_LESSON_IDS, defaultPrefs, getLesson } from '../../../packages/sonic-fpv/src';
import { SONIC_LINK_DEFAULTS, SONIC_LINK_PARAMS, lessonQuery, linkSound, parseSonicLink, sonicLinkPath, sonicLinkQuery, visitQuery } from '../../../packages/scenes/src/sonic-link';
import type { SonicLink } from '../../../packages/scenes/src/sonic-link';
import { KEYMAP } from '../../../packages/prefs/src/keymap';
import { SOUND_PAGE_ITEM, sonicFlight, soundPage } from '../../../apps/fly/src/app/builtin/sonic-flight';
import type { FlightContext, MenuItem } from '../../../apps/fly/src/app/context';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { setSonicEntry, setSonicInstaller } from '../../../apps/fly/src/sonic/entry-state';
import type { SonicEntry } from '../../../apps/fly/src/sonic/entry';
import { KEY_HELP, KeyHelp, keyHelpLines, lessonLink, shareLine } from '../../../apps/fly/src/sonic/mode-keys';
import { engineDicts } from '../../../apps/fly/src/sonic/host-lines';
import { parseSonicParam } from '../../../apps/fly/src/sonic/start-model';

/** A query as the page reads it (app/env.ts q) from a link's address. */
const queryOf = (href: string): URLSearchParams => new URL(href, 'https://gsfpv.flyreelstudio.eu').searchParams;

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const dict = (ns: string, l: string): Record<string, string> => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', ns, `${l}.json`), 'utf8')) as Record<string, string>;

/**
 * What a link must not carry (review R9 b): a parameter that is not one of the link's own, or the name of one of the pilot's personal
 * settings anywhere in it (his voice, speaking speed, captions, motor sound, volumes, pitch, path) or an address.
 */
function privacyProblems(href: string): string[] {
    const out: string[] = [];
    for (const n of new Set(queryOf(href).keys())) if (!(Object.values(SONIC_LINK_PARAMS) as string[]).includes(n)) out.push(`parameter ${n}`);
    const named = /speech|voice|caption|motor|gain|pitch|fast|@/i.exec(decodeURIComponent(href));
    if (named) out.push(`names ${named[0]}`);
    return out;
}

/** A flight context with only a menu that records what is added (the shim needs nothing else). */
function menuPage(): { ctx: FlightContext; items: MenuItem[] } {
    const items: MenuItem[] = [];
    const ctx = {
        menu: {
            add: (it: MenuItem) => {
                items.push(it);
                return () => void items.splice(items.indexOf(it), 1);
            }
        }
    } as unknown as FlightContext;
    return { ctx, items };
}

describe('the pause menu\'s one way into the mode on an ordinary page (step 3)', () => {
    afterEach(() => {
        setSonicEntry(null);
        setSonicInstaller(null);
        vi.unstubAllGlobals();
    });

    it('an ordinary page gets exactly one item: no key, in the tools section where the mode\'s own item sits, a link to /{lang}/sound/; its teardown takes it out', () => {
        const { ctx, items } = menuPage();
        const off = sonicFlight.install(ctx) as () => void;
        expect(items).toHaveLength(1);
        const it = items[0]!;
        // review R8: last of the tools section (after "Report a bug or an idea", 110), a quiet end of the list
        expect(it).toMatchObject({ id: 'pause.flyBySound', action: null, labelKey: 'sonic.menu.page', section: 'tools', order: 120 });
        for (const l of LANGS) {
            vi.stubGlobal('document', { documentElement: { lang: l } });
            expect(it.href?.()).toBe(`/${l}/sound/`);
        }
        vi.stubGlobal('document', { documentElement: { lang: '' } });
        expect(soundPage()).toBe('/en/sound/');
        off();
        expect(items).toEqual([]);
    });

    it('its id is no other item\'s: every menu item id written in the simulator\'s sources is someone else\'s (the menu throws on a second one, and the page would not start); control: the motor sound owns pause.sound', () => {
        const ids: string[] = [];
        const walk = (dir: string): void => {
            for (const n of readdirSync(dir)) {
                const p = join(dir, n);
                if (statSync(p).isDirectory()) walk(p);
                else if (/\.ts$/.test(n) && !p.endsWith('sonic-flight.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/\bid:\s*'(pause\.[\w.]+)'/g)) ids.push(m[1]!);
            }
        };
        walk(join(REPO, 'apps', 'fly', 'src'));
        expect(ids.length).toBeGreaterThan(15);
        expect(ids).not.toContain(SOUND_PAGE_ITEM.id);
        expect(ids).toContain('pause.sound'); // the motor sound's toggle (app/builtin/sound.ts): the id this item first had, which broke the page
        expect(ids).toContain('pause.sonic'); // the mode's own item
    });

    it('control: a page entered through ?sonic= gets no such item (the mode adds its own, "lessons and settings"), nor does an entry whose mode did not load', () => {
        const { ctx, items } = menuPage();
        setSonicEntry({ lessonId: 'hover-height' } as unknown as SonicEntry);
        let installed = 0;
        setSonicInstaller(() => {
            installed++;
            return () => undefined;
        });
        sonicFlight.install(ctx);
        expect(installed).toBe(1);
        expect(items).toEqual([]);
        setSonicInstaller(null);
        expect(sonicFlight.install(ctx)).toBeUndefined();
        expect(items).toEqual([]);
    });

    it('its words (review R8): "Fly by Sound:" and for whom, blind AND low-vision pilots, with the words of the site page about the mode, in en, es, pl and ru; nothing else is in the eager namespace but the lines every page may need', () => {
        const en = dict('sonicentry', 'en')[SOUND_PAGE_ITEM.labelKey];
        expect(en).toBe('Fly by Sound: blind and low-vision pilots');
        // the stems of "blind" and "low vision" in each language, built from code points where they have letters B18 keeps in the locales
        const cp = (...c: number[]): string => String.fromCodePoint(...c);
        const words: Record<string, [RegExp, RegExp]> = {
            en: [/blind/, /low.vision/],
            es: [/cieg/, /baja visi/],
            pl: [/niewidom/, new RegExp(`s${cp(0x142)}abowidz`)],
            ru: [new RegExp(cp(0x441, 0x43b, 0x435, 0x43f)), new RegExp(cp(0x441, 0x43b, 0x430, 0x431, 0x43e, 0x432, 0x438, 0x434, 0x44f, 0x449))]
        };
        const site = (l: string): string => (JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'site', `${l}.json`), 'utf8')) as { sound: { description: string } }).sound.description;
        for (const l of LANGS) {
            const text = dict('sonicentry', l)[SOUND_PAGE_ITEM.labelKey]!;
            expect(text, l).toMatch(/^Fly by Sound: /);
            for (const w of words[l]!) {
                expect(text, `${l}: the item says ${w}`).toMatch(w);
                expect(site(l), `${l}: the site says ${w} too`).toMatch(w);
            }
            // one short line (its measured width in the menu is the page proof's): no "(beta)" and at most 42 characters
            expect(text.length, l).toBeLessThanOrEqual(42);
            expect(text, l).not.toMatch(/\(/);
            if (l !== 'en') expect(text, l).not.toBe(en);
        }
        // control: the item as it was before the review names blind pilots only
        expect('Fly by Sound: audio-only training for blind pilots (beta)').not.toMatch(words.en[1]);
    });
});

describe('the link that carries the mode: writer and reader (step 4, @gsfpv/scenes sonic-link.ts)', () => {
    const cases: SonicLink[] = [
        { lesson: 'start', sound: {} },
        { lesson: 'hover-height', sound: {} },
        { lesson: 'rings-first', sound: { theme: 'clear', calm: true, heightPolarity: 'up-lower', listenerFrame: 'body' } },
        { lesson: 'free-garden', scene: '7a475d38', size: 5, sound: { theme: 'race' } },
        { lesson: 'walls-hall', sound: { calm: false, heightPolarity: 'up-higher', listenerFrame: 'heading' } },
        { lesson: 'free-garden', scene: '7a475d38', size: 2.375, sound: {} }
    ];

    it('round trip: whatever the writer writes, the reader reads back, in the fixed order, under /fly/ or a page\'s own /{lang}/fly/', () => {
        for (const c of cases) {
            for (const base of ['/fly/', '/pl/fly/']) {
                const href = sonicLinkPath(c, base);
                expect(href.startsWith(`${base}?sonic=${c.lesson}`), href).toBe(true);
                expect(parseSonicLink(queryOf(href)), href).toEqual(c);
            }
        }
        expect(sonicLinkPath(cases[3]!)).toBe('/fly/?sonic=free-garden&scene=7a475d38&sz=5&st=race');
        expect(sonicLinkQuery(cases[2]!)).toBe('sonic=rings-first&st=clear&sc=1&sh=up-lower&sf=body');
        // the site's start link is one of them (apps/site sound page: the same writer, the page's own language)
        expect(sonicLinkPath({ lesson: 'start', sound: {} }, '/es/fly/')).toBe('/es/fly/?sonic=start');
    });

    it('strict reading: each parameter on its own, an unusable one ignored, the rest stands; no ?sonic= is no sonic link', () => {
        expect(parseSonicLink(queryOf('/fly/?scene=7a475d38&sz=5'))).toBeNull();
        expect(parseSonicLink(queryOf('/fly/?sonic='))).toEqual({ lesson: 'start', sound: {} });
        expect(parseSonicLink(queryOf('/fly/?sonic=menu'))).toEqual({ lesson: 'menu', sound: {} }); // an id-shaped word: the page decides (start screen)
        expect(parseSonicLink(queryOf('/fly/?sonic=%3Cscript%3E&st=Clear!&sc=yes&sh=up&sf=tilt&scene=xyz&sz=1000'))).toEqual({ lesson: 'start', sound: {} });
        expect(parseSonicLink(queryOf(`/fly/?sonic=${'a'.repeat(65)}`))).toEqual({ lesson: 'start', sound: {} });
        expect(parseSonicLink(queryOf('/fly/?sonic=rings-first&st=clear&sc=2&sh=up-lower&sf=tilt&sz=5'))).toEqual({ lesson: 'rings-first', size: 5, sound: { theme: 'clear', heightPolarity: 'up-lower' } });
        // the writer never writes a size without its scene, nor a scene that is not a scan id
        expect(sonicLinkQuery({ lesson: 'x', scene: 'lesson-hover-height', size: 1, sound: {} })).toBe('sonic=x');
    });

    it('review R2: the address of a ?sonic= page carries only the sound that stands; every other parameter stays where it is; the reader reads it back', () => {
        expect(visitQuery('?sonic=hover-height&st=clear&sc=1&nowarn=1', {})).toBe('sonic=hover-height&nowarn=1');
        expect(visitQuery('sonic=x&stochastic&st=race', { theme: 'clear', listenerFrame: 'body' })).toBe('sonic=x&stochastic&st=clear&sf=body');
        expect(visitQuery('sonic=x&sc=1', { calm: false })).toBe('sonic=x&sc=0');
        const all = { theme: 'clear', calm: true, heightPolarity: 'up-lower', listenerFrame: 'body' } as const;
        expect(parseSonicLink(new URLSearchParams(visitQuery('sonic=x', all)))?.sound).toEqual(all);
        // a lesson's address: its own scan or none, never the one of the lesson before
        expect(lessonQuery('sonic=free-garden&scene=7a475d38&sz=5', { lesson: 'corridor', sound: {} })).toBe('sonic=corridor');
        expect(lessonQuery('sonic=corridor', { lesson: 'free-garden', scene: '7a475d38', size: 5, sound: {} })).toBe('sonic=free-garden&scene=7a475d38&sz=5');
    });

    it('the writer carries only the sound settings that are not the defaults; its defaults are the sound package\'s (a drift guard)', () => {
        const d = defaultPrefs();
        expect(SONIC_LINK_DEFAULTS).toEqual({ theme: d.theme, calm: d.calm, heightPolarity: d.heightPolarity, listenerFrame: d.listenerFrame });
        expect(linkSound(d)).toEqual({});
        expect(linkSound({ ...d, theme: 'clear', listenerFrame: 'body' })).toEqual({ theme: 'clear', listenerFrame: 'body' });
        for (const id of BUILTIN_THEME_IDS) expect(parseSonicLink(queryOf(sonicLinkPath({ lesson: 'start', sound: { theme: id } })))?.sound.theme).toBe(id);
    });

    it('no personal data: whatever the pilot set (voice, speed, screen reader, captions, motors, each sound\'s volume and pitch), only the link\'s own parameters are written', () => {
        const prefs = { ...defaultPrefs(), theme: 'clear', calm: true, selfVoice: false, speechRate: 2, captions: false, motorSound: true, path: 'fast' as const, layerGainDb: { safety: -6 }, layerPitchSteps: { height: 2 } };
        const href = sonicLinkPath(lessonLink(getLesson('rings-first'), prefs));
        expect([...queryOf(href).keys()]).toEqual(['sonic', 'st', 'sc']);
        expect(privacyProblems(href)).toEqual([]);
        // review R9 (b), the controls: writers that leak are caught by the same check, one that serialises the whole settings
        // document into the link, and one that writes each setting as a parameter of its own
        const whole = `${href}&p=${encodeURIComponent(JSON.stringify(prefs))}`;
        expect(privacyProblems(whole)).toEqual(expect.arrayContaining(['parameter p']));
        expect(privacyProblems(whole).some((x) => x.startsWith('names '))).toBe(true);
        const each = `/fly/?${new URLSearchParams(Object.entries(prefs).map(([k, v]) => [k, JSON.stringify(v)])).toString()}`;
        expect(privacyProblems(each)).toEqual(expect.arrayContaining(['parameter selfVoice', 'parameter speechRate', 'parameter layerGainDb']));
    });

    it('L in the mode: the running lesson, a scan lesson with its scan and Scene size, no lesson the start screen; what it says after', () => {
        const d = defaultPrefs();
        expect(lessonLink(getLesson('hover-height'), d)).toEqual({ lesson: 'hover-height', sound: {} });
        expect(lessonLink(getLesson('free-garden'), d)).toEqual({ lesson: 'free-garden', scene: '7a475d38', size: 5, sound: {} });
        expect(lessonLink(null, { ...d, calm: true })).toEqual({ lesson: 'start', sound: { calm: true } });
        expect(shareLine(true, 'Hold your height', 'Control and C')).toEqual({ key: 'sonic.say.linkCopied' });
        expect(shareLine(true, null, 'Control and C')).toEqual({ key: 'sonic.say.linkCopiedStart' });
        // review R1: refused, the line names the lesson and the keys that copy the selected link
        expect(shareLine(false, 'Hold your height', 'Control and C')).toEqual({ key: 'sonic.say.linkSelected', params: { lesson: 'Hold your height', copy: 'Control and C' } });
        expect(shareLine(false, null, 'Command and C')).toEqual({ key: 'sonic.say.linkSelectedStart', params: { copy: 'Command and C' } });
    });

    it('review R1: the lines and the field\'s words exist in en, es, pl and ru with their placeholders, and none sends the pilot to the captions', () => {
        // "caption" in each language, built from code points where it has letters B18 keeps in the locales
        const caption: Record<string, RegExp> = { en: /caption/i, es: /subt[ií]tulo/i, pl: /napis/i, ru: new RegExp(String.fromCodePoint(0x441, 0x443, 0x431, 0x442, 0x438, 0x442, 0x440), 'i') };
        const lines = engineDicts();
        for (const l of LANGS) {
            const d = dict('sonic', l);
            for (const [key, params] of [['sonic.say.linkSelected', ['{lesson}', '{copy}']], ['sonic.say.linkSelectedStart', ['{copy}']], ['sonic.link.select', ['{copy}']]] as const) {
                const text = d[key] ?? '';
                for (const p of params) expect(text, `${l} ${key}`).toContain(p);
                expect(text, `${l} ${key}`).not.toMatch(caption[l]!);
            }
            for (const key of ['sonic.say.linkCopied', 'sonic.say.linkCopiedStart', 'sonic.say.linkSelected', 'sonic.say.linkSelectedStart']) expect(lines[l][key], `${l} ${key} (the engine says it)`).toBeTruthy();
            for (const key of ['sonic.copyKeys', 'sonic.copyKeysMac', 'sonic.link.title', 'sonic.link.titleStart', 'sonic.link.field', 'sonic.link.copied']) expect(d[key], `${l} ${key}`).toBeTruthy();
            expect(d['sonic.say.linkFailed'], `${l}: the line that pointed to the captions is gone`).toBeUndefined();
        }
        // control: the word is found where it is (the captions' own label)
        for (const l of LANGS) expect(dict('sonic', l)['sonic.captions.label'], l).toMatch(caption[l]!);
    });

    it('opening a link L made: the start screen offers that lesson (every shipped lesson), its sound settings come with it', () => {
        for (const id of SHIPPED_LESSON_IDS) {
            const q = queryOf(sonicLinkPath(lessonLink(getLesson(id), { ...defaultPrefs(), theme: 'clear' })));
            expect(parseSonicParam(q.get('sonic')), id).toEqual({ kind: 'lesson', id });
            expect(parseSonicLink(q)?.sound, id).toEqual({ theme: 'clear' });
        }
        // control: a link to a lesson this release does not have opens the start screen with its note
        expect(parseSonicParam(queryOf('/fly/?sonic=rings-ninth').get('sonic'))).toEqual({ kind: 'unknown', raw: 'rings-ninth' });
    });
});

describe('review R3: in the mode every Share but a recording\'s video shares the lesson\'s link (app/builtin/share.ts openFlightShare)', () => {
    afterEach(() => vi.unstubAllGlobals());
    /** share.ts reads the page's address when it loads (app/env.ts): imported with a stand-in address */
    const load = async (): Promise<typeof import('../../../apps/fly/src/app/builtin/share')> => {
        vi.stubGlobal('location', { search: '', href: 'https://gsfpv.flyreelstudio.eu/en/fly/', origin: 'https://gsfpv.flyreelstudio.eu', pathname: '/en/fly/' });
        vi.stubGlobal('document', { cookie: '', documentElement: { lang: '' }, querySelector: () => null, addEventListener() {}, removeEventListener() {} });
        vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
        vi.stubGlobal('addEventListener', () => undefined);
        vi.stubGlobal('window', globalThis);
        return import('../../../apps/fly/src/app/builtin/share');
    };

    it('L and L over a crash are the key; the top bar, the pause menu, the stats card and the "Nice flight" row are a button; an open pause menu closes first', async () => {
        const { openFlightShare } = await load();
        vi.stubGlobal('document', { querySelector: () => null });
        const calls: string[] = [];
        let closed = 0;
        const menu = { isOpen: false, close: () => { closed++; menu.isOpen = false; } };
        const ctx = { menu, sonicShare: (via: string) => calls.push(via) } as unknown as FlightContext;
        for (const entry of ['key', 'crash', 'top', 'pause', 'card'] as const) {
            menu.isOpen = entry === 'pause';
            openFlightShare(ctx, entry);
        }
        expect(calls).toEqual(['key', 'key', 'button', 'button', 'button']);
        expect(closed).toBe(1);
        // control: a recording's video goes to the share panel as before (which needs a page here, so it throws): not the lesson's link
        expect(() => openFlightShare(ctx, 'video')).toThrow();
        expect(calls).toHaveLength(5);
    });

    it('control: over another dialog nothing is shared, as before (the pause menu gives way, a panel does not)', async () => {
        const { openFlightShare } = await load();
        vi.stubGlobal('document', { querySelector: () => ({}) });
        const calls: string[] = [];
        const ctx = { menu: { isOpen: false, close: () => undefined }, sonicShare: (via: string) => calls.push(via) } as unknown as FlightContext;
        openFlightShare(ctx, 'key');
        expect(calls).toEqual([]);
    });
});

describe('K in the mode: the mode\'s own key help, said (step 2, the mode\'s own help)', () => {
    // v0.13 (lane v13-host B3): the keys that move a lesson first (N, B, Z), then I; the names are the page's (sonic/key-names.ts)
    const capsOf = (sonic: boolean) => {
        const r = new KeyRouter({ map: KEYMAP, sonic: () => sonic });
        return (a: string, aria?: string) => r.caps(a).filter((c) => aria === undefined || c.aria === aria).map((c) => c.cap).join(' ');
    };

    it('on a ?sonic= page it says the intro, N B Z I G R T U L with their keys, then the digits; every line is in the engine\'s dictionaries in en, es, pl and ru', () => {
        const lines = keyHelpLines(capsOf(true));
        expect(lines.map((l) => l.key)).toEqual(['help.intro', ...KEY_HELP.map(([k]) => k), 'help.digits']);
        expect(lines.slice(1, -1).map((l) => l.params?.key)).toEqual(['N', 'B', 'Z', 'I', 'G', 'R', 'T', 'U', 'L']);
        // B goes one step back and Z gives the task again: the page's own lines (the package's help.repeat says "the last line")
        expect(lines.find((l) => l.params?.key === 'Z')?.key).toBe('sonic.say.helpRepeat');
        expect(lines.find((l) => l.params?.key === 'B')?.key).toBe('sonic.say.helpPrevious');
        const dicts = engineDicts();
        for (const l of LANGS) {
            for (const line of lines) {
                const text = dicts[l][line.key];
                expect(text, `${l} ${line.key}`).toBeTruthy();
                if (line.params) expect(text, `${l} ${line.key}`).toContain('{key}');
            }
        }
    });

    it('control: with the keys of an ordinary page the five keys of the mode have no cap, so no line names them', () => {
        const lines = keyHelpLines(capsOf(false));
        expect(lines.slice(1, -1).map((l) => l.params?.key)).toEqual(['N', 'B', 'R', 'L']);
    });
});

describe('review R4: K\'s spoken help holds the flight while it is said, and any key cuts it (sonic/mode-keys.ts KeyHelp)', () => {
    /** A page for KeyHelp: the lines it says (each resolved by the test, as speech ends), the flight's holds, the key listener. */
    function helpPage() {
        const said: { key: string; interrupt: boolean }[] = [];
        const ends: (() => void)[] = [];
        const holds: boolean[] = [];
        let listener: (() => void) | null = null;
        const help = new KeyHelp({
            lines: () => [{ key: 'help.intro' }, { key: 'help.record', params: { key: 'T' } }, { key: 'help.digits' }],
            say: (line, interrupt) => {
                said.push({ key: line.key, interrupt });
                return new Promise<void>((r) => ends.push(r));
            },
            hold: (on) => holds.push(on),
            listen: (cut) => {
                listener = cut;
                return () => {
                    listener = null;
                };
            },
            cutLine: { key: 'sonic.say.helpCut' }
        });
        const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
        return { help, said, ends, holds, press: () => listener?.(), listening: () => listener !== null, tick };
    }

    it('K: the flight waits, the lines are said (the first interrupts), a key listener waits; when the last line ends the flight goes on by itself', async () => {
        const p = helpPage();
        p.help.toggle();
        expect(p.holds).toEqual([true]);
        expect(p.said).toEqual([{ key: 'help.intro', interrupt: true }, { key: 'help.record', interrupt: false }, { key: 'help.digits', interrupt: false }]);
        expect(p.listening()).toBe(true);
        expect(p.help.speaking).toBe(true);
        for (const end of p.ends) end();
        await p.tick();
        expect(p.holds).toEqual([true, false]);
        expect(p.listening()).toBe(false);
        expect(p.help.speaking).toBe(false);
    });

    it('any key cuts it: the cut line interrupts what is left, the flight goes on at once; the lines ending later change nothing', async () => {
        const p = helpPage();
        p.help.toggle();
        p.press();
        expect(p.holds).toEqual([true, false]);
        expect(p.said.at(-1)).toEqual({ key: 'sonic.say.helpCut', interrupt: true });
        expect(p.listening()).toBe(false);
        for (const end of p.ends) end();
        await p.tick();
        expect(p.holds).toEqual([true, false]);
    });

    it('K again cuts it too; a new K after a cut is not ended by the old lines ending; going away lets the flight go and says nothing', async () => {
        const p = helpPage();
        p.help.toggle();
        p.help.toggle();
        expect(p.holds).toEqual([true, false]);
        const old = [...p.ends];
        p.help.toggle();
        expect(p.holds).toEqual([true, false, true]);
        for (const end of old) end();
        await p.tick();
        expect(p.help.speaking).toBe(true);
        expect(p.holds).toEqual([true, false, true]);
        const n = p.said.length;
        p.help.dispose();
        expect(p.holds).toEqual([true, false, true, false]);
        expect(p.listening()).toBe(false);
        expect(p.said).toHaveLength(n);
    });

    it('its words: the cut line is a line of the engine in en, es, pl and ru; the key list\'s own words for L and K exist in the four languages', () => {
        const lines = engineDicts();
        for (const l of LANGS) {
            expect(lines[l]['sonic.say.helpCut'], l).toBeTruthy();
            const keys = dict('sonickeys', l);
            for (const k of ['keys.sonic.shareLink', 'keys.sonic.hearKeys']) expect(keys[k], `${l} ${k}`).toMatch(/^Fly by Sound: /);
        }
    });
});

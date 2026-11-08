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
import { SONIC_LINK_DEFAULTS, SONIC_LINK_PARAMS, linkSound, parseSonicLink, sonicLinkPath, sonicLinkQuery } from '../../../packages/scenes/src/sonic-link';
import type { SonicLink } from '../../../packages/scenes/src/sonic-link';
import { KEYMAP } from '../../../packages/prefs/src/keymap';
import { SOUND_PAGE_ITEM, sonicFlight, soundPage } from '../../../apps/fly/src/app/builtin/sonic-flight';
import type { FlightContext, MenuItem } from '../../../apps/fly/src/app/context';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { setSonicEntry, setSonicInstaller } from '../../../apps/fly/src/sonic/entry-state';
import type { SonicEntry } from '../../../apps/fly/src/sonic/entry';
import { KEY_HELP, keyHelpLines, lessonLink, linkLine } from '../../../apps/fly/src/sonic/mode-keys';
import { engineDicts } from '../../../apps/fly/src/sonic/host-lines';
import { parseSonicParam } from '../../../apps/fly/src/sonic/start-model';

/** A query as the page reads it (app/env.ts q) from a link's address. */
const queryOf = (href: string): URLSearchParams => new URL(href, 'https://gsfpv.flyreelstudio.eu').searchParams;

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const dict = (ns: string, l: string): Record<string, string> => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', ns, `${l}.json`), 'utf8')) as Record<string, string>;

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
        expect(it).toMatchObject({ id: 'pause.flyBySound', action: null, labelKey: 'sonic.menu.page', section: 'tools', order: 95 });
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

    it('its words: "Fly by Sound:", what it is and for whom, "(beta)", in en, es, pl and ru, each language its own; nothing else is in the eager namespace but the lines every page may need', () => {
        const en = dict('sonicentry', 'en')[SOUND_PAGE_ITEM.labelKey];
        expect(en).toBe('Fly by Sound: audio-only training for blind pilots (beta)');
        // the words for "blind" and "beta" in each language, built from code points (no Cyrillic or Polish letters in code)
        const blind: Record<string, RegExp> = { en: /blind/, es: /ciegos/, pl: /niewidomych/, ru: new RegExp(String.fromCodePoint(0x43d, 0x435, 0x437, 0x440, 0x44f, 0x447, 0x438, 0x445)) };
        const beta: Record<string, RegExp> = { en: /\(beta\)$/, es: /\(beta\)$/, pl: /\(beta\)$/, ru: new RegExp(`\\(${String.fromCodePoint(0x431, 0x435, 0x442, 0x430)}\\)$`) };
        for (const l of LANGS) {
            const text = dict('sonicentry', l)[SOUND_PAGE_ITEM.labelKey]!;
            expect(text, l).toMatch(/^Fly by Sound: /);
            expect(text, l).toMatch(blind[l]!);
            expect(text, l).toMatch(beta[l]!);
            if (l !== 'en') expect(text, l).not.toBe(en);
        }
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
        const names = [...queryOf(href).keys()];
        expect(names).toEqual(['sonic', 'st', 'sc']);
        for (const n of names) expect(Object.values(SONIC_LINK_PARAMS)).toContain(n);
        expect(href).not.toMatch(/speech|voice|caption|motor|gain|pitch|fast|@/i);
        // control: written as the whole settings document, the same link would carry all of them
        expect(JSON.stringify(prefs)).toMatch(/selfVoice|speechRate|layerGainDb/);
    });

    it('L in the mode: the running lesson, a scan lesson with its scan and Scene size, no lesson the start screen; what it says after', () => {
        const d = defaultPrefs();
        expect(lessonLink(getLesson('hover-height'), d)).toEqual({ lesson: 'hover-height', sound: {} });
        expect(lessonLink(getLesson('free-garden'), d)).toEqual({ lesson: 'free-garden', scene: '7a475d38', size: 5, sound: {} });
        expect(lessonLink(null, { ...d, calm: true })).toEqual({ lesson: 'start', sound: { calm: true } });
        expect(linkLine(true, true, 'L')).toEqual({ key: 'sonic.say.linkCopied' });
        expect(linkLine(true, false, 'L')).toEqual({ key: 'sonic.say.linkCopiedStart' });
        expect(linkLine(false, true, 'L')).toEqual({ key: 'sonic.say.linkFailed', params: { key: 'L' } });
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

describe('K in the mode: the mode\'s own key help, said (step 2, the mode\'s own help)', () => {
    const capsOf = (sonic: boolean) => {
        const r = new KeyRouter({ map: KEYMAP, sonic: () => sonic });
        return (a: string) => r.caps(a).map((c) => c.cap).join(' ');
    };

    it('on a ?sonic= page it says the intro, T U I Z G, L, R and N with their keys, then the digits; every line is in the engine\'s dictionaries in en, es, pl and ru', () => {
        const lines = keyHelpLines(capsOf(true));
        expect(lines.map((l) => l.key)).toEqual(['help.intro', ...KEY_HELP.map(([k]) => k), 'help.digits']);
        expect(lines.slice(1, -1).map((l) => l.params?.key)).toEqual(['T', 'U', 'I', 'Z', 'G', 'L', 'R', 'N']);
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
        expect(lines.slice(1, -1).map((l) => l.params?.key)).toEqual(['L', 'R', 'N']);
    });
});

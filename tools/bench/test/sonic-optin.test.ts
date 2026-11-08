// v0.12 v12-optin (docs/wip/v12-optin.md): Fly by Sound only for those who choose it. The owner's message 40: the sound mode is not
// pressed on pilots who did not choose it; a curious sighted pilot can still find it; blind pilots share links that carry the mode.
// Here, in Node: the pause menu's one way in on an ordinary page (the feature shim), and its words in the four languages. The keys of
// the mode are tested where they are defined (packages/prefs/test/keymap.test.ts, tools/bench/test/app-keys.test.ts); the page itself
// by tools/bench/src/sonic-optin-page.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOUND_PAGE_ITEM, sonicFlight, soundPage } from '../../../apps/fly/src/app/builtin/sonic-flight';
import type { FlightContext, MenuItem } from '../../../apps/fly/src/app/context';
import { setSonicEntry, setSonicInstaller } from '../../../apps/fly/src/sonic/entry-state';
import type { SonicEntry } from '../../../apps/fly/src/sonic/entry';

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
        expect(it).toMatchObject({ id: 'pause.sound', action: null, labelKey: 'sonic.menu.page', section: 'tools', order: 95 });
        for (const l of LANGS) {
            vi.stubGlobal('document', { documentElement: { lang: l } });
            expect(it.href?.()).toBe(`/${l}/sound/`);
        }
        vi.stubGlobal('document', { documentElement: { lang: '' } });
        expect(soundPage()).toBe('/en/sound/');
        off();
        expect(items).toEqual([]);
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

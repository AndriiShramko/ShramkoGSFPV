// Lane w2-pilot (docs/wip/w2-pilot.md, B; a pilot's words: "at first I could not find the setting of the camera
// angle"): "Before you fly", the first screen a new pilot reads, names the camera angle and the way to it: the key
// that opens Settings, then the group and the row as the Settings screen labels them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { fakeDocument, FakeElement } from './helpers/fake-dom';

const LOCALES = join(__dirname, '../../../packages/i18n/locales/fly');

async function modalIn(lang: string): Promise<FakeElement> {
    vi.resetModules();
    vi.stubGlobal('location', { search: '', pathname: `/${lang}/fly/`, href: `http://127.0.0.1/${lang}/fly/`, origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', fakeDocument());
    vi.stubGlobal('navigator', { languages: [lang], language: lang });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    const P = await import('../../../apps/fly/src/ui/panels');
    const root = new FakeElement('div');
    P.warningModal(root as unknown as HTMLElement, () => undefined);
    return root;
}

/** a-ogonek (U+0105): built from its code, gate B18 keeps Polish letters inside locales/ */
const A_OGONEK = String.fromCharCode(0x105);

describe('Before you fly names the camera angle and where it is set', () => {
    it('en: key O, Settings, Camera, Camera uptilt', async () => {
        const line = (await modalIn('en')).querySelector('[data-testid="camera-line"]');
        expect(line?.textContent).toBe('Camera angle: key O opens Settings, then Camera, Camera uptilt.');
    });

    it('pl: the same path in the Polish labels of the Settings screen', async () => {
        const line = (await modalIn('pl')).querySelector('[data-testid="camera-line"]');
        expect(line?.textContent).toBe(`K${A_OGONEK}t kamery: klawisz O otwiera Ustawienia, potem Kamera, K${A_OGONEK}t nachylenia kamery.`);
    });

    it('the row it names is on the Settings screen at every level the screen offers (review: not only from sim up)', async () => {
        const { SCHEMA } = await import('../../../packages/prefs/src');
        const { rowShow } = await import('../../../apps/fly/src/ui/settings/model');
        const { LEVEL_ANSWERS } = await import('../../../apps/fly/src/ui/panels');
        const def = SCHEMA.byId.get('camera.uptiltDeg');
        expect(def?.group).toBe('camera');
        for (const { level } of LEVEL_ANSWERS) {
            expect(rowShow(def!, level, { all: false, searching: false, hit: true, explicit: false }).shown, level).toBe(true);
        }
    });

    it('every locale has the line with the key, the screen, the group and the row', () => {
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const s = (JSON.parse(readFileSync(join(LOCALES, 'menu', `${lang}.json`), 'utf8')) as Record<string, string>)['menu.level.camera'];
            for (const p of ['{key}', '{settings}', '{group}', '{row}']) expect(s, `${lang} ${p}`).toContain(p);
        }
    });
});

// Lane w2-pilot (docs/wip/w2-pilot.md, C; a pilot's words: "I found no way to choose a scene again, only next or
// random"): the crash card, the card a pilot who breaks sees, gets "Choose a scan" first in its scene row, and it
// opens the start page's own catalogue over the flight (ctx.scenes.openPicker, ui/scenes.ts ScenePicker). The pause
// menu's item says the same words: both wear the catalogue's title, scenes.title. Next, random and favourite stay.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { fakeDocument, FakeElement } from './helpers/fake-dom';

const LOCALES = join(__dirname, '../../../packages/i18n/locales/fly');
const title = (lang: string): string => (JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), 'utf8')) as Record<string, string>)['scenes.title'];

function page(lang: string): void {
    vi.resetModules();
    vi.stubGlobal('location', { search: '', pathname: `/${lang}/fly/`, href: `http://127.0.0.1/${lang}/fly/`, origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', fakeDocument());
    vi.stubGlobal('navigator', { languages: [lang], language: lang, sendBeacon: () => true });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}')));
    vi.stubGlobal('addEventListener', () => undefined);
    vi.stubGlobal('removeEventListener', () => undefined);
    vi.stubGlobal('window', globalThis);
}

type Listener = (e: unknown) => void;

/** The crash feature installed on a fake flight; the sim's crash event shows the card 1.5 s later (respawn off). */
async function crashCard(lang: string): Promise<{ ui: FakeElement; openPicker: ReturnType<typeof vi.fn>; go: ReturnType<typeof vi.fn> }> {
    page(lang);
    vi.useFakeTimers();
    const on = new Map<string, Listener[]>();
    const openPicker = vi.fn();
    const go = vi.fn(() => Promise.resolve(true));
    const ui = new FakeElement('div');
    const caps: Record<string, string> = { 'scene.next': 'N', 'scene.random': 'Shift+N', 'scene.favourite': 'Shift+F' };
    const ctx = {
        ui,
        crash: { info: null, onCrash: () => Promise.resolve(), clear: () => undefined },
        events: { on: (k: string, f: Listener) => on.set(k, [...(on.get(k) ?? []), f]), emit: () => undefined },
        keys: { caps: (a: string) => (caps[a] ? [{ cap: caps[a], aria: caps[a] }] : []), on: () => undefined },
        menu: { items: () => [] },
        session: { sim: { crashed: true }, stats: { life: () => ({ airtimeS: 1, distance: 2, maxSpeed: 3 }) }, pendingRespawn: () => null, policy: { rewindTicks: 5000 }, cameraOverride: false },
        hook: {},
        scene: { id: 'a' },
        scenes: { openPicker, go }
    };
    const { crash } = await import('../../../apps/fly/src/app/builtin/crash');
    crash.install(ctx as never);
    for (const f of on.get('sim') ?? []) f({ type: 'crash', speed: 6.2, tick: 1000 });
    await vi.advanceTimersByTimeAsync(1600);
    return { ui, openPicker, go };
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('the crash card opens the scene catalogue', () => {
    it('en: "Choose a scan" is first in the scene row, before next, random and favourite', async () => {
        const { ui } = await crashCard('en');
        const row = ui.querySelector('[data-testid="crash-scenes"]')!.querySelectorAll('button').map((b) => `${b.getAttribute('data-action')}:${b.getAttribute('aria-keyshortcuts')}`);
        expect(row).toEqual(['scene-pick:null', 'scene-next:N', 'scene-random:Shift+N', 'scene-favourite:Shift+F']);
        expect(ui.querySelector('[data-action="scene-pick"]')?.textContent).toBe('Choose a scan');
    });

    it('a click on it opens the picker the start page shows (ctx.scenes.openPicker), not next or random', async () => {
        const { ui, openPicker, go } = await crashCard('pl');
        expect(ui.querySelector('[data-action="scene-pick"]')?.textContent).toBe(title('pl'));
        ui.querySelector('[data-action="scene-pick"]')!.click();
        expect(openPicker).toHaveBeenCalledTimes(1);
        expect(go).not.toHaveBeenCalled();
        ui.querySelector('[data-action="scene-random"]')!.click();
        expect(go).toHaveBeenCalledWith('random');
    });
});

describe('the pause menu item says what it opens', () => {
    it('Esc menu: the item opens the picker and wears the catalogue title in every locale', async () => {
        page('en');
        const items: { id: string; labelKey: string; run: () => void }[] = [];
        const openPicker = vi.fn();
        const ctx = { ui: new FakeElement('div'), scene: { id: 'a' }, events: { on: () => undefined }, menu: { add: (i: (typeof items)[number]) => { items.push(i); return () => undefined; } }, scenes: { openPicker } };
        const { scene } = await import('../../../apps/fly/src/app/builtin/scene');
        scene.install(ctx as never);
        const item = items.find((i) => i.id === 'pause.scene')!;
        expect(item.labelKey).toBe('scenes.title');
        item.run();
        expect(openPicker).toHaveBeenCalledTimes(1);
        expect(['en', 'es', 'pl', 'ru'].map(title)).toEqual(['Choose a scan', 'Elige un escaneo', 'Wybierz skan', 'Выбери скан']);
    });
});

// Lane quiet3 (train 3, the lead's M4 and M2). M4: with the narrator off the flight is quiet from the Backslash press on. Measured
// before (tools/bench/scripts/quiet-probe.mjs, U:/Temp/gsfpv-train3/quiet3/before-*.json): the mode installs after the press (its
// chunk loads and its sound starts first), and until then the HUD's lines in #ui reached a screen reader. Now the shim
// (app/builtin/sonic-flight.ts) quiets #ui in the press itself; the mode's own sync (live-quiet.ts) takes it over, and a switch-on that
// did not come up gives it back. M2: "at most two lines" of captions is two rows: the newest line alone, clamped to two rows.
// Negative control: the M4 block fails by an assertion on origin/main's sonic-flight.ts, the M2 block on its captions.ts and sonic.css.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sonicFlight } from '../../../apps/fly/src/app/builtin/sonic-flight';
import type { FlightContext, MenuItem } from '../../../apps/fly/src/app/context';
import { quietLiveRegion } from '../../../apps/fly/src/sonic/live-quiet';
import { REPO } from '../src/evidence';

const sw = vi.hoisted(() => ({ comesUp: false, presses: 0 }));
// the mode's chunk stands in: a switch that comes up or does not (the real one needs Web Audio and a page)
vi.mock('../../../apps/fly/src/sonic/in-place', () => ({
    inPlaceSwitch: () => ({
        on: false,
        async toggle() {
            sw.presses++;
            (this as { on: boolean }).on = sw.comesUp;
            return sw.comesUp;
        }
    })
}));

class El {
    readonly attrs = new Map<string, string>();
    readonly kids: El[] = [];
    constructor(attrs: Record<string, string> = {}) {
        for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
    }
    getAttribute(n: string): string | null {
        return this.attrs.get(n) ?? null;
    }
    setAttribute(n: string, v: string): void {
        this.attrs.set(n, v);
    }
    removeAttribute(n: string): void {
        this.attrs.delete(n);
    }
    querySelectorAll(): El[] {
        return this.kids.filter((k) => k.attrs.has('aria-live') || k.attrs.has('data-sonic-live'));
    }
}

const flush = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 20; i++) await Promise.resolve();
};

function page(narrator: boolean | undefined): { ui: El; inner: El; press: () => void; off: () => void } {
    const ui = new El({ id: 'ui', 'aria-live': 'polite' });
    const inner = new El({ 'aria-live': 'assertive' });
    ui.kids.push(inner, new El());
    (globalThis as { document?: unknown }).document = { getElementById: (id: string) => (id === 'ui' ? ui : null) };
    const keys = new Map<string, (e: { repeat: boolean }) => void>();
    const ctx = {
        menu: { add: (_i: MenuItem) => () => undefined },
        keys: { on: (a: string, run: (e: { repeat: boolean }) => void) => { keys.set(a, run); return () => keys.delete(a); } },
        prefs: { collection: () => ({ prefs: narrator === undefined ? {} : { narrator } }) },
        session: null
    } as unknown as FlightContext;
    const off = sonicFlight.install(ctx) as () => void;
    return { ui, inner, press: () => keys.get('flyBySound.toggle')?.({ repeat: false }), off };
}

afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
    sw.comesUp = false;
    sw.presses = 0;
});

describe('M4: the narrator off, the flight is quiet from the Backslash press on', () => {
    it('the press itself sets #ui and the live regions inside it to "off" (before the mode is loaded), their own values kept', async () => {
        const p = page(false);
        p.press();
        // no await: the same task as the key press
        expect(p.ui.getAttribute('aria-live')).toBe('off');
        expect(p.inner.getAttribute('aria-live')).toBe('off');
        expect(p.ui.getAttribute('data-sonic-live')).toBe('polite');
        expect(p.inner.getAttribute('data-sonic-live')).toBe('assertive');
        await flush();
        p.off();
    });

    it('a switch-on that did not come up gives the values back', async () => {
        const p = page(false);
        sw.comesUp = false;
        p.press();
        expect(p.ui.getAttribute('aria-live')).toBe('off');
        await flush();
        expect(sw.presses).toBe(1);
        expect(p.ui.getAttribute('aria-live')).toBe('polite');
        expect(p.inner.getAttribute('aria-live')).toBe('assertive');
        expect(p.ui.getAttribute('data-sonic-live')).toBeNull();
        p.off();
    });

    it('a switch-on that came up stays quiet, and the mode\'s own sync (live-quiet.ts) gives the values back when the flight is not quiet', async () => {
        const p = page(false);
        sw.comesUp = true;
        p.press();
        await flush();
        expect(sw.presses).toBe(1);
        expect(p.ui.getAttribute('aria-live')).toBe('off');
        const sync = quietLiveRegion(p.ui, () => false);
        sync.sync();
        expect(p.ui.getAttribute('aria-live')).toBe('polite');
        expect(p.inner.getAttribute('aria-live')).toBe('assertive');
        p.off();
    });

    it('control: the narrator on (or never set) leaves the regions as they are at the press', async () => {
        for (const n of [true, undefined]) {
            const p = page(n);
            p.press();
            expect(p.ui.getAttribute('aria-live')).toBe('polite');
            expect(p.inner.getAttribute('aria-live')).toBe('assertive');
            await flush();
            p.off();
        }
    });
});

describe('M2: the captions show two rows at most: the newest line alone, clamped to two rows', () => {
    it('one line shown, two rows, and the stylesheet clamps the line shown to CAPTION_ROWS', () => {
        // captions.ts needs a page to load (i18n.ts, the document): its two numbers are read from its source; the region's behaviour
        // with them is held by sonic-captions-fit.test.ts (the newest line shown alone)
        const src = readFileSync(join(REPO, 'apps/fly/src/sonic/captions.ts'), 'utf8');
        expect(/export const CAPTION_LINES = (\d+);/.exec(src)?.[1]).toBe('1');
        expect(/export const CAPTION_ROWS = (\d+);/.exec(src)?.[1]).toBe('2');
        const css = readFileSync(join(REPO, 'apps/fly/src/sonic/sonic.css'), 'utf8');
        const rule = /\.sonic-caption:not\(\.sonic-sr-only\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
        expect(/-webkit-line-clamp:\s*(\d+)/.exec(rule)?.[1]).toBe('2');
        expect(rule).toMatch(/overflow:\s*hidden/);
        expect(rule).toMatch(/display:\s*-webkit-box/);
    });
});

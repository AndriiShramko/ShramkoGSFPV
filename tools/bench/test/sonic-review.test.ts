// Review of lane v12-flight (docs/wip/v12-flight-review.md): regression tests for the defects the review found, each with the
// controls that must keep passing. D2 and D2b (the speech of a lesson left behind) are in sonic-bridge.test.ts and
// sonic-lessons.test.ts beside the code they hold. The app modules read location, document and matchMedia when they load, so
// those are stubbed before the imports (as app-switches.test.ts).
//  - D4  dialogOpen() knows the Fly by Sound start screen over a flight (the page run is tools/bench/src/sonic-review-keys.ts).
//  - D6  the captions region keeps every line of a burst while a screen reader reads it (the page run is
//        tools/bench/src/sonic-review-captions.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** The few parts of the DOM the page's `h()` helper and the captions region use (the repo's tests run in Node, with no DOM library). */
class FakeText {
    constructor(readonly text: string) {}
}
class FakeEl {
    children: FakeEl[] = [];
    parent: FakeEl | null = null;
    attrs = new Map<string, string>();
    classes = new Set<string>();
    hidden = false;
    private texts: string[] = [];
    constructor(readonly tag: string) {}
    set className(v: string) {
        this.classes = new Set(v.split(/\s+/).filter(Boolean));
    }
    get className(): string {
        return [...this.classes].join(' ');
    }
    classList = {
        toggle: (c: string, on?: boolean): boolean => {
            const want = on ?? !this.classes.has(c);
            if (want) this.classes.add(c);
            else this.classes.delete(c);
            return want;
        },
        contains: (c: string): boolean => this.classes.has(c)
    };
    setAttribute(k: string, v: string): void {
        this.attrs.set(k, v);
    }
    getAttribute(k: string): string | null {
        return this.attrs.get(k) ?? null;
    }
    removeAttribute(k: string): void {
        this.attrs.delete(k);
    }
    addEventListener(): void {
        /* no events here */
    }
    append(...nodes: (FakeEl | FakeText)[]): void {
        for (const n of nodes) {
            if (n instanceof FakeText) this.texts.push(n.text);
            else {
                n.parent = this;
                this.children.push(n);
            }
        }
    }
    get firstElementChild(): FakeEl | null {
        return this.children[0] ?? null;
    }
    remove(): void {
        if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
        this.parent = null;
    }
    get textContent(): string {
        return this.texts.join('') + this.children.map((c) => c.textContent).join('');
    }
}

describe('review D4: the start screen over a running flight is a dialog for the keyboard source', () => {
    interface Fake {
        classes: string[];
        hidden: boolean;
    }
    /** document.querySelector for the selectors dialogOpen asks: alternatives of the form `.a.b` and `.a:not([hidden])`. */
    const matches = (sel: string, e: Fake): boolean =>
        sel.split(',').map((s) => s.trim()).some((alt) => {
            const notHidden = alt.endsWith(':not([hidden])');
            const classes = alt.replace(':not([hidden])', '').split('.').filter(Boolean);
            return classes.length > 0 && classes.every((c) => e.classes.includes(c)) && (!notHidden || !e.hidden);
        });
    let dom: Fake[] = [];
    const page = async (): Promise<() => boolean> => {
        vi.stubGlobal('document', { querySelector: (sel: string) => dom.find((e) => matches(sel, e)) ?? null });
        return (await import('../../../apps/fly/src/devices/keyboard')).dialogOpen;
    };

    it('shown: Space and the arrows belong to its buttons, sliders and radios (the keyboard source stands aside); hidden: the flight\'s again', async () => {
        const dialogOpen = await page();
        dom = [];
        expect(dialogOpen()).toBe(false);
        dom = [{ classes: ['sonic-start'], hidden: false }];
        expect(dialogOpen()).toBe(true);
        dom = [{ classes: ['sonic-start'], hidden: true }];
        expect(dialogOpen()).toBe(false);
    });

    it('control: the dialogs it knew still count, and a screen that is none does not', async () => {
        const dialogOpen = await page();
        for (const classes of [['screen', 'radio'], ['panel'], ['screen', 'drones'], ['screen', 'scenes']]) {
            dom = [{ classes, hidden: false }];
            expect(dialogOpen()).toBe(true);
        }
        dom = [{ classes: ['screen', 'loading'], hidden: false }, { classes: ['sonic-captions'], hidden: false }];
        expect(dialogOpen()).toBe(false);
    });
});

describe('review D6: the captions region and a screen reader', () => {
    /** The page's `Captions` on a fake document: `all` is what the region holds (what the accessibility tree is built from). */
    async function captions(): Promise<{ c: InstanceType<typeof import('../../../apps/fly/src/sonic/captions').Captions>; body: FakeEl; mod: typeof import('../../../apps/fly/src/sonic/captions') }> {
        const body = new FakeEl('body');
        vi.stubGlobal('location', { search: '', pathname: '/en/fly/', href: 'http://127.0.0.1/en/fly/', origin: 'http://127.0.0.1' });
        vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
        vi.stubGlobal('document', {
            cookie: '',
            documentElement: { lang: '' },
            body,
            createElement: (tag: string) => new FakeEl(tag),
            createTextNode: (text: string) => new FakeText(text)
        });
        vi.useFakeTimers();
        const mod = await import('../../../apps/fly/src/sonic/captions');
        const c = new mod.Captions(body as unknown as HTMLElement);
        return { c, body, mod };
    }
    const burst = (n: number): string[] => Array.from({ length: n }, (_, i) => `line ${i + 1}`);
    const seenByEye = (c: { root: unknown }): string[] =>
        (c.root as FakeEl).children.filter((l) => !l.classes.has('sonic-sr-only')).map((l) => l.textContent);

    it('a screen reader reads the region ("my screen reader speaks"): every line of a lesson\'s burst of six stays in it, the eye sees the last three', async () => {
        const { c, mod } = await captions();
        c.configure({ visible: true, live: true });
        expect((c.root as unknown as FakeEl).getAttribute('aria-live')).toBe('polite');
        for (const l of burst(6)) c.add(l);
        // all six are in the region in this task's end: they are what the browser announces
        expect(c.lines()).toEqual(burst(6));
        // only the newest CAPTION_LINES are shown; the older ones are hidden from the eye, not from the accessibility tree
        expect(seenByEye(c)).toEqual(burst(6).slice(-mod.CAPTION_LINES));
    });

    it('control: when the engine speaks (the region is not live) the region keeps the last three, as before', async () => {
        const { c, mod } = await captions();
        c.configure({ visible: true, live: false });
        expect((c.root as unknown as FakeEl).getAttribute('aria-live')).toBe('off');
        for (const l of burst(6)) c.add(l);
        expect(c.lines()).toEqual(burst(6).slice(-mod.CAPTION_LINES));
        expect(seenByEye(c)).toEqual(burst(6).slice(-mod.CAPTION_LINES));
    });

    it('control: every line goes after its time, the region stays bounded however many lines come, and nothing is kept when there is nothing to show or read', async () => {
        const { c, mod } = await captions();
        c.configure({ visible: true, live: true });
        for (const l of burst(300)) c.add(l);
        expect(c.lines().length).toBeLessThanOrEqual(64);
        expect(c.lines().at(-1)).toBe('line 300');
        vi.advanceTimersByTime(mod.CAPTION_MS + 1);
        expect(c.lines()).toEqual([]);
        // not live and not shown: the region is hidden and takes no line
        c.configure({ visible: false, live: false });
        c.add('nobody reads this');
        expect(c.lines()).toEqual([]);
    });

    it('control: going from a screen reader to the engine speaking trims the region to what the eye sees', async () => {
        const { c, mod } = await captions();
        c.configure({ visible: true, live: true });
        for (const l of burst(5)) c.add(l);
        c.configure({ visible: true, live: false });
        expect(c.lines()).toEqual(burst(5).slice(-mod.CAPTION_LINES));
        expect(seenByEye(c)).toEqual(burst(5).slice(-mod.CAPTION_LINES));
    });

    it('a screen reader with the captions hidden from the eye: the region is visually hidden but holds the whole burst', async () => {
        const { c } = await captions();
        c.configure({ visible: false, live: true });
        for (const l of burst(6)) c.add(l);
        expect((c.root as unknown as FakeEl).classes.has('sonic-sr-only')).toBe(true);
        expect(c.lines()).toEqual(burst(6));
    });
});

describe('review D3: a lesson that does not open at the entry is told to the pilot in his language', () => {
    it('a scan lesson says the scan did not load, any other lesson says it did not open; both are in the engine\'s dictionaries, in every language, as sentences (no key, no placeholder, no English copy)', async () => {
        const { launchFailureLine } = await import('../../../apps/fly/src/sonic/start-model');
        const { engineDicts } = await import('../../../apps/fly/src/sonic/host-lines');
        const { LOCALES } = await import('../../../packages/sonic-fpv/src');
        expect(launchFailureLine(true)).toEqual({ key: 'sonic.say.scanFailed' });
        expect(launchFailureLine(false)).toEqual({ key: 'sonic.say.lessonFailed' });
        const dicts = engineDicts();
        for (const scan of [true, false]) {
            const key = launchFailureLine(scan).key;
            const english = dicts.en[key];
            expect(english).toMatch(/^[A-Z].{20,}\.$/);
            for (const l of LOCALES) {
                const text = dicts[l][key];
                expect(text, `${l} ${key}`).toBeTruthy();
                expect(text).not.toBe(key);
                expect(text).not.toMatch(/[{}]/);
                if (l !== 'en') expect(text, `${l} ${key} is not the English text`).not.toBe(english);
            }
        }
    });

    it('control: the lines the page already said for a failed scan load from inside a flight are the same dictionary entries', async () => {
        const { engineDicts } = await import('../../../apps/fly/src/sonic/host-lines');
        const dicts = engineDicts();
        for (const key of ['sonic.say.scanFailed', 'sonic.say.scanLoading']) expect(dicts.en[key]).toBeTruthy();
    });
});

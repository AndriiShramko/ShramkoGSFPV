// v13-int review K2 (docs/wip/v13-int-review.md "Fixes"): the captions never lie over the mode's panels. The longer lines of Spanish, Polish and
// Russian wrapped to more rows and reached the progress panel (1280 x 720, 1366 x 768) and the attitude display (960 x 540, 640 x 360); the
// layout check measures the real page (tools/bench/src/v13-look-page.ts layout, four languages). Here the rule of captions.ts fit() on a
// stand-in with a layout: lines stacked under the region's top, each as tall as its text wraps; panels where the page puts them. While the
// lines shown reach down to a panel under the region (PANELS, CAPTION_GAP_PX over its top), the oldest shown line is hidden from the eye
// (sonic-sr-only: still in the region for a screen reader); the newest is never hidden; a panel beside the region limits nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';

interface Rect { left: number; right: number; top: number; bottom: number; width: number; height: number }

/** A stand-in element with the layout fit() reads: the region stacks its shown lines (6 px apart) from its top; a line is as tall as `h`. */
class LayoutEl {
    children: LayoutEl[] = [];
    parent: LayoutEl | null = null;
    classes = new Set<string>();
    attrs = new Map<string, string>();
    hidden = false;
    texts: string[] = [];
    /** where the region or a panel lies (a panel's own rect; the region's top, left and right) */
    box: { left: number; right: number; top: number } = { left: 0, right: 0, top: 0 };
    /** a line's height when shown, px */
    h = 0;
    ownerDocument: unknown = null;
    /** the inline top captions.ts sets (lane quiet2 N6: under the course's clock block); empty: the stylesheet's top, box.top */
    style = { top: '' };
    /** the region's top as laid out: its inline top when set, else box.top */
    get topNow(): number {
        return this.style.top ? parseFloat(this.style.top) : this.box.top;
    }
    readonly classList = {
        add: (c: string): void => void this.classes.add(c),
        remove: (c: string): void => void this.classes.delete(c),
        toggle: (c: string, on?: boolean): void => {
            if (on ?? !this.classes.has(c)) this.classes.add(c);
            else this.classes.delete(c);
        },
        contains: (c: string): boolean => this.classes.has(c)
    };
    constructor(readonly tag: string) {}
    set className(v: string) {
        this.classes = new Set(v.split(/\s+/).filter(Boolean));
    }
    get className(): string {
        return [...this.classes].join(' ');
    }
    addEventListener(): void {
        /* no events here */
    }
    setAttribute(k: string, v: string): void {
        this.attrs.set(k, v);
        if (k === 'class') for (const c of v.split(/\s+/).filter(Boolean)) this.classes.add(c);
    }
    getAttribute(k: string): string | null {
        return this.attrs.get(k) ?? null;
    }
    append(...nodes: unknown[]): void {
        for (const n of nodes) {
            if (typeof n === 'string') this.texts.push(n);
            else if (n instanceof LayoutEl) {
                n.parent = this;
                this.children.push(n);
            } else if (n && typeof n === 'object' && 'text' in (n as object)) this.texts.push((n as { text: string }).text);
        }
    }
    get firstElementChild(): LayoutEl | null {
        return this.children[0] ?? null;
    }
    remove(): void {
        if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
        this.parent = null;
    }
    get textContent(): string {
        return this.texts.join('');
    }
    getBoundingClientRect(): Rect {
        if (this.classes.has('sonic-captions')) {
            const shown = this.children.filter((c) => !c.classes.has('sonic-sr-only'));
            const height = shown.reduce((a, c) => a + c.h, 0) + Math.max(0, shown.length - 1) * 6;
            return { left: this.box.left, right: this.box.right, top: this.topNow, bottom: this.topNow + height, width: this.box.right - this.box.left, height };
        }
        // a line: under the shown lines before it, 6 px apart, as wide as the region (a hidden one is a 1 px box)
        const p = this.parent;
        if (p && p.classes.has('sonic-captions')) {
            if (this.classes.has('sonic-sr-only')) return { left: p.box.left, right: p.box.left + 1, top: p.topNow, bottom: p.topNow + 1, width: 1, height: 1 };
            let top = p.topNow;
            for (const c of p.children) {
                if (c === this) break;
                if (!c.classes.has('sonic-sr-only')) top += c.h + 6;
            }
            return { left: p.box.left, right: p.box.right, top, bottom: top + this.h, width: p.box.right - p.box.left, height: this.h };
        }
        if (this.hidden) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
        return { left: this.box.left, right: this.box.right, top: this.box.top, bottom: this.box.top + this.h, width: this.box.right - this.box.left, height: this.h };
    }
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

/**
 * The page's Captions on the stand-in: the region 92 px down, from x 388 to 1268 (1280 x 720 since K2), and the panels given. `innerHeight`:
 * the window's height (the view's centre at half of it); none, as in K2's own tests: a page whose view has no height.
 */
async function page(panels: { left: number; right: number; top: number; h: number }[], innerHeight?: number, clocks: { left: number; right: number; top: number; h: number }[] = []): Promise<{ c: InstanceType<typeof import('../../../apps/fly/src/sonic/captions').Captions>; root: LayoutEl; panels: LayoutEl[]; clocks: LayoutEl[]; add: (text: string, h: number) => void }> {
    const body = new LayoutEl('body');
    const boxOf = (p: { left: number; right: number; top: number; h: number }): LayoutEl => {
        const e = new LayoutEl('section');
        e.box = { left: p.left, right: p.right, top: p.top };
        e.h = p.h;
        return e;
    };
    const els = panels.map(boxOf);
    const clockEls = clocks.map(boxOf);
    let nextH = 0;
    const doc = {
        cookie: '',
        documentElement: { lang: '' },
        body,
        createElement: (tag: string) => {
            const e = new LayoutEl(tag);
            e.ownerDocument = doc;
            // a caption line takes the height the test gives the next one
            if (tag === 'p') e.h = nextH;
            return e;
        },
        createTextNode: (text: string) => ({ text }),
        querySelectorAll: (sel: string) => (sel === '.course-hud' ? clockEls : sel.includes('.sonic-attitude') ? els : []),
        defaultView: innerHeight === undefined ? null : { innerHeight }
    };
    vi.stubGlobal('location', { search: '', pathname: '/en/fly/', href: 'http://127.0.0.1/en/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
    vi.stubGlobal('document', doc);
    vi.useFakeTimers();
    const mod = await import('../../../apps/fly/src/sonic/captions');
    const c = new mod.Captions(body as unknown as HTMLElement);
    const root = c.root as unknown as LayoutEl;
    root.box = { left: 388, right: 1268, top: 92 };
    c.configure({ visible: true, live: false });
    return {
        c,
        root,
        panels: els,
        clocks: clockEls,
        add: (text, h) => {
            nextH = h;
            c.add(text);
        }
    };
}

const seen = (root: LayoutEl): string[] => root.children.filter((l) => !l.classes.has('sonic-sr-only')).map((l) => l.textContent);
const bottomOf = (root: LayoutEl): number => root.getBoundingClientRect().bottom;

describe('v13-int review K2: the captions stay clear of the panels under them', () => {
    it('Russian lines of four rows (160 px each) over the attitude display at 1280 x 720 (top 394): only the newest is shown, ending over the display, 8 px clear', async () => {
        const { root, add } = await page([{ left: 900, right: 1268, top: 394, h: 234 }]);
        for (const t of ['one', 'two', 'three']) add(t, 160);
        expect(seen(root)).toEqual(['three']);
        expect(bottomOf(root)).toBeLessThanOrEqual(394 - 8);
        // not read by a screen reader here (not live): only the line shown is kept (CAPTION_LINES 1, lane quiet3 M2)
        expect(root.children.map((l) => l.textContent)).toEqual(['three']);
    });

    it('English lines (two rows, 84 px) fit over it: the newest shown alone (CAPTION_LINES 1, lane quiet3 M2)', async () => {
        const { root, add } = await page([{ left: 900, right: 1268, top: 394, h: 234 }]);
        for (const t of ['one', 'two', 'three']) add(t, 84);
        expect(seen(root)).toEqual(['three']);
        expect(bottomOf(root)).toBe(92 + 84);
    });

    it('the newest line is never hidden, even when it alone reaches the panel', async () => {
        const { root, add } = await page([{ left: 900, right: 1268, top: 200, h: 100 }]);
        for (const t of ['one', 'two', 'three']) add(t, 130);
        expect(seen(root)).toEqual(['three']);
    });

    it('control: a panel beside the region (the progress panel at the left edge, x 12 to 261) or a hidden one limits nothing: the newest shown, in its own place', async () => {
        const beside = await page([{ left: 12, right: 261, top: 273, h: 198 }]);
        for (const t of ['one', 'two', 'three']) beside.add(t, 160);
        expect(seen(beside.root)).toEqual(['three']);
        expect(bottomOf(beside.root)).toBe(92 + 160);
        const hidden = await page([{ left: 900, right: 1268, top: 394, h: 234 }]);
        (hidden.panels[0] as LayoutEl).hidden = true;
        for (const t of ['one', 'two', 'three']) hidden.add(t, 160);
        expect(seen(hidden.root)).toEqual(['three']);
    });

    it('the page grows (refit on resize): the newest line stays shown, and alone (lane quiet3 M2: one line of two rows at most)', async () => {
        const { c, root, panels, add } = await page([{ left: 900, right: 1268, top: 394, h: 234 }]);
        for (const t of ['one', 'two', 'three']) add(t, 160);
        expect(seen(root)).toEqual(['three']);
        (panels[0] as LayoutEl).box = { left: 900, right: 1268, top: 700 };
        c.refit();
        expect(seen(root)).toEqual(['three']);
    });
});

// Lane quiet2 (the lead's N6): the lead saw three caption lines over the course's clock block (U:/Temp/gsfpv-train3/shots/onecourse-after.png).
// At most two lines are shown, and while the clock block (.course-hud, top centre) is shown and meets the region's columns, the region starts
// CAPTION_GAP_PX under its bottom. The clock here: 1280 x 720, x 560 to 720, from 120 px, 70 px tall (bottom 190).
describe('lane quiet2 N6: at most two lines, never over the course\'s clock block', () => {
    const CLOCK = { left: 560, right: 720, top: 120, h: 70 };
    it('three lines of one row: the newest shown (lane quiet3 M2), the region starts 8 px under the clock, no shown line meets it', async () => {
        const { root, add } = await page([], 720, [CLOCK]);
        for (const t of ['one', 'two', 'three']) add(t, 50);
        expect(seen(root)).toEqual(['three']);
        expect(root.getBoundingClientRect().top).toBe(190 + 8);
        for (const l of root.children.filter((x) => !x.classes.has('sonic-sr-only'))) expect(l.getBoundingClientRect().top).toBeGreaterThanOrEqual(190 + 8);
    });

    it('the clock goes (hidden: no box) or stands beside the region: the region keeps its own top (92 px)', async () => {
        const gone = await page([], 720, [CLOCK]);
        gone.add('one', 50);
        expect(gone.root.getBoundingClientRect().top).toBe(198);
        (gone.clocks[0] as LayoutEl).hidden = true;
        gone.c.refit();
        expect(gone.root.getBoundingClientRect().top).toBe(92);
        const beside = await page([], 720, [{ left: 12, right: 300, top: 120, h: 70 }]);
        beside.add('one', 50);
        expect(beside.root.getBoundingClientRect().top).toBe(92);
    });

    it('under the clock the view\'s centre still bounds the lines: two of 84 px from 198 px pass 340, only the newest is shown', async () => {
        const { root, add } = await page([], 720, [CLOCK]);
        for (const t of ['one', 'two']) add(t, 84);
        expect(seen(root)).toEqual(['two']);
    });
});

// v13-int review K2, part 2 (found by the lane end's sonic-lessons-page): in the column right of the panels a line of hover-height's start wrapped
// once more than in the centred captions, and its three lines shown ended at 355 px of 720 (before K2: 321), 5 px over the view's centre, where
// the target is; the page proof wants 20 px (CENTRE_GAP_PX). No panel lies under them there: the bound is the view's centre itself.
describe('v13-int review K2, part 2: the captions end 20 px over the view\'s centre', () => {
    it('hover-height\'s start at 1280 x 720 (three lines of two rows, 84 px each, from 92 px: 356 px): the oldest is hidden from the eye, the two newest end at 266 px, 20 px or more over the centre (360)', async () => {
        const { root, add } = await page([{ left: 12, right: 261, top: 273, h: 198 }], 720);
        for (const t of ['title', 'keys', 'intro']) add(t, 84);
        expect(seen(root)).toEqual(['intro']);
        expect(bottomOf(root)).toBe(92 + 84);
        expect(bottomOf(root)).toBeLessThanOrEqual(360 - 20);
        // not read by a screen reader here (not live): only the lines shown are kept (CAPTION_LINES)
        expect(root.children.map((l) => l.textContent)).toEqual(['intro']);
    });

    it('lines of one row (50 px) end at 198 px: the two newest shown', async () => {
        const { root, add } = await page([], 720);
        for (const t of ['one', 'two', 'three']) add(t, 50);
        expect(seen(root)).toEqual(['three']);
        expect(bottomOf(root)).toBe(92 + 50);
    });

    it('the newest line is never hidden, even when it alone ends under the centre', async () => {
        const { root, add } = await page([], 720);
        for (const t of ['one', 'two', 'three']) add(t, 300);
        expect(seen(root)).toEqual(['three']);
    });

    it('a taller window (1280 x 1000, the centre at 500) has room for two tall lines again on a resize', async () => {
        const { c, root, add } = await page([], 720);
        for (const t of ['title', 'keys', 'intro']) add(t, 160);
        expect(seen(root)).toEqual(['intro']);
        (root.ownerDocument as { defaultView: { innerHeight: number } }).defaultView.innerHeight = 1000;
        c.refit();
        // lane quiet3 (M2): one line shown at most (CAPTION_LINES 1, two rows), so a taller window still shows the newest alone
        expect(seen(root)).toEqual(['intro']);
    });

    it('control: the same three lines on a page whose view has no height (no centre to keep): the newest shown, ending at 176 px', async () => {
        const { root, add } = await page([{ left: 12, right: 261, top: 273, h: 198 }]);
        for (const t of ['title', 'keys', 'intro']) add(t, 84);
        expect(seen(root)).toEqual(['intro']);
        expect(bottomOf(root)).toBe(92 + 84);
    });
});

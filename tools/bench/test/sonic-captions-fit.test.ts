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
            return { left: this.box.left, right: this.box.right, top: this.box.top, bottom: this.box.top + height, width: this.box.right - this.box.left, height };
        }
        // a line: under the shown lines before it, 6 px apart, as wide as the region (a hidden one is a 1 px box)
        const p = this.parent;
        if (p && p.classes.has('sonic-captions')) {
            if (this.classes.has('sonic-sr-only')) return { left: p.box.left, right: p.box.left + 1, top: p.box.top, bottom: p.box.top + 1, width: 1, height: 1 };
            let top = p.box.top;
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
async function page(panels: { left: number; right: number; top: number; h: number }[], innerHeight?: number): Promise<{ c: InstanceType<typeof import('../../../apps/fly/src/sonic/captions').Captions>; root: LayoutEl; panels: LayoutEl[]; add: (text: string, h: number) => void }> {
    const body = new LayoutEl('body');
    const els = panels.map((p) => {
        const e = new LayoutEl('section');
        e.box = { left: p.left, right: p.right, top: p.top };
        e.h = p.h;
        return e;
    });
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
        querySelectorAll: (sel: string) => (sel.includes('.sonic-attitude') ? els : []),
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
        add: (text, h) => {
            nextH = h;
            c.add(text);
        }
    };
}

const seen = (root: LayoutEl): string[] => root.children.filter((l) => !l.classes.has('sonic-sr-only')).map((l) => l.textContent);
const bottomOf = (root: LayoutEl): number => root.getBoundingClientRect().bottom;

describe('v13-int review K2: the captions stay clear of the panels under them', () => {
    it('three Russian lines of three rows (110 px each) over the attitude display at 1280 x 720 (top 394): the oldest is hidden from the eye, the two newest end over the display, 8 px clear', async () => {
        const { root, add } = await page([{ left: 900, right: 1268, top: 394, h: 234 }]);
        for (const t of ['one', 'two', 'three']) add(t, 110);
        expect(seen(root)).toEqual(['two', 'three']);
        expect(bottomOf(root)).toBeLessThanOrEqual(394 - 8);
        // still in the region (a screen reader reads it): only hidden from the eye
        expect(root.children.map((l) => l.textContent)).toEqual(['one', 'two', 'three']);
    });

    it('English lines (two rows, 84 px) fit over it: all three shown', async () => {
        const { root, add } = await page([{ left: 900, right: 1268, top: 394, h: 234 }]);
        for (const t of ['one', 'two', 'three']) add(t, 84);
        expect(seen(root)).toEqual(['one', 'two', 'three']);
    });

    it('the newest line is never hidden, even when it alone reaches the panel', async () => {
        const { root, add } = await page([{ left: 900, right: 1268, top: 200, h: 100 }]);
        for (const t of ['one', 'two', 'three']) add(t, 130);
        expect(seen(root)).toEqual(['three']);
    });

    it('control: a panel beside the region (the progress panel at the left edge, x 12 to 261) or a hidden one limits nothing: all three shown', async () => {
        const beside = await page([{ left: 12, right: 261, top: 273, h: 198 }]);
        for (const t of ['one', 'two', 'three']) beside.add(t, 110);
        expect(seen(beside.root)).toEqual(['one', 'two', 'three']);
        const hidden = await page([{ left: 900, right: 1268, top: 394, h: 234 }]);
        (hidden.panels[0] as LayoutEl).hidden = true;
        for (const t of ['one', 'two', 'three']) hidden.add(t, 110);
        expect(seen(hidden.root)).toEqual(['one', 'two', 'three']);
    });

    it('the page grows (refit on resize): a line hidden in a short window comes back when there is room', async () => {
        const { c, root, panels, add } = await page([{ left: 900, right: 1268, top: 394, h: 234 }]);
        for (const t of ['one', 'two', 'three']) add(t, 110);
        expect(seen(root)).toEqual(['two', 'three']);
        (panels[0] as LayoutEl).box = { left: 900, right: 1268, top: 700 };
        c.refit();
        expect(seen(root)).toEqual(['one', 'two', 'three']);
    });
});

// v13-int review K2, part 2 (found by the lane end's sonic-lessons-page): in the column right of the panels a line of hover-height's start wrapped
// once more than in the centred captions, and its three lines shown ended at 355 px of 720 (before K2: 321), 5 px over the view's centre, where
// the target is; the page proof wants 20 px (CENTRE_GAP_PX). No panel lies under them there: the bound is the view's centre itself.
describe('v13-int review K2, part 2: the captions end 20 px over the view\'s centre', () => {
    it('hover-height\'s start at 1280 x 720 (three lines of two rows, 84 px each, from 92 px: 356 px): the oldest is hidden from the eye, the two newest end at 266 px, 20 px or more over the centre (360)', async () => {
        const { root, add } = await page([{ left: 12, right: 261, top: 273, h: 198 }], 720);
        for (const t of ['title', 'keys', 'intro']) add(t, 84);
        expect(seen(root)).toEqual(['keys', 'intro']);
        expect(bottomOf(root)).toBe(92 + 84 + 6 + 84);
        expect(bottomOf(root)).toBeLessThanOrEqual(360 - 20);
        // still in the region for a screen reader
        expect(root.children.map((l) => l.textContent)).toEqual(['title', 'keys', 'intro']);
    });

    it('lines of one row (50 px) end at 254 px: all three shown', async () => {
        const { root, add } = await page([], 720);
        for (const t of ['one', 'two', 'three']) add(t, 50);
        expect(seen(root)).toEqual(['one', 'two', 'three']);
    });

    it('the newest line is never hidden, even when it alone ends under the centre', async () => {
        const { root, add } = await page([], 720);
        for (const t of ['one', 'two', 'three']) add(t, 300);
        expect(seen(root)).toEqual(['three']);
    });

    it('a taller window (1280 x 800, the centre at 400) has room for all three again on a resize', async () => {
        const { c, root, add } = await page([], 720);
        for (const t of ['title', 'keys', 'intro']) add(t, 84);
        expect(seen(root)).toEqual(['keys', 'intro']);
        (root.ownerDocument as { defaultView: { innerHeight: number } }).defaultView.innerHeight = 800;
        c.refit();
        expect(seen(root)).toEqual(['title', 'keys', 'intro']);
    });

    it('control: the same three lines on a page whose view has no height (no centre to keep): all three shown, ending at 356 px', async () => {
        const { root, add } = await page([{ left: 12, right: 261, top: 273, h: 198 }]);
        for (const t of ['title', 'keys', 'intro']) add(t, 84);
        expect(seen(root)).toEqual(['title', 'keys', 'intro']);
        expect(bottomOf(root)).toBe(356);
    });
});

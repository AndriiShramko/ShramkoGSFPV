// A small fake DOM for the Node tests of the simulator's UI classes (the HUD, the arm card): enough of
// Element, classList, attributes, text and a one-compound selector (`tag.class[attr=value]`) to build
// the real classes and read back what they drew. There is no layout, no events and no styles: it is a
// recorder, not a browser (the browser probes in tools/bench/scripts cover what a real page does).
// `document` is installed with vi.stubGlobal by the test, and removed with vi.unstubAllGlobals.

export class FakeText {
    parentNode: FakeElement | null = null;
    constructor(public data: string) {}
    get textContent(): string { return this.data; }
}

type Kid = FakeElement | FakeText;

class FakeClassList {
    private names: string[] = [];
    set(value: string): void { this.names = value.split(/\s+/).filter(Boolean); }
    toString(): string { return this.names.join(' '); }
    contains(n: string): boolean { return this.names.includes(n); }
    add(...n: string[]): void { for (const x of n) if (!this.names.includes(x)) this.names.push(x); }
    remove(...n: string[]): void { this.names = this.names.filter((x) => !n.includes(x)); }
    toggle(n: string, force?: boolean): boolean {
        const on = force ?? !this.names.includes(n);
        if (on) this.add(n); else this.remove(n);
        return on;
    }
}

/** The part of CSSStyleDeclaration the UI classes use: plain properties and (get|set)Property. */
function fakeStyle(): Record<string, string> & { setProperty(k: string, v: string): void; getPropertyValue(k: string): string } {
    const props = new Map<string, string>();
    const o: Record<string, unknown> = {};
    o.setProperty = (k: string, v: string): void => { props.set(k, v); };
    o.getPropertyValue = (k: string): string => props.get(k) ?? '';
    return o as never;
}

const SEL = /^([a-zA-Z0-9]*)((?:\.[\w-]+)*)(?:\[([\w-]+)(?:=([^\]]+))?\])?$/;

export class FakeElement {
    readonly children: Kid[] = [];
    parentNode: FakeElement | null = null;
    readonly attrs = new Map<string, string>();
    readonly style = fakeStyle();
    readonly classList = new FakeClassList();
    disabled = false;
    offsetParent: unknown = null;
    offsetHeight = 0;
    isConnected = true;
    private html = '';
    constructor(readonly tagName: string) {}

    /** reflects the `hidden` attribute, as a browser does (h() sets it as an attribute, the classes read the property) */
    get hidden(): boolean { return this.attrs.has('hidden'); }
    set hidden(v: boolean) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }

    get className(): string { return this.classList.toString(); }
    set className(v: string) { this.classList.set(v); }

    setAttribute(k: string, v: string): void {
        if (k === 'class') this.classList.set(v);
        else this.attrs.set(k, String(v));
    }
    getAttribute(k: string): string | null {
        if (k === 'class') return this.classList.toString();
        return this.attrs.get(k) ?? null;
    }
    removeAttribute(k: string): void { this.attrs.delete(k); }

    append(...nodes: Array<Kid | string>): void {
        for (const n of nodes) {
            const k = typeof n === 'string' ? new FakeText(n) : n;
            k.parentNode?.children.splice(k.parentNode.children.indexOf(k), 1);
            k.parentNode = this;
            this.children.push(k);
        }
    }
    replaceChildren(...nodes: Array<Kid | string>): void {
        for (const c of this.children) c.parentNode = null;
        this.children.length = 0;
        this.append(...nodes);
    }
    remove(): void { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
    get firstChild(): Kid | null { return this.children[0] ?? null; }
    contains(n: Kid | null): boolean {
        for (let x: Kid | null = n; x; x = x.parentNode) if (x === this) return true;
        return false;
    }

    get textContent(): string { return this.children.map((c) => c.textContent).join(''); }
    set textContent(v: string) { if (v === '') this.replaceChildren(); else this.replaceChildren(v); }
    get innerHTML(): string { return this.html; }
    set innerHTML(v: string) { this.html = v; this.replaceChildren(); }

    addEventListener(): void { /* no events here */ }
    removeEventListener(): void { /* no events here */ }
    focus(): void { /* no focus here */ }
    getBoundingClientRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number } {
        return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    }

    private matches(sel: string): boolean {
        const m = SEL.exec(sel.trim());
        if (!m) return false;
        const [, tag, classes, attr, val] = m;
        if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
        for (const c of classes.split('.').filter(Boolean)) if (!this.classList.contains(c)) return false;
        if (attr) {
            const v = this.getAttribute(attr);
            if (v === null || (val !== undefined && v !== val.replace(/^["']|["']$/g, ''))) return false;
        }
        return true;
    }

    /** Every descendant that matches a one-compound selector (`:scope >` and other combinators find nothing). */
    querySelectorAll(sel: string): FakeElement[] {
        const out: FakeElement[] = [];
        const walk = (e: FakeElement): void => {
            for (const c of e.children) if (c instanceof FakeElement) { if (c.matches(sel)) out.push(c); walk(c); }
        };
        walk(this);
        return out;
    }
    querySelector(sel: string): FakeElement | null { return this.querySelectorAll(sel)[0] ?? null; }
}

/** The `document` the classes build with. `querySelector` answers for the page outside the class under test: null unless `page` has it. */
export function fakeDocument(): { cookie: string; documentElement: { lang: string }; visibilityState: string; activeElement: null; page: FakeElement; [k: string]: unknown } {
    const page = new FakeElement('body');
    return {
        cookie: '',
        documentElement: { lang: '' },
        visibilityState: 'visible',
        activeElement: null,
        page,
        createElement: (tag: string) => new FakeElement(tag),
        createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
        createTextNode: (s: string) => new FakeText(s),
        querySelector: (sel: string) => page.querySelector(sel),
        querySelectorAll: (sel: string) => page.querySelectorAll(sel)
    };
}

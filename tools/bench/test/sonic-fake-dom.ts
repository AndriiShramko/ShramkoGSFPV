// A small stand-in for the page's DOM, enough for the mode's own small views (v0.13 lane v13-host stage B: the progress panel, the
// lesson menu) to run in Node: elements with attributes, dataset, hidden, text, children, focus and key events, and a document
// that makes them and knows which one has the focus. Not a test file (the name has no .test). The real page is the page proofs'.

type Listener = (e: FakeEvent) => void;

/** A dispatched event: its type, the key of a keydown, and whether a listener took it. */
export class FakeEvent {
    readonly type: string;
    readonly key: string;
    readonly code: string;
    readonly repeat: boolean;
    readonly shiftKey: boolean;
    defaultPrevented = false;
    propagationStopped = false;
    target: FakeElement | null = null;

    constructor(type: string, o: { key?: string; code?: string; repeat?: boolean; shiftKey?: boolean } = {}) {
        this.type = type;
        this.key = o.key ?? '';
        this.code = o.code ?? o.key ?? '';
        this.repeat = o.repeat ?? false;
        this.shiftKey = o.shiftKey ?? false;
    }

    preventDefault(): void {
        this.defaultPrevented = true;
    }

    stopPropagation(): void {
        this.propagationStopped = true;
    }

    stopImmediatePropagation(): void {
        this.propagationStopped = true;
    }
}

export class FakeElement {
    readonly tagName: string;
    readonly ownerDocument: FakeDocument;
    readonly attributes = new Map<string, string>();
    readonly dataset: Record<string, string> = {};
    children: FakeElement[] = [];
    parentElement: FakeElement | null = null;
    className = '';
    hidden = false;
    tabIndex = -1;
    private ownText = '';
    private readonly listeners = new Map<string, Listener[]>();

    constructor(doc: FakeDocument, tag: string) {
        this.ownerDocument = doc;
        this.tagName = tag.toUpperCase();
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, String(value));
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }

    hasAttribute(name: string): boolean {
        return this.attributes.has(name);
    }

    get textContent(): string {
        return this.ownText + this.children.map((c) => c.textContent).join('');
    }

    set textContent(v: string) {
        for (const c of this.children) c.parentElement = null;
        this.children = [];
        this.ownText = v;
    }

    append(...nodes: FakeElement[]): void {
        for (const n of nodes) {
            n.remove();
            n.parentElement = this;
            this.children.push(n);
        }
    }

    replaceChildren(...nodes: FakeElement[]): void {
        for (const c of this.children) c.parentElement = null;
        this.children = [];
        this.ownText = '';
        this.append(...nodes);
    }

    remove(): void {
        const p = this.parentElement;
        if (!p) return;
        p.children = p.children.filter((c) => c !== this);
        this.parentElement = null;
        if (this.ownerDocument.activeElement === this || this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    }

    contains(other: FakeElement | null): boolean {
        for (let e = other; e; e = e.parentElement) if (e === this) return true;
        return false;
    }

    get isConnected(): boolean {
        let e: FakeElement | null = this;
        while (e.parentElement) e = e.parentElement;
        return e === this.ownerDocument.body;
    }

    focus(): void {
        this.ownerDocument.activeElement = this;
    }

    addEventListener(type: string, cb: Listener): void {
        const list = this.listeners.get(type) ?? [];
        list.push(cb);
        this.listeners.set(type, list);
    }

    removeEventListener(type: string, cb: Listener): void {
        const list = this.listeners.get(type) ?? [];
        const i = list.indexOf(cb);
        if (i >= 0) list.splice(i, 1);
    }

    /** The event at this element, then up through its parents (bubbling), until one stops it. */
    dispatchEvent(e: FakeEvent): boolean {
        e.target ??= this;
        for (let el: FakeElement | null = this; el && !e.propagationStopped; el = el.parentElement) {
            for (const cb of [...(el.listeners.get(e.type) ?? [])]) cb(e);
        }
        return !e.defaultPrevented;
    }

    click(): void {
        this.dispatchEvent(new FakeEvent('click'));
    }

    /** Every element under this one, depth first. */
    descendants(): FakeElement[] {
        return this.children.flatMap((c) => [c, ...c.descendants()]);
    }
}

export class FakeDocument {
    readonly body: FakeElement;
    activeElement: FakeElement | null = null;

    constructor() {
        this.body = new FakeElement(this, 'body');
        this.activeElement = this.body;
    }

    createElement(tag: string): FakeElement {
        return new FakeElement(this, tag);
    }

    /** A key pressed where the focus is (a keydown that bubbles to the body). */
    key(key: string, o: { code?: string; repeat?: boolean; shiftKey?: boolean } = {}): FakeEvent {
        const e = new FakeEvent('keydown', { key, ...o });
        (this.activeElement ?? this.body).dispatchEvent(e);
        return e;
    }
}

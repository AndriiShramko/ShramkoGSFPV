// A small stand-in for the page's DOM, enough for the mode's own small views (v0.13 lane v13-host stage B: the progress panel, the
// lesson menu; stage C: the start screen and its spoken list) to run in Node: elements with attributes, dataset, hidden, text,
// children, focus (with its focusin event) and key events, form controls (value, checked, a click that toggles a box or picks a
// radio), simple selectors (a tag, #id, .class, [attr] and [attr="value"] in one compound, and lists of them), and a document that
// makes them, finds them, knows which one has the focus and has a window whose capture listeners hear a key first. Not a test file
// (the name has no .test). The real page is the page proofs'.

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

/** One compound selector: a tag, an id, classes and attributes, all of which an element must have. */
interface Compound {
    readonly tag: string | null;
    readonly id: string | null;
    readonly classes: readonly string[];
    readonly attrs: readonly { readonly name: string; readonly value: string | null }[];
}

function parseSelector(sel: string): Compound[] {
    return sel.split(',').map((part) => {
        const s = part.trim();
        const tag = /^[a-zA-Z][\w-]*/.exec(s)?.[0] ?? null;
        let id: string | null = null;
        const classes: string[] = [];
        const attrs: { name: string; value: string | null }[] = [];
        const re = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;
        for (let m = re.exec(s); m; m = re.exec(s)) {
            if (m[1] !== undefined) id = m[1];
            else if (m[2] !== undefined) classes.push(m[2]);
            else attrs.push({ name: m[3] as string, value: m[4] ?? null });
        }
        return { tag: tag === null ? null : tag.toUpperCase(), id, classes, attrs };
    });
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
    isContentEditable = false;
    private ownText = '';
    private ownValue: string | null = null;
    private ownChecked: boolean | null = null;
    private ownSelected: boolean | null = null;
    private readonly listeners = new Map<string, Listener[]>();

    constructor(doc: FakeDocument, tag: string) {
        this.ownerDocument = doc;
        this.tagName = tag.toUpperCase();
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, String(value));
        if (name === 'class') this.className = String(value);
        if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = String(value);
    }

    getAttribute(name: string): string | null {
        if (name === 'class') return this.className === '' ? null : this.className;
        if (name.startsWith('data-')) {
            const v = this.dataset[name.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())];
            if (v !== undefined) return v;
        }
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }

    hasAttribute(name: string): boolean {
        return this.getAttribute(name) !== null;
    }

    get id(): string {
        return this.getAttribute('id') ?? '';
    }

    set id(v: string) {
        this.setAttribute('id', v);
    }

    get type(): string {
        return this.getAttribute('type') ?? (this.tagName === 'BUTTON' ? 'submit' : this.tagName === 'INPUT' ? 'text' : '');
    }

    get textContent(): string {
        return this.ownText + this.children.map((c) => c.textContent).join('');
    }

    set textContent(v: string) {
        for (const c of this.children) c.parentElement = null;
        this.children = [];
        this.ownText = v;
    }

    /** An input's value (its own, else the attribute), a select's chosen option's, an option's. */
    get value(): string {
        if (this.tagName === 'SELECT') {
            const opts = this.descendants().filter((o) => o.tagName === 'OPTION');
            return (opts.find((o) => o.selected) ?? opts[0])?.value ?? '';
        }
        if (this.tagName === 'OPTION') return this.getAttribute('value') ?? this.textContent;
        return this.ownValue ?? this.getAttribute('value') ?? (this.type === 'checkbox' || this.type === 'radio' ? 'on' : '');
    }

    set value(v: string) {
        if (this.tagName === 'SELECT') {
            for (const o of this.descendants().filter((x) => x.tagName === 'OPTION')) o.selected = o.value === String(v);
            return;
        }
        this.ownValue = String(v);
    }

    get checked(): boolean {
        return this.ownChecked ?? this.hasAttribute('checked');
    }

    set checked(v: boolean) {
        this.ownChecked = v;
    }

    get selected(): boolean {
        return this.ownSelected ?? this.hasAttribute('selected');
    }

    set selected(v: boolean) {
        this.ownSelected = v;
    }

    /** Text and elements, as Element.append takes them. */
    append(...nodes: (FakeElement | string)[]): void {
        for (const x of nodes) {
            const n = typeof x === 'string' ? this.ownerDocument.createTextNode(x) : x;
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

    /** This element's place in its parent taken by `node`. */
    replaceWith(node: FakeElement): void {
        const p = this.parentElement;
        if (!p) return;
        node.remove();
        const i = p.children.indexOf(this);
        p.children.splice(i, 1, node);
        node.parentElement = p;
        this.parentElement = null;
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

    /** The focus moves here, and a focusin event bubbles from here (as the browser sends one). */
    focus(): void {
        if (this.ownerDocument.activeElement === this) return;
        this.ownerDocument.activeElement = this;
        this.dispatchEvent(new FakeEvent('focusin'));
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

    /** A click, as the browser makes one: a checkbox toggles and a radio is picked first (their input and change events after it). */
    click(): void {
        if (this.tagName === 'INPUT' && this.type === 'checkbox') {
            this.checked = !this.checked;
            this.dispatchEvent(new FakeEvent('click'));
            this.dispatchEvent(new FakeEvent('input'));
            this.dispatchEvent(new FakeEvent('change'));
            return;
        }
        if (this.tagName === 'INPUT' && this.type === 'radio') {
            const was = this.checked;
            const name = this.getAttribute('name');
            for (const r of this.ownerDocument.body.descendants()) if (r !== this && r.tagName === 'INPUT' && r.type === 'radio' && name !== null && r.getAttribute('name') === name) r.checked = false;
            this.checked = true;
            this.dispatchEvent(new FakeEvent('click'));
            if (!was) {
                this.dispatchEvent(new FakeEvent('input'));
                this.dispatchEvent(new FakeEvent('change'));
            }
            return;
        }
        this.dispatchEvent(new FakeEvent('click'));
    }

    /** Every element under this one, depth first. */
    descendants(): FakeElement[] {
        return this.children.flatMap((c) => [c, ...c.descendants()]);
    }

    /** Whether this element matches one of the compound selectors of `sel`. */
    matches(sel: string): boolean {
        return parseSelector(sel).some((c) => (c.tag === null || c.tag === this.tagName) && (c.id === null || this.id === c.id) && c.classes.every((k) => this.className.split(/\s+/).includes(k)) && c.attrs.every((a) => (a.value === null ? this.hasAttribute(a.name) : this.getAttribute(a.name) === a.value)));
    }

    querySelectorAll(sel: string): FakeElement[] {
        return this.descendants().filter((e) => e.matches(sel));
    }

    querySelector(sel: string): FakeElement | null {
        return this.descendants().find((e) => e.matches(sel)) ?? null;
    }

    closest(sel: string): FakeElement | null {
        for (let e: FakeElement | null = this; e; e = e.parentElement) if (e.matches(sel)) return e;
        return null;
    }
}

/** The page's window as far as key listeners go: capture listeners hear a key before the element it is pressed on. */
export class FakeWindow {
    private readonly capture: Listener[] = [];
    private readonly bubble: Listener[] = [];

    addEventListener(type: string, cb: Listener, capture?: boolean | { capture?: boolean }): void {
        if (type !== 'keydown') return;
        const c = typeof capture === 'object' ? capture.capture === true : capture === true;
        (c ? this.capture : this.bubble).push(cb);
    }

    removeEventListener(type: string, cb: Listener, capture?: boolean | { capture?: boolean }): void {
        if (type !== 'keydown') return;
        const c = typeof capture === 'object' ? capture.capture === true : capture === true;
        const list = c ? this.capture : this.bubble;
        const i = list.indexOf(cb);
        if (i >= 0) list.splice(i, 1);
    }

    /** The listeners still on (a view that went must have taken its own off). */
    get listening(): number {
        return this.capture.length + this.bubble.length;
    }

    runCapture(e: FakeEvent): void {
        for (const cb of [...this.capture]) if (!e.propagationStopped) cb(e);
    }

    runBubble(e: FakeEvent): void {
        for (const cb of [...this.bubble]) if (!e.propagationStopped) cb(e);
    }
}

export class FakeDocument {
    readonly body: FakeElement;
    readonly documentElement = { lang: '' };
    readonly window = new FakeWindow();
    cookie = '';
    activeElement: FakeElement | null = null;

    constructor() {
        this.body = new FakeElement(this, 'body');
        this.activeElement = this.body;
    }

    createElement(tag: string): FakeElement {
        return new FakeElement(this, tag);
    }

    createTextNode(text: string): FakeElement {
        const n = new FakeElement(this, '#text');
        n.textContent = text;
        return n;
    }

    getElementById(id: string): FakeElement | null {
        return this.body.descendants().find((e) => e.id === id) ?? null;
    }

    querySelector(sel: string): FakeElement | null {
        return this.body.querySelector(sel);
    }

    querySelectorAll(sel: string): FakeElement[] {
        return this.body.querySelectorAll(sel);
    }

    /** A key pressed where the focus is: the window's capture listeners first, then a keydown that bubbles to the body, then the window's own. */
    key(key: string, o: { code?: string; repeat?: boolean; shiftKey?: boolean } = {}): FakeEvent {
        const e = new FakeEvent('keydown', { key, ...o });
        e.target = this.activeElement ?? this.body;
        this.window.runCapture(e);
        if (!e.propagationStopped) (this.activeElement ?? this.body).dispatchEvent(e);
        if (!e.propagationStopped) this.window.runBubble(e);
        return e;
    }
}

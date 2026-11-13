// Lane mouse-free (docs/wip/mouse-free.md): a window that needs the mouse always gets the mouse. The owner's
// report of 2026-11-13: "Send this list" on the Controls screen closed it (the last pause reason, so the flight
// asked for the pointer lock inside that click) and opened the report form in the same click; the form's pause
// found no lock to release yet, then the lock landed over the form: no cursor until he left the browser.
// The rule lives in play/mouse-look.ts MouseLook (host.held): checked with a fake document that grants the lock
// later, as a browser does (requestPointerLock resolves, then 'pointerlockchange').
//  - a lock asked for before a window opened and landing after it is let go at once, and the flight is not told
//    it was lost (no pause menu over the form);
//  - while the window is up a lock that lands (a click on a control inside) does not stay;
//  - sync(): a window opened while the lock is held lets it go, quietly;
//  - after the window closed a lock holds again; a release the page did not ask for still pauses (Esc);
//  - cursorWindowOpen: the panel of ui/dom.ts and the Controls screen count, an empty page does not.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDocument, FakeElement } from './helpers/fake-dom';

type Mod = typeof import('../../../apps/fly/src/play/mouse-look');
let M: Mod;

/** The document with pointer lock: requestPointerLock is granted when the test says so (land()). */
class LockDoc {
    readonly base = fakeDocument();
    pointerLockElement: unknown = null;
    private listeners: { type: string; fn: () => void }[] = [];
    addEventListener(type: string, fn: () => void): void { this.listeners.push({ type, fn }); }
    removeEventListener(type: string, fn: () => void): void { this.listeners = this.listeners.filter((l) => l.type !== type || l.fn !== fn); }
    fire(): void { for (const l of this.listeners.filter((x) => x.type === 'pointerlockchange')) l.fn(); }
    exitPointerLock(): void { if (this.pointerLockElement === null) return; this.pointerLockElement = null; this.fire(); }
    querySelector(sel: string): unknown { return this.base.page.querySelector(sel); }
    get page(): FakeElement { return this.base.page; }
}

let doc: LockDoc;
let pending: (() => void)[];
const target = {
    requestPointerLock(): Promise<void> {
        return new Promise<void>((res) => pending.push(() => { doc.pointerLockElement = target; doc.fire(); res(); }));
    }
};
/** The browser grants the lock asked for. */
const land = async (): Promise<void> => { const p = pending.splice(0); for (const g of p) g(); await new Promise((r) => setTimeout(r, 0)); };
const panel = (): FakeElement => { const el = new FakeElement('div'); el.setAttribute('class', 'panel interactive feedback'); doc.page.append(el); return el; };

beforeAll(async () => {
    vi.stubGlobal('Element', class { requestPointerLock(): void { /* the browser has pointer lock */ } });
    M = await import('../../../apps/fly/src/play/mouse-look');
});

beforeEach(() => {
    doc = new LockDoc();
    pending = [];
    vi.stubGlobal('document', doc);
});

function rig(held?: () => boolean): { look: InstanceType<Mod['MouseLook']>; lost: number[] } {
    const lost: number[] = [];
    const look = new M.MouseLook({ target: target as unknown as HTMLElement, onMove: () => {}, onLost: () => lost.push(1), held: held ?? (() => doc.page.querySelector('.panel') !== null) });
    return { look, lost };
}

describe('a window that needs the mouse gets the mouse', () => {
    it('a lock asked for before the window opened is let go when it lands, quietly', async () => {
        const { look, lost } = rig();
        expect(look.supported).toBe(true);
        const asked = look.lock(); // the Controls screen closed: the flight asks inside the click
        panel(); // the report form opens in the same click
        await land();
        expect(doc.pointerLockElement).toBeNull();
        expect(look.locked).toBe(false);
        expect(await asked).toBe(false);
        expect(lost).toHaveLength(0); // no pause menu over the form
    });

    it('a click inside the window does not take the capture back', async () => {
        const { look, lost } = rig();
        panel();
        const asked = look.lock();
        await land();
        expect(doc.pointerLockElement).toBeNull();
        expect(await asked).toBe(false);
        expect(lost).toHaveLength(0);
    });

    it('sync() lets a held lock go when a window opened, quietly', async () => {
        const { look, lost } = rig();
        const asked = look.lock();
        await land();
        expect(await asked).toBe(true);
        panel();
        look.sync();
        expect(doc.pointerLockElement).toBeNull();
        expect(lost).toHaveLength(0);
    });

    it('after the window closed a click captures again, and Esc still pauses', async () => {
        const { look, lost } = rig();
        const p = panel();
        void look.lock();
        await land();
        expect(look.locked).toBe(false);
        p.remove();
        const asked = look.lock();
        await land();
        expect(await asked).toBe(true);
        expect(doc.pointerLockElement).toBe(target);
        // the browser's own release (Esc): the flight is told
        doc.pointerLockElement = null;
        doc.fire();
        expect(lost).toHaveLength(1);
    });

    it('without a held() of its own the windows of the page decide', async () => {
        const lost: number[] = [];
        const look = new M.MouseLook({ target: target as unknown as HTMLElement, onMove: () => {}, onLost: () => lost.push(1) });
        expect(M.cursorWindowOpen?.(doc)).toBe(false);
        panel();
        expect(M.cursorWindowOpen?.(doc)).toBe(true);
        const asked = look.lock();
        await land();
        expect(await asked).toBe(false);
        expect(doc.pointerLockElement).toBeNull();
        const radio = new FakeElement('div');
        radio.setAttribute('class', 'screen radio interactive');
        const page2 = new LockDoc();
        page2.page.append(radio);
        expect(M.cursorWindowOpen?.(page2)).toBe(true);
    });
});

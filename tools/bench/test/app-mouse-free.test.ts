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
    /** a browser lets go later, as Chrome does: exits wait for leave() */
    asyncExit = false;
    exits: (() => void)[] = [];
    exitPointerLock(): void {
        const go = (): void => { if (this.pointerLockElement === null) return; this.pointerLockElement = null; this.fire(); };
        if (this.asyncExit) this.exits.push(go); else go();
    }
    leave(): void { for (const g of this.exits.splice(0)) g(); }
    querySelector(sel: string): unknown { return this.base.page.querySelector(sel); }
    get page(): FakeElement { return this.base.page; }
}

let doc: LockDoc;
let pending: (() => void)[];
/** the browser resolves the request before it fires 'pointerlockchange' (the other order of events) */
let eventLate = false;
const target = {
    requestPointerLock(): Promise<void> {
        return new Promise<void>((res) => pending.push(() => {
            doc.pointerLockElement = target;
            if (eventLate) { res(); setTimeout(() => doc.fire(), 0); } else { doc.fire(); res(); }
        }));
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
    eventLate = false;
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

    // review MF-R4: a click on the view between our unlock() and the browser's exit must not be answered
    // "locked" (the exit lands a moment later and nobody is told: a flight without the mouse, no pill)
    it('a release still on its way is not a lock: the click is refused and the next one captures', async () => {
        const { look, lost } = rig();
        doc.asyncExit = true;
        const p = panel();
        void look.lock(); // a click inside the window: the lock lands and is let go, the exit not yet done
        await land();
        expect(doc.pointerLockElement).toBe(target); // the browser has not let go yet
        p.remove(); // the window closes
        const early = look.lock(); // the pilot clicks the view before the exit landed
        expect(await early).toBe(false);
        doc.leave(); // the exit lands
        expect(look.locked).toBe(false);
        expect(lost).toHaveLength(0);
        const again = look.lock(); // the next click
        await land();
        expect(await again).toBe(true);
        expect(doc.pointerLockElement).toBe(target);
    });

    // found by the probe after the MF-R4 fix: when the lock's event comes after its promise, lock() lets the
    // lock go before onChange saw it land, so no event cleared `releasing`; every later click was refused
    it('a lock let go before its own event was seen leaves no release hanging', async () => {
        const { look, lost } = rig();
        eventLate = true;
        const p = panel();
        const first = look.lock(); // a click inside the window
        await land();
        await new Promise((r) => setTimeout(r, 0)); // the late event
        expect(await first).toBe(false);
        expect(doc.pointerLockElement).toBeNull();
        p.remove();
        const again = look.lock(); // the window closed: a click on the view
        await land();
        await new Promise((r) => setTimeout(r, 0));
        expect(await again).toBe(true);
        expect(doc.pointerLockElement).toBe(target);
        expect(lost).toHaveLength(0);
    });

    // review MF-R1: the video export bar (builtin/video-export.ts, Cancel, Retry, Close) needs the mouse
    it('the video export bar holds the mouse', () => {
        const bar = new FakeElement('div');
        bar.setAttribute('class', 'vx-bar interactive');
        const page = new LockDoc();
        page.page.append(bar);
        expect(M.cursorWindowOpen?.(page)).toBe(true);
    });

    // review MF-R3: the survey (sonic-session/survey-view.ts, aria-modal, hidden) and the Fly by Sound start
    // screen stay in the page hidden; hidden they must not hold the mouse, shown they must. The fake DOM has no
    // ':not(...)', so the page here answers by the list of selectors a browser would match.
    it('a hidden survey or start screen does not hold the mouse, a shown one does', () => {
        const page = (...matches: string[]): Pick<ParentNode, 'querySelector'> =>
            ({ querySelector: (s: string) => (matches.includes(s) ? ({} as Element) : null) }) as Pick<ParentNode, 'querySelector'>;
        expect(M.cursorWindowOpen(page())).toBe(false);
        expect(M.cursorWindowOpen(page('[aria-modal="true"]', '[aria-modal]', '[hidden]'))).toBe(false);
        expect(M.cursorWindowOpen(page('.sonic-start', '[hidden]'))).toBe(false);
        expect(M.cursorWindowOpen(page('[aria-modal="true"]', '[aria-modal="true"]:not([hidden])'))).toBe(true);
        expect(M.cursorWindowOpen(page('.sonic-start', '.sonic-start:not([hidden])'))).toBe(true);
        // the settings root is a panel ('panel interactive settings', ui/settings/screen.ts), not '.screen.settings'
        expect(M.CURSOR_WINDOWS as readonly string[]).not.toContain('.screen.settings');
    });
});

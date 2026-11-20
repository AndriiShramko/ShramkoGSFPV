// The edit mode's top bar (lane editor3, stage E3, docs/wip/editor3.md "The design", Top bar): Add gate, Undo, Redo, Exit
// and one line that says what to do now (click a gate, click the place for a new one, or arm the controller to fly the
// course). The buttons run the same key rows as the keyboard (keys.ts); Add arms the next click on the scene. It needs
// the cursor, as the editor's window.
import { t } from '../../i18n';
import type { KeyPress } from './keys';
import { TOP_BUTTONS } from './bar-place';
import { LineHold } from './line-hold';
import type { MenuItem } from './seam';
import './parts/life.css';

/** int4: the narrowest the editor window may be beside the top bar on a small view (CSS px); with less room it starts
 * under the bar. The window's widest row (a course row's name and its buttons) still reads at 260 px. */
export const BESIDE_MIN = 260;

export interface TopBarHost {
    key(press: KeyPress): void;
    /** Add gate pressed: the next click on the scene puts a gate (pressed again: no more) */
    add(): void;
    /** lane edit4b (E5): Fly the course pressed (true), or Back to editing while flying (false) */
    fly(on: boolean): void;
    /** lane edit4b: the items of a top bar menu as they are now (the parts fill them through the editor seam) */
    menu(id: 'course'): readonly MenuItem[];
}

export class TopBar {
    readonly root: HTMLElement;
    private readonly line: HTMLElement;
    private readonly addBtn: HTMLButtonElement | null = null;
    private readonly flyBtn: HTMLButtonElement | null = null;
    private readonly courseBtn: HTMLButtonElement | null = null;
    private readonly host: TopBarHost;
    private isFlying = false;
    /** the open menu (one at a time) and its closing */
    private openMenu: { el: HTMLElement; close: () => void } | null = null;
    private readonly hold: LineHold;
    private isAdding = false;
    /** train 3 I2 (D6): the pilot's next key or press after a refusal clears it (a modifier alone or a held key's repeat is no action) */
    private readonly onAct = (e: Event): void => {
        if (e instanceof KeyboardEvent && (e.repeat || /^(Shift|Control|Alt|Meta)/.test(e.code))) return;
        this.hold.acted(e.timeStamp);
    };

    constructor(ui: HTMLElement, host: TopBarHost) {
        const root = document.createElement('div');
        root.className = 'ce-topbar interactive';
        root.setAttribute('role', 'toolbar');
        root.setAttribute('aria-label', t('course.edit.title'));
        for (const b of TOP_BUTTONS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ce-tb';
            btn.dataset.top = b.id;
            btn.textContent = t(b.labelKey);
            const press = b.press;
            btn.addEventListener('click', () => {
                btn.blur();
                if (press === 'add') host.add();
                else if (press === 'fly') host.fly(!this.isFlying);
                else if (press === 'course') this.toggleMenu();
                else host.key(press);
            });
            if (press === 'add') this.addBtn = btn;
            if (press === 'fly') this.flyBtn = btn;
            if (press === 'course') {
                this.courseBtn = btn;
                btn.setAttribute('aria-haspopup', 'menu');
                btn.setAttribute('aria-expanded', 'false');
            }
            root.append(btn);
        }
        const line = document.createElement('span');
        line.className = 'ce-tb-line';
        root.append(line);
        ui.append(root);
        this.root = root;
        this.host = host;
        this.line = line;
        this.hold = new LineHold((text, refused) => {
            this.setLine(text ?? t(this.isAdding ? 'course.edit.bar.addHint' : 'course.edit.flyHint'));
            this.line.classList.toggle('refused', refused);
        });
        window.addEventListener('keydown', this.onAct, true);
        // lane editfix E2: a press clears a held line when it is let go, not when it goes down: the line's new width moved
        // the centred buttons between down and up, and the second Exit press landed on the bar (E1 cause 2)
        window.addEventListener('pointerup', this.onAct, true);
        window.addEventListener('resize', this.place);
        this.ui = ui;
        if (typeof ResizeObserver !== 'undefined') this.watch = new ResizeObserver(() => this.place());
        this.adding(false);
        this.place();
        requestAnimationFrame(() => this.place());
    }

    private readonly ui: HTMLElement;
    private readonly watch: ResizeObserver | null = null;
    private watched: Element[] = [];
    /** train 3 I2 (D7): on a view lower than 500 px the bar goes under the scene credit and the Walls chip's summary, so it
     * covers neither: their lowest bottom edge (page px) is written to --ce-below, used by editor.css (max-height: 500px) */
    private readonly place = (): void => {
        // int4: the bar itself is watched too (its width follows the language and Fly / Back to editing)
        const parts = [...this.ui.querySelectorAll('.attribution, [data-testid="walls-box"]'), this.root];
        if (this.watch && (parts.length !== this.watched.length || parts.some((p, i) => p !== this.watched[i]))) {
            this.watch.disconnect();
            for (const p of parts) this.watch.observe(p);
            this.watched = parts;
        }
        let below = 0;
        for (const p of parts) {
            // the bar is watched for its size only: its own bottom must not push it down (it walked to mid-view at 844x390)
            if (p === this.root) continue;
            const r = p.getBoundingClientRect();
            if (r.height > 0 && r.top < window.innerHeight / 2) below = Math.max(below, r.bottom);
        }
        this.root.style.setProperty('--ce-below', `${Math.round(below + 4)}px`);
        // int4 (the seam of edit4b's longer bar and the window, found by edit4a's 844x390 step): on a view narrower than 900 px
        // or lower than 500 px the bar reaches past the window's left edge. The window stays at the top right, narrowed to the
        // room right of the bar (--ce-beside); only when less than BESIDE_MIN is left does it start under the bar
        // (--ce-topbar-bottom). Under the bar always (30ae9183) put the window over the view's middle, where the gates of a
        // framed course lie, and over edit4c's Add list when the Walls chip had pushed the bar down (int4 S2, 844x390).
        const bar = this.root.getBoundingClientRect();
        const room = Math.floor(window.innerWidth - bar.right - 16);
        if (bar.height > 0 && room < BESIDE_MIN) {
            this.ui.style.setProperty('--ce-topbar-bottom', `${Math.round(bar.bottom)}px`);
            this.ui.style.removeProperty('--ce-beside');
        } else {
            this.ui.style.removeProperty('--ce-topbar-bottom');
            if (bar.height > 0) this.ui.style.setProperty('--ce-beside', `${room}px`);
            else this.ui.style.removeProperty('--ce-beside');
        }
    };

    /** D6: one line, at most 420 px with an ellipsis (editor.css); the full text in its title */
    private setLine(text: string): void {
        this.line.textContent = text;
        this.line.title = text;
    }

    /** Add gate is armed: the button stays pressed and the line says where to click */
    adding(on: boolean): void {
        this.isAdding = on;
        this.addBtn?.setAttribute('aria-pressed', on ? 'true' : 'false');
        this.hold.reset();
        this.line.classList.remove('refused');
        this.setLine(t(on ? 'course.edit.bar.addHint' : 'course.edit.flyHint'));
    }

    /** lane editor3 H1: the window opens closed, so what an edit did (or why it did not) is said on the bar's line for a while */
    tell(text: string, refused: boolean): void {
        // I2 (D6): a refusal stays until the pilot's next action (line-hold.ts), what an edit did for DONE_MS
        this.hold.tell(text, refused, performance.now());
    }

    /** whether the Course menu is open (the editor's keys wait while it is: keys.ts KeyAt.overlay) */
    menuOpen(): boolean {
        return this.openMenu !== null;
    }

    /** lane edit4b: the Course menu under its button, its own 44 px cross; Esc, the cross, a click outside or an item close it */
    toggleMenu(): void {
        if (this.openMenu) return this.openMenu.close();
        const btn = this.courseBtn;
        if (!btn) return;
        const el = document.createElement('div');
        el.className = 'ce-menu interactive';
        el.setAttribute('role', 'menu');
        el.dataset.menu = 'course';
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'ce-menu-x';
        x.dataset.item = 'close';
        x.setAttribute('aria-label', t('course.life.ask.close'));
        x.textContent = '×';
        el.append(x);
        for (const it of this.host.menu('course')) {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'menuitem');
            b.dataset.item = it.id;
            b.textContent = t(it.labelKey);
            b.addEventListener('click', () => { close(); it.run(); });
            el.append(b);
        }
        const onKey = (e: KeyboardEvent): void => {
            if (e.code !== 'Escape') return;
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        };
        const onDown = (e: PointerEvent): void => {
            if (!(e.target instanceof Node) || el.contains(e.target) || btn.contains(e.target)) return;
            close();
        };
        const close = (): void => {
            if (this.openMenu?.el !== el) return;
            this.openMenu = null;
            el.remove();
            btn.setAttribute('aria-expanded', 'false');
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('pointerdown', onDown, true);
        };
        x.addEventListener('click', close);
        this.openMenu = { el, close };
        btn.setAttribute('aria-expanded', 'true');
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('pointerdown', onDown, true);
        this.ui.append(el);
        // under the button, inside the view (1366x768 and 844x390 alike)
        const r = btn.getBoundingClientRect();
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        el.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8)))}px`;
        el.style.top = `${Math.round(Math.max(8, Math.min(r.bottom + 4, window.innerHeight - h - 8)))}px`;
        (el.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
    }

    /** the drone flies: the bar steps aside but for Back to editing and Exit (the line says how to come back) */
    flying(on: boolean): void {
        this.isFlying = on;
        this.openMenu?.close();
        if (this.flyBtn) this.flyBtn.textContent = t(on ? 'course.edit.bar.back' : 'course.edit.bar.fly');
        this.root.classList.toggle('flying', on);
        this.place();
        this.hold.reset();
        this.line.classList.remove('refused');
        this.setLine(t(on ? 'course.edit.flying' : 'course.edit.flyHint'));
    }

    destroy(): void {
        this.openMenu?.close();
        this.hold.stop();
        window.removeEventListener('keydown', this.onAct, true);
        window.removeEventListener('pointerup', this.onAct, true);
        window.removeEventListener('resize', this.place);
        this.watch?.disconnect();
        this.ui.style.removeProperty('--ce-topbar-bottom');
        this.ui.style.removeProperty('--ce-beside');
        this.root.remove();
    }
}

// The edit mode's top bar (lane editor3, stage E3, docs/wip/editor3.md "The design", Top bar): Add gate, Undo, Redo, Exit
// and one line that says what to do now (click a gate, click the place for a new one, or arm the controller to fly the
// course). The buttons run the same key rows as the keyboard (keys.ts); Add arms the next click on the scene. It needs
// the cursor, as the editor's window.
import { t } from '../../i18n';
import type { KeyPress } from './keys';
import { TOP_BUTTONS } from './bar-place';
import { LineHold } from './line-hold';

export interface TopBarHost {
    key(press: KeyPress): void;
    /** Add gate pressed: the next click on the scene puts a gate (pressed again: no more) */
    add(): void;
    /** review ED-7: Courses or Keys pressed: the window opens (a phone's drawer too) at that part */
    show(part: 'courses' | 'keys'): void;
}

export class TopBar {
    readonly root: HTMLElement;
    private readonly line: HTMLElement;
    private readonly addBtn: HTMLButtonElement | null = null;
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
                else if (press === 'courses' || press === 'keys') host.show(press);
                else host.key(press);
            });
            if (press === 'add') this.addBtn = btn;
            root.append(btn);
        }
        const line = document.createElement('span');
        line.className = 'ce-tb-line';
        root.append(line);
        ui.append(root);
        this.root = root;
        this.line = line;
        this.hold = new LineHold((text, refused) => {
            this.setLine(text ?? t(this.isAdding ? 'course.edit.bar.addHint' : 'course.edit.flyHint'));
            this.line.classList.toggle('refused', refused);
        });
        window.addEventListener('keydown', this.onAct, true);
        window.addEventListener('pointerdown', this.onAct, true);
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
        const parts = [...this.ui.querySelectorAll('.attribution, [data-testid="walls-box"]')];
        if (this.watch && (parts.length !== this.watched.length || parts.some((p, i) => p !== this.watched[i]))) {
            this.watch.disconnect();
            for (const p of parts) this.watch.observe(p);
            this.watched = parts;
        }
        let below = 0;
        for (const p of parts) {
            const r = p.getBoundingClientRect();
            if (r.height > 0 && r.top < window.innerHeight / 2) below = Math.max(below, r.bottom);
        }
        this.root.style.setProperty('--ce-below', `${Math.round(below + 4)}px`);
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

    /** the drone flies: the bar steps aside (the line stays, it says how to come back) */
    flying(on: boolean): void {
        this.root.classList.toggle('flying', on);
        this.place();
        this.hold.reset();
        this.line.classList.remove('refused');
        this.setLine(t(on ? 'course.edit.flying' : 'course.edit.flyHint'));
    }

    destroy(): void {
        this.hold.stop();
        window.removeEventListener('keydown', this.onAct, true);
        window.removeEventListener('pointerdown', this.onAct, true);
        window.removeEventListener('resize', this.place);
        this.watch?.disconnect();
        this.root.remove();
    }
}

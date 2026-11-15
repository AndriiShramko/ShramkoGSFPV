// The edit mode's top bar (lane editor3, stage E3, docs/wip/editor3.md "The design", Top bar): Add gate, Undo, Redo, Exit
// and one line that says what to do now (click a gate, click the place for a new one, or arm the controller to fly the
// course). The buttons run the same key rows as the keyboard (keys.ts); Add arms the next click on the scene. It needs
// the cursor, as the editor's window.
import { t } from '../../i18n';
import type { KeyPress } from './keys';
import { TOP_BUTTONS } from './bar-place';

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
    private told = 0;
    private isAdding = false;

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
        this.adding(false);
    }

    /** Add gate is armed: the button stays pressed and the line says where to click */
    adding(on: boolean): void {
        this.isAdding = on;
        this.addBtn?.setAttribute('aria-pressed', on ? 'true' : 'false');
        this.line.textContent = t(on ? 'course.edit.bar.addHint' : 'course.edit.flyHint');
    }

    /** lane editor3 H1: the window opens closed, so what an edit did (or why it did not) is said on the bar's line for a while */
    tell(text: string, refused: boolean): void {
        clearTimeout(this.told);
        this.line.textContent = text;
        this.line.classList.toggle('refused', refused);
        this.told = window.setTimeout(() => {
            this.line.classList.remove('refused');
            this.line.textContent = t(this.isAdding ? 'course.edit.bar.addHint' : 'course.edit.flyHint');
        }, refused ? 6000 : 3000);
    }

    /** the drone flies: the bar steps aside (the line stays, it says how to come back) */
    flying(on: boolean): void {
        this.root.classList.toggle('flying', on);
        this.line.textContent = t(on ? 'course.edit.flying' : 'course.edit.flyHint');
    }

    destroy(): void {
        clearTimeout(this.told);
        this.root.remove();
    }
}

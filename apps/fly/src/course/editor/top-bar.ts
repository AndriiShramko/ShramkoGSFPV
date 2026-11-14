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
}

export class TopBar {
    readonly root: HTMLElement;
    private readonly line: HTMLElement;
    private readonly addBtn: HTMLButtonElement | null = null;

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
        this.addBtn?.setAttribute('aria-pressed', on ? 'true' : 'false');
        this.line.textContent = t(on ? 'course.edit.bar.addHint' : 'course.edit.flyHint');
    }

    /** the drone flies: the bar steps aside (the line stays, it says how to come back) */
    flying(on: boolean): void {
        this.root.classList.toggle('flying', on);
        this.line.textContent = t(on ? 'course.edit.flying' : 'course.edit.flyHint');
    }

    destroy(): void {
        this.root.remove();
    }
}

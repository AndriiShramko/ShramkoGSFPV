// The small bar next to the selected gate (lane editor3, stage E2.4, docs/wip/editor3.md "The design"). The owner's words of
// message 51: "Clicked it and a menu can appear where it can be changed to another kind of obstacle. Then by a click or a key
// go to the next obstacle." Its buttons run the same key rows as the keyboard (keys.ts), so a click and a key do one thing.
// It follows the gate on the screen; it needs the cursor, as the editor's window ('.course-editor' in CURSOR_WINDOWS).
import { t } from '../../i18n';
import type { KeyPress } from './keys';
import { BAR_BUTTONS, barPlace } from './bar-place';

export interface GateBarHost {
    key(press: KeyPress): void;
    /** the selected gate on the canvas, CSS px of the page, and whether it is in front of the camera; null: none */
    where(): readonly [number, number, number] | null;
}

const SVG = 'http://www.w3.org/2000/svg';

export class GateBar {
    readonly root: HTMLElement;
    private frame = 0;
    private hidden = false;

    constructor(ui: HTMLElement, private readonly host: GateBarHost) {
        const root = document.createElement('div');
        root.className = 'ce-gatebar interactive';
        root.setAttribute('role', 'toolbar');
        root.setAttribute('aria-label', t('course.edit.keys'));
        for (const b of BAR_BUTTONS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ce-gb';
            btn.dataset.bar = b.id;
            const label = t(b.labelKey);
            btn.title = label;
            btn.setAttribute('aria-label', label);
            const svg = document.createElementNS(SVG, 'svg');
            svg.setAttribute('viewBox', '0 0 20 20');
            svg.setAttribute('aria-hidden', 'true');
            const p = document.createElementNS(SVG, 'path');
            p.setAttribute('d', b.path);
            svg.append(p);
            btn.append(svg);
            // the press runs the key and gives the focus back, so Tab and the camera keys go on working at once
            btn.addEventListener('click', () => {
                btn.blur();
                host.key(b.press);
            });
            root.append(btn);
        }
        ui.append(root);
        this.root = root;
        this.tick();
    }

    /** a handle drag hides the bar (it would cover the gate being moved) */
    hide(on: boolean): void {
        this.hidden = on;
    }

    private tick = (): void => {
        const at = this.hidden ? null : this.host.where();
        const pos = barPlace(at, window.innerWidth, window.innerHeight, this.root.offsetWidth || 300, this.root.offsetHeight || 36);
        if (!pos) this.root.style.visibility = 'hidden';
        else {
            this.root.style.visibility = 'visible';
            this.root.style.transform = `translate(${pos[0]}px, ${pos[1]}px)`;
        }
        this.frame = requestAnimationFrame(this.tick);
    };

    destroy(): void {
        cancelAnimationFrame(this.frame);
        this.root.remove();
    }
}

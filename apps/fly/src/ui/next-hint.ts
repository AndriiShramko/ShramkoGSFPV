// The crash hint's widget (v0.9 item 11; the rules are app/next-hint-logic.ts, the feature builtin/next-hint.ts):
// one calm line, "Want another place? Press N for the next scene", with a Next scene button when there is no
// key to press (touch) and a close button. Non-blocking: the box itself takes no click (it never sits between
// the pilot's thumb and a control); only its buttons do. It sits at the top, away from the crash toast and the
// crash panel with their replay and respawn buttons (ui/crash-overlay.ts), and is never over them.
import { h } from './dom';
import { t } from '../i18n';
import './next-hint.css';

export interface NextHintOptions {
    text: string;
    /** a button that goes to the next scene (touch: there is no N to press); null: none */
    button: { label: string; run: () => void } | null;
    onClose: () => void;
}

export class NextHint {
    readonly root: HTMLDivElement;

    constructor(parent: HTMLElement, o: NextHintOptions) {
        const close = t('common.close');
        this.root = h('div', { class: 'next-hint', role: 'status', 'data-testid': 'next-hint' },
            h('span', { class: 'nh-text' }, o.text),
            o.button ? h('button', { type: 'button', class: 'btn primary nh-btn', 'data-action': 'hint-next-scene', onclick: () => o.button!.run() }, o.button.label) : null,
            h('button', { type: 'button', class: 'nh-x', 'data-action': 'hint-close', 'aria-label': close, title: close, onclick: () => o.onClose() }, '×')
        );
        parent.append(this.root);
    }

    remove(): void {
        this.root.remove();
    }
}

// The panel shown after a crash: back to the start, back to a safe point, replay the crash, save the log.
import { h } from './dom';
import { t } from '../i18n';
import type { CrashInfo } from '../crashview';

export class CrashOverlay {
    readonly root: HTMLDivElement;
    onRespawn: (() => void) | null = null;
    onSafe: (() => void) | null = null;
    onReplay: (() => void) | null = null;
    onSave: (() => void) | null = null;

    constructor(parent: HTMLElement, info: CrashInfo, speedText: string) {
        this.root = h('div', { class: 'crash-overlay interactive', role: 'dialog', 'aria-label': t('crash.title', { speed: speedText }) },
            h('h2', {}, t('crash.title', { speed: speedText })),
            h('p', { class: 'muted small', 'data-engine': info.engine, 'data-debris': String(info.debris) }, `${info.engine === 'rapier' ? `Rapier · ${info.debris} debris` : 'sim-core tumble'}`),
            h('div', { class: 'actions' },
                h('button', { type: 'button', class: 'btn primary', 'data-action': 'respawn', onclick: () => this.onRespawn?.() }, t('crash.respawn')),
                h('button', { type: 'button', class: 'btn', 'data-action': 'safe', onclick: () => this.onSafe?.() }, t('crash.safe')),
                h('button', { type: 'button', class: 'btn', 'data-action': 'replay', onclick: () => this.onReplay?.() }, t('crash.replay')),
                h('button', { type: 'button', class: 'btn', 'data-action': 'save', onclick: () => this.onSave?.() }, t('crash.save'))
            )
        );
        parent.append(this.root);
    }

    remove(): void {
        this.root.remove();
    }
}

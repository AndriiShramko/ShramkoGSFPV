// The crash panel (split from ui/flight.ts, v0.3 wave 1): the impact speed, which engine played the
// wreck, and Respawn / Safe point / Replay / Save. app/builtin/crash.ts shows it and wires the buttons.
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

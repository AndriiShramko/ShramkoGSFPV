// What a crash shows (docs/architecture-v03.md C.10, items 23, 3, 7):
// - CrashToast: automatic respawn on. Bottom centre, "Crash 6.2 m/s · back 5 s in 1.4 s" with a
//   countdown bar and key-caps (Enter stays and opens the panel, R goes to the start). Nothing to
//   click: the drone comes back by itself.
// - CrashPanel: automatic respawn off, or Enter. The life's numbers and the actions: Rewind (Y),
//   Back to start (R), Replay, Save log, Settings (O). data-action values: respawn (B12 clicks it),
//   rewind, replay, save, settings.
// - RewindLabel: after a rewind a small "-5 s" at the top centre for 1.5 s. It fades, never flashes
//   (WCAG 2.3.1).
// app/builtin/crash.ts shows them and wires the actions.
import type { KeyHint } from '@gsfpv/prefs';
import { h } from './dom';
import { t } from '../i18n';
import type { CrashInfo } from '../crashview';
import './crash.css';

function caps(keys: readonly KeyHint[]): HTMLElement | null {
    return keys.length ? h('span', { class: 'ck-keys', 'aria-hidden': 'true' }, ...keys.map((k) => h('kbd', {}, k.cap))) : null;
}

const aria = (keys: readonly KeyHint[]): string | undefined => (keys.length ? keys.map((k) => k.aria).join(' ') : undefined);

/** The toast's key hints: a key-cap and a short word, never a button to click. */
export interface ToastKeys { keep: readonly KeyHint[]; start: readonly KeyHint[] }

export class CrashToast {
    readonly root: HTMLDivElement;
    private readonly text: HTMLSpanElement;
    private readonly bar: HTMLElement;
    private readonly speedText: string;
    private readonly back: number;
    private readonly toStart: boolean;

    constructor(parent: HTMLElement, speedText: string, o: { backS: number; target: 'rewind' | 'start'; keys: ToastKeys }) {
        this.speedText = speedText;
        this.back = o.backS;
        this.toStart = o.target === 'start';
        this.text = h('span', { class: 'ct-text', 'aria-hidden': 'true' });
        this.bar = h('i', {});
        const hint = (keys: readonly KeyHint[], label: string): HTMLElement | null => (keys.length ? h('span', { class: 'ct-key' }, caps(keys), h('span', {}, label)) : null);
        this.root = h('div', { class: 'crash-toast', role: 'status', 'data-testid': 'crash-toast' },
            // read once by a screen reader: the countdown itself changes every frame and is hidden from it
            h('span', { class: 'visually-hidden' }, t('respawn.toast.sr', { speed: speedText })),
            this.text,
            h('span', { class: 'ct-bar', 'aria-hidden': 'true' }, this.bar),
            h('span', { class: 'ct-keys' }, hint(o.keys.keep, t('respawn.keep')), hint(o.keys.start, t('respawn.start')))
        );
        parent.append(this.root);
    }

    /** remaining: seconds to the respawn; total: the whole delay. */
    update(remainingS: number, totalS: number): void {
        const s = Math.max(0, remainingS);
        const txt = this.toStart
            ? t('respawn.toast.start', { speed: this.speedText, in: s.toFixed(1) })
            : t('respawn.toast', { speed: this.speedText, back: String(this.back), in: s.toFixed(1) });
        if (this.text.textContent !== txt) this.text.textContent = txt;
        const f = totalS > 0 ? Math.min(1, s / totalS) : 0;
        this.bar.style.transform = `scaleX(${f.toFixed(3)})`;
    }

    remove(): void {
        this.root.remove();
    }
}

/** The panel's buttons; null hides one (Settings when the page has no settings item). */
export interface PanelActions {
    rewind: { run: () => void; keys: readonly KeyHint[]; backS: number };
    start: { run: () => void; keys: readonly KeyHint[] };
    replay: () => void;
    save: () => void;
    settings: { run: () => void; keys: readonly KeyHint[] } | null;
}

/** The life's numbers on the panel (session.stats.life()). */
export interface PanelStats { timeS: number; distM: number; topSpeed: number }

export class CrashPanel {
    readonly root: HTMLDivElement;

    constructor(parent: HTMLElement, info: CrashInfo, speedText: string, stats: PanelStats, a: PanelActions) {
        const btn = (action: string, label: string, run: () => void, keys: readonly KeyHint[] = [], primary = false): HTMLButtonElement =>
            h('button', { type: 'button', class: primary ? 'btn primary' : 'btn', 'data-action': action, 'aria-keyshortcuts': aria(keys), onclick: () => run() }, h('span', {}, label), caps(keys));
        const title = t('crash.title', { speed: speedText });
        this.root = h('div', { class: 'crash-overlay interactive', role: 'dialog', 'aria-label': title, 'data-testid': 'crash-panel' },
            h('h2', {}, title),
            h('p', { class: 'muted small cp-stats', 'data-testid': 'crash-stats' }, t('respawn.panel.stats', { time: stats.timeS.toFixed(1), dist: stats.distM.toFixed(0), speed: stats.topSpeed.toFixed(1) })),
            h('p', { class: 'muted small', 'data-engine': info.engine, 'data-debris': String(info.debris) }, `${info.engine === 'rapier' ? `Rapier · ${info.debris} debris` : 'sim-core tumble'}`),
            h('div', { class: 'actions' },
                btn('rewind', t('respawn.rewind', { s: String(a.rewind.backS) }), a.rewind.run, a.rewind.keys, true),
                btn('respawn', t('respawn.start'), a.start.run, a.start.keys),
                btn('replay', t('crash.replay'), a.replay),
                btn('save', t('crash.save'), a.save),
                a.settings ? btn('settings', t('pause.settings'), a.settings.run, a.settings.keys) : null
            )
        );
        parent.append(this.root);
    }

    remove(): void {
        this.root.remove();
    }
}

/** "-5 s" for 1.5 s after a rewind (CSS fades it out; no colour change, no flashing). */
export function rewindLabel(parent: HTMLElement, text: string, ms = 1500): () => void {
    parent.querySelector('.rewind-label')?.remove();
    const el = h('div', { class: 'rewind-label', role: 'status', 'data-testid': 'rewind-label' }, text);
    el.style.setProperty('--label-ms', `${ms}ms`);
    parent.append(el);
    const id = window.setTimeout(() => el.remove(), ms);
    return () => { clearTimeout(id); el.remove(); };
}

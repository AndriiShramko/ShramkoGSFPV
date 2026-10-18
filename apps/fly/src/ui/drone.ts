// Drone picker: preset cards; every number shows where it comes from (manufacturer / measured /
// estimate / Betaflight default). Also draws the rate curve of the preset. Each drone keeps its own
// settings (W2-1, D-c): a card says how many of them the pilot changed for that drone.
// The hover throttle on a card is a full pack and near empty, as the HUD shows THR (ui/drone-card.ts).
// v0.8 (docs/wip/v08-d.md): "help us tune this drone": a line on top, "Help tune it" on every card and
// "Ask for another drone"; they call onTune (the feedback dialog's Drone physics kind) when it is set.
import { compileParams, setpointRate } from '@gsfpv/sim-core';
import type { PresetJson } from '@gsfpv/sim-core';
import { loadedNumbers, PAYLOADS } from '../drones3d/payloads';
import type { PayloadId } from '../drones3d/payloads';
import type { PrefsStore } from '@gsfpv/prefs';
import { PRESETS, DEFAULT_PRESET } from '../presets';
import { h } from './dom';
import { cardHover } from './drone-card';
import { t } from '../i18n';
import type { Stage } from '../drones3d';
import './drone-tune.css';

function srcLabel(src: string): string {
    if (src === 'manufacturer') return t('common.manufacturer');
    if (src === 'estimate') return t('common.estimate');
    if (src === 'bf-default') return t('common.bfDefault');
    if (src.startsWith('measured:')) return `${t('common.measured')} (${src.slice(9)})`;
    return src;
}

function row(p: PresetJson, key: string, label: string, render: (v: unknown) => string): HTMLElement | null {
    const f = p.fields[key];
    if (!f) return null;
    return h('div', { class: 'spec-row', 'data-spec': key }, h('span', { class: 'spec-k' }, label), h('span', { class: 'spec-v' }, render(f.value)), h('span', { class: `src src-${f.source.split(':')[0]}`, title: f.ref ?? '' }, srcLabel(f.source)));
}

function curve(p: PresetJson): HTMLCanvasElement {
    const c = h('canvas', { width: 220, height: 110, class: 'rate-curve', role: 'img', 'aria-label': 'rate curve' }) as HTMLCanvasElement;
    const sp = compileParams(p);
    const g = c.getContext('2d');
    if (!g) return c;
    const max = setpointRate(sp.rates.type, 1, sp.rates.roll, sp.rates.rateLimit);
    g.strokeStyle = '#2a3340';
    g.strokeRect(0.5, 0.5, 219, 109);
    g.strokeStyle = '#4ade80';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 100; i++) {
        const x = i / 100;
        const y = setpointRate(sp.rates.type, x, sp.rates.roll, sp.rates.rateLimit) / Math.max(1, max);
        const px = 4 + x * 212, py = 106 - y * 100;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
    g.fillStyle = '#9aa3ad';
    g.font = '11px ui-monospace, monospace';
    g.fillText(`${sp.rates.type} ${Math.round(max)} °/s`, 8, 14);
    return c;
}

/** The camera load the host keeps for a drone (the drone.payload setting): read for the cards and the stage, written when the player picks another. */
export interface PayloadHooks {
    get(drone: string): PayloadId;
    set(drone: string, id: PayloadId): void;
}

export class DronePicker {
    readonly root: HTMLDivElement;
    onPick: ((id: string) => void) | null = null;
    /** Leave with nothing changed: keep the drone and fly on (the same path as Esc in main.ts). */
    onClose: (() => void) | null = null;
    /**
     * "Help tune it" on a card (that preset's id) or "Ask for another drone" ('new'): the drone feedback.
     * Read when a button is pressed, so the owner may set it after construction; without it the buttons
     * are not drawn (o.tune false).
     */
    onTune: ((id: string) => void) | null = null;
    private readonly current: string;
    /** v0.9 lane D: the cinelifter's camera load, read and written by the host (the drone.payload setting) */
    private readonly payload: PayloadHooks | null;
    /** the drone on the 3D stage (the one in use at first) */
    private stageDrone: string;
    /** v0.9: the 3D stage over the cards (drones3d, a lazy chunk); null until it has loaded, and after the picker closes */
    private stage: Stage | null = null;
    private gone = false;
    private readonly stageSlot: HTMLElement;

    /** the pilot's Reduced motion setting for the 3D stage (asked every frame) */
    private readonly reducedMotion: (() => boolean) | undefined;

    /** `store`: the page's settings, for the per-drone count on each card; `tune`: draw the help-us-tune buttons; `reducedMotion`: the pilot's setting, for the 3D stage */
    constructor(parent: HTMLElement, current: string, o: { store?: PrefsStore; tune?: boolean; payload?: PayloadHooks; reducedMotion?: () => boolean } = {}) {
        this.current = current;
        this.reducedMotion = o.reducedMotion;
        this.payload = o.payload ?? null;
        this.stageDrone = current;
        const changed = (id: string): number => o.store?.explicitList({ drone: id }).filter((e) => e.scope === 'drone').length ?? 0;
        const cards = h('div', { class: 'drone-grid' });
        this.stageSlot = h('div', { class: 'd3-slot', 'data-testid': 'drone-stage-slot' });
        let keep: HTMLButtonElement | null = null;
        for (const [id, p] of Object.entries(PRESETS)) {
            const hover = cardHover(compileParams(p, this.overridesOf(id)));
            const isCur = id === current;
            // the drone in use says so, and its button leaves without rebuilding the flight model
            const btn = isCur
                ? h('button', { type: 'button', class: 'btn primary', 'data-action': 'drone-keep', onclick: () => this.close() }, t('drone.keep'))
                : h('button', { type: 'button', class: 'btn', 'data-action': 'drone-pick', onclick: () => this.onPick?.(id) }, t('common.fly'));
            if (isCur) keep = btn;
            const card = h('div', { class: `drone-card ${isCur ? 'selected' : ''}`, 'data-preset': id },
                h('h3', {}, p.name, id === DEFAULT_PRESET ? h('span', { class: 'pill' }, t('drone.default')) : null),
                h('p', { class: 'muted' }, p.class),
                row(p, 'twr', t('drone.twr'), () => `${this.loaded(id).twr}:1`),
                row(p, 'auw_g', t('drone.weight'), () => `${this.loaded(id).weight} g`),
                this.loadLine(id),
                row(p, 'wheelbase_mm', t('drone.wheelbase'), (v) => `${v} mm`),
                row(p, 'motor', t('drone.motor'), (v) => String(v)),
                row(p, 'battery', t('drone.battery'), (v) => String(v)),
                curve(p),
                hover ? h('p', { class: 'muted small', 'data-testid': 'drone-hover' }, t('drone.hover', { full: String(hover.full), low: String(hover.low) })) : null,
                changed(id) ? h('p', { class: 'small ok', 'data-testid': 'drone-changed' }, t('prefs.droneChanged', { n: String(changed(id)) })) : null,
                h('div', { class: 'drone-actions' }, btn,
                    h('button', { type: 'button', class: 'btn', 'data-action': 'drone-view3d', onclick: () => this.view3d(id) }, t('d3.view3d')),
                    o.tune ? h('button', { type: 'button', class: 'btn', 'data-action': 'drone-tune', onclick: () => this.onTune?.(id) }, t('drone.tune.button')) : null)
            );
            cards.append(card);
        }
        const x = h('button', { type: 'button', class: 'panel-x', 'data-action': 'drone-close', 'aria-label': t('common.close'), 'aria-keyshortcuts': 'Escape', title: `${t('common.close')} (Esc)`, onclick: () => this.close() }, '×');
        // not modal: the top Controls and Pause buttons stay reachable above it (fly.css)
        this.root = h('div', { class: 'screen drones interactive', role: 'dialog', 'aria-labelledby': 'drone-title' },
            h('div', { class: 'drone-head' }, h('h1', { id: 'drone-title' }, t('drone.title')), x),
            h('p', { class: 'muted' }, t('drone.sourceNote')),
            o.tune ? h('div', { class: 'drone-tune', 'data-testid': 'drone-tune' }, h('p', {}, t('drone.tune.lead')),
                h('button', { type: 'button', class: 'btn', 'data-action': 'drone-ask', onclick: () => this.onTune?.('new') }, t('drone.tune.ask'))) : null,
            this.stageSlot, cards);
        parent.append(this.root);
        this.loadStage(current);
        // Enter keeps the drone in use; Tab reaches the others
        (keep ?? x).focus({ preventScroll: true });
    }

    /** The overrides a card's numbers are computed with: the cinelifter's camera load (nothing for a drone without one). */
    private overridesOf(id: string): { payloadG?: number } {
        const p = PRESETS[id];
        if (!this.payload || !p.fields.payload_g) return {};
        const choice = PAYLOADS[this.payload.get(id)];
        return choice ? { payloadG: choice.loadG } : {};
    }

    /** The thrust-to-weight and the all-up weight of a card, for the camera load the pilot has chosen (drones3d/payloads.ts loadedNumbers: the one rule of the stage and the cards). */
    private loaded(id: string): { weight: string; twr: string } {
        return loadedNumbers(PRESETS[id], this.payload && PRESETS[id].fields.payload_g ? this.payload.get(id) : null);
    }

    /** "Camera load: RED KOMODO 6K" under the cinelifter's numbers, so a card never shows a weight without saying what it carries. */
    private loadLine(id: string): HTMLElement | null {
        if (!this.payload || !PRESETS[id].fields.payload_g) return null;
        return h('p', { class: 'muted small', 'data-testid': 'drone-load' }, `${t('d3.payload.title')}: ${PAYLOADS[this.payload.get(id)]?.name ?? t('d3.f.none')}`);
    }

    /** The player picked another camera load on the stage: keep it, and bring the cinelifter's card up to date. */
    private payloadChosen(id: string, choice: PayloadId): void {
        this.payload?.set(id, choice);
        const card = this.root.querySelector(`.drone-card[data-preset="${id}"]`);
        if (!card) return;
        const p = PRESETS[id];
        const set = (spec: string, text: string): void => { const el = card.querySelector(`[data-spec="${spec}"] .spec-v`); if (el) el.textContent = text; };
        set('twr', `${this.loaded(id).twr}:1`);
        set('auw_g', `${this.loaded(id).weight} g`);
        const hv = cardHover(compileParams(p, this.overridesOf(id)));
        const hel = card.querySelector('[data-testid="drone-hover"]');
        if (hel && hv) hel.textContent = t('drone.hover', { full: String(hv.full), low: String(hv.low) });
        const load = card.querySelector('[data-testid="drone-load"]');
        if (load) load.textContent = `${t('d3.payload.title')}: ${PAYLOADS[choice]?.name ?? t('d3.f.none')}`;
    }

    /** The 3D stage is its own chunk: the cards are usable at once, the stage appears when it has loaded. */
    private loadStage(id: string): void {
        void import('../drones3d').then((m) => {
            if (this.gone) return;
            this.stage = m.mountStage(this.stageSlot, {
                presets: PRESETS, droneId: id, mode: 'full', payload: this.payload && PRESETS[id].fields.payload_g ? this.payload.get(id) : undefined, reducedMotion: this.reducedMotion,
                onPayload: this.payload ? (choice) => this.payloadChosen(this.stageDrone, choice) : undefined
            });
            this.mark(id);
        }).catch((e) => { console.warn('drone stage not loaded', e); this.stageSlot.remove(); });
    }

    /** "View in 3D" on a card: that drone on the stage, which scrolls into view. */
    private view3d(id: string): void {
        this.stageDrone = id;
        this.stage?.setDrone(id, this.payload && PRESETS[id].fields.payload_g ? this.payload.get(id) : undefined);
        this.mark(id);
        this.stageSlot.scrollIntoView({ block: 'nearest' });
    }

    private mark(id: string): void {
        for (const c of this.root.querySelectorAll('.drone-card')) c.toggleAttribute('data-viewing', c.getAttribute('data-preset') === id);
    }

    /** The close button and the current drone's card: nothing changes. Without an onClose, main.ts
     *  treats picking the drone already in use as "keep it and fly on". */
    private close(): void {
        if (this.onClose) this.onClose();
        else this.onPick?.(this.current);
    }

    remove(): void {
        this.gone = true;
        this.stage?.dispose();
        this.stage = null;
        this.root.remove();
    }
}

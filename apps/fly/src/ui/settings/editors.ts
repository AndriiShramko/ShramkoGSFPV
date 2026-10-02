// Registered editors for the JSON settings (docs/architecture-v03.md A.9): the PID grid, the rates
// (read-only, filled by "Import from Betaflight") and the throttle curve's mid and expo. A JSON value
// of null means "the drone preset's own", so each editor shows the preset's numbers then, and the
// first edit stores the whole value for that drone. The scene transform (E.7) shows its size on a
// log slider; the flight applies a new size around the drone (app/builtin/scale.ts). Other JSON
// kinds (recording folder) fall back to a read-only line.
import { compileParams, setpointRate } from '@gsfpv/sim-core';
import { SCALE_MAX, SCALE_MIN } from '@gsfpv/prefs';
import type { JsonDef, PidValue, RatesValue, SceneTransform, ThrottleValue } from '@gsfpv/prefs';
import { PRESETS } from '../../presets';
import { h } from '../dom';
import { t } from '../../i18n';

/** What a row gives its editor: the value (null: the preset's), a writer, the drone the values are for. */
export interface EditorIo {
    get(): unknown;
    set(v: unknown): void;
    drone(): string;
    /** the row's id prefix for element ids */
    uid: string;
    label: string;
    /** the Betaflight import panel, when a flight is up */
    importBetaflight?: () => void;
}

export interface Editor {
    el: HTMLElement;
    /** puts the focus on the editor (a deep link's ?focus=) */
    focus(): void;
    /** the id the row's name labels, when one element is the control */
    labelFor?: string;
    refresh(): void;
}

const AXES = ['roll', 'pitch', 'yaw'] as const;

function presetParams(drone: string) {
    const p = PRESETS[drone] ?? Object.values(PRESETS)[0];
    return compileParams(p);
}

/** P, I, D, F per axis (v0.2's grid, same classes): a cell's change stores the whole PID for this drone. */
function pidEditor(io: EditorIo): Editor {
    const grid = h('div', { class: 'pid-grid', role: 'group', 'aria-label': io.label, 'data-testid': 'pid-grid' },
        h('span', { class: 'pid-corner', 'aria-hidden': 'true' }),
        ...['P', 'I', 'D', 'F'].map((k) => h('span', { class: 'pid-h', 'aria-hidden': 'true' }, k)));
    const cells: HTMLInputElement[] = [];
    const value = (): PidValue => {
        const v = io.get() as PidValue | null;
        const p = v ?? presetParams(io.drone()).pid;
        return { roll: [...p.roll], pitch: [...p.pitch], yaw: [...p.yaw] };
    };
    for (const ax of AXES) {
        const name = t(`wizard.axis.${ax}`);
        grid.append(h('span', { class: 'pid-ax' }, name));
        for (let i = 0; i < 4; i++) {
            const inp = h('input', { type: 'number', min: 0, max: 250, step: 1, class: 'pid', inputmode: 'numeric', id: `${io.uid}-${ax}-${i}`, 'aria-label': `${name} ${'PIDF'[i]}` }) as HTMLInputElement;
            inp.addEventListener('change', () => {
                const n = Math.round(Number(inp.value));
                const v = value();
                v[ax][i] = Number.isFinite(n) ? Math.max(0, Math.min(250, n)) : v[ax][i];
                io.set(v);
            });
            cells.push(inp);
            grid.append(inp);
        }
    }
    const refresh = (): void => {
        const v = value();
        let k = 0;
        for (const ax of AXES) for (let i = 0; i < 4; i++) {
            const c = cells[k++];
            if (document.activeElement !== c) c.value = String(v[ax][i]);
        }
    };
    refresh();
    return { el: grid, focus: () => cells[0].focus({ preventScroll: true }), labelFor: cells[0].id, refresh };
}

/** The rate curves, read-only: the type, R / S / E per axis and the full-stick rate; the import button fills them. */
function ratesEditor(io: EditorIo): Editor {
    const body = h('div', { class: 'rates-view', 'data-testid': 'rates-view' });
    const btn = io.importBetaflight
        ? h('button', { type: 'button', class: 'btn', 'data-action': 'settings-import-bf', onclick: () => io.importBetaflight?.() }, t('prefs.rates.import'))
        : null;
    const el = h('div', { class: 'rates-editor', role: 'group', 'aria-label': io.label }, body, h('p', { class: 'muted small' }, t('prefs.rates.readOnly')), btn);
    const refresh = (): void => {
        const v = io.get() as RatesValue | null;
        const r = v ?? presetParams(io.drone()).rates;
        const table = h('table', { class: 'rates-table' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, r.type), h('th', { scope: 'col' }, 'R'), h('th', { scope: 'col' }, 'S'), h('th', { scope: 'col' }, 'E'), h('th', { scope: 'col' }, t('prefs.rates.max')))),
            h('tbody', {}, ...AXES.map((ax) => {
                const a = r[ax];
                const max = setpointRate(r.type, 1, a, r.rateLimit);
                return h('tr', {}, h('th', { scope: 'row' }, t(`wizard.axis.${ax}`)), h('td', {}, String(a.rcRate)), h('td', {}, String(a.rate)), h('td', {}, String(a.expo)), h('td', {}, `${Math.round(max)}°/s`));
            })));
        body.replaceChildren(table);
    };
    refresh();
    if (!btn) el.tabIndex = 0;
    return { el, focus: () => (btn ?? el).focus({ preventScroll: true }), refresh };
}

/** Throttle mid and expo, Betaflight's thr_mid / thr_expo (0-100). */
function throttleEditor(io: EditorIo): Editor {
    const value = (): ThrottleValue => {
        const v = io.get() as ThrottleValue | null;
        const p = v ?? presetParams(io.drone()).throttle;
        return { mid: p.mid, expo: p.expo };
    };
    const field = (k: 'mid' | 'expo'): HTMLInputElement => {
        const inp = h('input', { type: 'number', min: 0, max: 100, step: 1, inputmode: 'numeric', class: 'num', id: `${io.uid}-${k}` }) as HTMLInputElement;
        inp.addEventListener('change', () => {
            const n = Math.round(Number(inp.value));
            const v = value();
            if (Number.isFinite(n)) v[k] = Math.max(0, Math.min(100, n));
            io.set(v);
        });
        return inp;
    };
    const mid = field('mid'), expo = field('expo');
    const el = h('div', { class: 'thr-editor', role: 'group', 'aria-label': io.label },
        h('label', { for: mid.id }, t('prefs.throttle.mid')), mid,
        h('label', { for: expo.id }, t('prefs.throttle.expo')), expo);
    const refresh = (): void => {
        const v = value();
        if (document.activeElement !== mid) mid.value = String(v.mid);
        if (document.activeElement !== expo) expo.value = String(v.expo);
    };
    refresh();
    return { el, focus: () => mid.focus({ preventScroll: true }), labelFor: mid.id, refresh };
}

/**
 * The scene's size (E.7): x0.25 to x4 on a log slider. It stores the new size with the old offset;
 * the flight takes a new size as "rescale around the drone" and stores the offset that gives.
 */
function transformEditor(io: EditorIo): Editor {
    const value = (): SceneTransform => (io.get() as SceneTransform | null) ?? { s: 1, t: [0, 0, 0], v: 0 };
    const out = h('output', { class: 'sc-value', for: `${io.uid}-s` });
    const slider = h('input', { type: 'range', id: `${io.uid}-s`, class: 'sc-slider', min: Math.log2(SCALE_MIN), max: Math.log2(SCALE_MAX), step: 0.01 }) as HTMLInputElement;
    const show = (s: number): void => {
        out.textContent = `x${s.toFixed(2)}`;
        slider.setAttribute('aria-valuetext', `x${s.toFixed(2)}`);
    };
    slider.addEventListener('input', () => show(2 ** Number(slider.value)));
    slider.addEventListener('change', () => {
        const v = value();
        const s = Math.min(SCALE_MAX, Math.max(SCALE_MIN, 2 ** Number(slider.value)));
        io.set({ s: Math.abs(s - 1) < 0.005 ? 1 : s, t: [...v.t], v: v.v });
    });
    const el = h('div', { class: 'scale-editor', role: 'group', 'aria-label': io.label }, slider, out);
    const refresh = (): void => {
        const s = value().s;
        if (document.activeElement !== slider) slider.value = String(Math.log2(s));
        show(s);
    };
    refresh();
    return { el, focus: () => slider.focus({ preventScroll: true }), labelFor: slider.id, refresh };
}

/** A JSON kind without an editor yet: its value as text. */
function plainEditor(io: EditorIo): Editor {
    const el = h('code', { class: 'json-view', tabindex: 0 });
    const refresh = (): void => { const v = io.get(); el.textContent = v === null ? t('prefs.fromPreset') : JSON.stringify(v); };
    refresh();
    return { el, focus: () => el.focus({ preventScroll: true }), refresh };
}

const EDITORS: Partial<Record<JsonDef['kind'], (io: EditorIo) => Editor>> = { pid: pidEditor, rates: ratesEditor, throttle: throttleEditor, transform: transformEditor };

export function jsonEditor(def: JsonDef, io: EditorIo): Editor {
    return (EDITORS[def.kind] ?? plainEditor)(io);
}

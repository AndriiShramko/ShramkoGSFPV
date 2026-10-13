// The rates editor of Settings (setting tune.rates, per drone; v0.7 lane D2, the pilot's idea
// R-20261006-0001): the rates type (Betaflight, Raceflight, KISS, Actual, Quick), each axis' three
// fields under the names and in the units Betaflight Configurator uses, the rate limit, Quick's
// expo-on-the-stick switch, a live chart of the three curves with the full-stick rate per axis, back
// to the drone's own rates, "copy as CLI" and the Betaflight import. Every decision (bounds, steps,
// the type switch that keeps the curve, the CLI text) is in @gsfpv/sim-core rates-edit.ts; this file
// draws and passes typed text on. A value of null is the drone preset's own rates: the first edit
// stores the whole config for that drone (as the PID grid does).
import {
    RATE_AXES, RATE_FIELDS, RATE_LIMIT_MAX, RATE_LIMIT_MIN, RATES_TYPES, copyRates, curveSamples, fitRates, fullStickRates,
    isRatesType, ratesCli, readField, readRateLimit, shownText, withField
} from '@gsfpv/sim-core';
import type { RateAxis, RateField, RatesConfig, RatesType } from '@gsfpv/sim-core';
import type { RatesValue } from '@gsfpv/prefs';
import { h } from '../dom';
import { t } from '../../i18n';
import type { Editor, EditorIo } from './editors';

const SVG = 'http://www.w3.org/2000/svg';
/** Chart: 41 samples per curve over stick 0..1, plotted in a 320 x 180 box. */
const CHART_N = 41;
const CW = 320, CH = 180, PAD_L = 40, PAD_B = 22, PAD_T = 8, PAD_R = 8;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: (SVGElement | string)[]): SVGElementTagNameMap[K] {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    for (const c of kids) el.append(c);
    return el;
}

/** The stored value as a config the curves take; null (the preset's) is resolved by the caller. */
function toConfig(v: RatesValue): RatesConfig {
    return copyRates(v as RatesConfig);
}

/** "670 °/s" or "1.00": a field's shown value with its unit. */
function withUnit(fd: RateField, stored: number): string {
    return fd.unit === 'degs' ? `${shownText(fd, stored)} °/s` : shownText(fd, stored);
}

/** The editor; `preset` gives the drone's own rates (the value null means them). */
export function ratesEditor(io: EditorIo, preset: (drone: string) => RatesConfig): Editor {
    const uid = io.uid;
    const value = (): RatesConfig => {
        const v = io.get() as RatesValue | null;
        return v && isRatesType(v.type) ? toConfig(v) : copyRates(preset(io.drone()));
    };
    const isPreset = (): boolean => io.get() === null;
    const note = h('p', { class: 're-note small', role: 'status', 'aria-live': 'polite' });
    const say = (s: string, warn = false): void => {
        note.textContent = s;
        note.classList.toggle('warn', warn);
    };
    const store = (c: RatesConfig): void => io.set(copyRates(c));

    // ---- type
    const typeSel = h('select', { id: `${uid}-type`, class: 're-type', 'data-testid': 'rates-type' }) as HTMLSelectElement;
    for (const ty of RATES_TYPES) typeSel.append(h('option', { value: ty }, t(`rates.typeName.${ty}`)));
    typeSel.addEventListener('change', () => {
        const to = typeSel.value;
        if (!isRatesType(to)) return;
        const from = value();
        if (from.type === to) return;
        const fit = fitRates(from, to);
        store(fit.config);
        const d = Math.max(fit.worst.roll, fit.worst.pitch, fit.worst.yaw);
        say(t('rates.converted', { from: t(`rates.typeName.${from.type}`), to: t(`rates.typeName.${to}`), d: Math.round(d) }));
    });
    const src = h('span', { class: 're-src muted small' });

    // ---- the table: one row per axis, the type's three fields, the full-stick rate
    const head = h('tr', {});
    const body = h('tbody', {});
    const table = h('table', { class: 'rates-table re-table', 'data-testid': 'rates-table' }, h('thead', {}, head), body);
    const inputs = new Map<string, HTMLInputElement>(); // `${axis}.${key}`
    const maxCells = new Map<RateAxis, HTMLElement>();
    let builtFor: RatesType | null = null;
    const build = (type: RatesType): void => {
        builtFor = type;
        inputs.clear();
        maxCells.clear();
        const fields = RATE_FIELDS[type];
        head.replaceChildren(h('th', { scope: 'col' }, t('rates.axis')),
            ...fields.map((fd) => h('th', { scope: 'col' }, t(`rates.field.${fd.name}`), fd.unit === 'degs' ? h('span', { class: 'muted' }, ' °/s') : null)),
            h('th', { scope: 'col' }, t('rates.max')));
        body.replaceChildren(...RATE_AXES.map((ax) => {
            const cells = fields.map((fd) => {
                const inp = h('input', {
                    type: 'text', inputmode: 'decimal', class: 'num re-num', id: `${uid}-${ax}-${fd.key}`, 'data-testid': `rates-${ax}-${fd.key}`,
                    'aria-label': `${t(`wizard.axis.${ax}`)} ${t(`rates.field.${fd.name}`)}`, title: t('rates.range', { min: withUnit(fd, fd.min), max: withUnit(fd, fd.max) })
                }) as HTMLInputElement;
                inp.addEventListener('change', () => onField(ax, fd, inp));
                inputs.set(`${ax}.${fd.key}`, inp);
                return h('td', {}, inp);
            });
            const max = h('td', { class: 're-max', 'data-testid': `rates-max-${ax}` });
            maxCells.set(ax, max);
            return h('tr', {}, h('th', { scope: 'row' }, t(`wizard.axis.${ax}`)), ...cells, max);
        }));
    };
    const onField = (ax: RateAxis, fd: RateField, inp: HTMLInputElement): void => {
        const cur = value();
        const r = readField(fd, inp.value);
        const name = `${t(`wizard.axis.${ax}`)} ${t(`rates.field.${fd.name}`)}`;
        if (!r.ok) {
            say(t('rates.notNumber', { text: inp.value.slice(0, 24), field: name, value: withUnit(fd, cur[ax][fd.key]) }), true);
            inp.value = shownText(fd, cur[ax][fd.key]);
            return;
        }
        store(withField(cur, ax, fd.key, r.stored));
        if (r.adjusted) say(t('rates.adjusted', { field: name, value: withUnit(fd, r.stored), min: shownText(fd, fd.min), max: shownText(fd, fd.max) }), true);
        else say('');
    };

    // ---- rate limit and Quick's expo switch
    const limit = h('input', { type: 'text', inputmode: 'numeric', class: 'num', id: `${uid}-limit`, 'data-testid': 'rates-limit' }) as HTMLInputElement;
    limit.addEventListener('change', () => {
        const cur = value();
        const r = readRateLimit(limit.value);
        if (!r.ok) {
            say(t('rates.notNumber', { text: limit.value.slice(0, 24), field: t('rates.limit'), value: `${cur.rateLimit} °/s` }), true);
            limit.value = String(cur.rateLimit);
            return;
        }
        store({ ...cur, rateLimit: r.stored });
        if (r.adjusted) say(t('rates.adjusted', { field: t('rates.limit'), value: `${r.stored} °/s`, min: String(RATE_LIMIT_MIN), max: String(RATE_LIMIT_MAX) }), true);
        else say('');
    });
    const qe = h('input', { type: 'checkbox', id: `${uid}-qe`, 'data-testid': 'rates-quick-expo' }) as HTMLInputElement;
    qe.addEventListener('change', () => store({ ...value(), quickRcExpo: qe.checked }));
    const qeRow = h('label', { class: 're-qe', for: qe.id }, qe, h('span', {}, t('rates.quickRcExpo')));

    // ---- chart
    const grid = svg('g', { class: 're-grid' });
    const lines = new Map<RateAxis, SVGPolylineElement>(RATE_AXES.map((ax) => [ax, svg('polyline', { class: `re-line re-${ax}`, fill: 'none' })]));
    const legend = svg('g', { class: 're-legend' });
    const chart = svg('svg', { class: 're-chart', viewBox: `0 0 ${CW} ${CH}`, role: 'img', 'data-testid': 'rates-chart' }, grid, ...lines.values(), legend);
    const draw = (c: RatesConfig): void => {
        const full = fullStickRates(c);
        const top = Math.max(200, Math.ceil(Math.max(full.roll, full.pitch, full.yaw) / 200) * 200);
        const X = (x: number) => PAD_L + x * (CW - PAD_L - PAD_R);
        const Y = (w: number) => CH - PAD_B - (w / top) * (CH - PAD_B - PAD_T);
        grid.replaceChildren();
        for (let w = 0; w <= top; w += top > 1000 ? 400 : 200) {
            grid.append(svg('line', { x1: X(0), x2: X(1), y1: Y(w), y2: Y(w) }), svg('text', { x: PAD_L - 4, y: Y(w) + 4, 'text-anchor': 'end' }, String(w)));
        }
        for (const x of [0, 0.5, 1]) grid.append(svg('text', { x: X(x), y: CH - 6, 'text-anchor': x === 0 ? 'start' : x === 1 ? 'end' : 'middle' }, `${Math.round(x * 100)} %`));
        grid.append(svg('text', { x: PAD_L + 4, y: PAD_T + 10, 'text-anchor': 'start', class: 're-unit' }, '°/s'));
        for (const ax of RATE_AXES) {
            const pts = curveSamples(c, ax, CHART_N).map((w, i) => `${X(i / (CHART_N - 1)).toFixed(1)},${Y(w).toFixed(1)}`).join(' ');
            lines.get(ax)!.setAttribute('points', pts);
        }
        legend.replaceChildren(...RATE_AXES.map((ax, i) => svg('text', { x: PAD_L + 8, y: PAD_T + 26 + i * 14, class: `re-${ax}` }, `${t(`wizard.axis.${ax}`)} ${Math.round(full[ax])} °/s`)));
        chart.setAttribute('aria-label', t('rates.chart', { roll: Math.round(full.roll), pitch: Math.round(full.pitch), yaw: Math.round(full.yaw) }));
    };

    // ---- actions
    const reset = h('button', { type: 'button', class: 'btn', 'data-action': 'rates-reset', onclick: () => { io.set(null); say(t('rates.resetDone')); } }, t('rates.reset')) as HTMLButtonElement;
    const cliText = h('textarea', { class: 're-cli', rows: 8, readonly: true, spellcheck: 'false', hidden: true, 'aria-label': t('rates.copy') }) as HTMLTextAreaElement;
    const copy = h('button', {
        type: 'button', class: 'btn', 'data-action': 'rates-copy-cli',
        onclick: () => {
            const text = ratesCli(value());
            cliText.value = text;
            const manual = (): void => {
                cliText.hidden = false;
                cliText.select();
                say(t('rates.copyManual'));
            };
            if (!navigator.clipboard?.writeText) { manual(); return; }
            navigator.clipboard.writeText(text).then(() => { cliText.hidden = false; say(t('rates.copied')); }, manual);
        }
    }, t('rates.copy'));
    const importBtn = io.importBetaflight ? h('button', { type: 'button', class: 'btn', 'data-action': 'settings-import-bf', onclick: () => io.importBetaflight?.() }, t('prefs.rates.import')) : null;

    const el = h('div', { class: 'rates-editor', role: 'group', 'aria-label': io.label, 'data-testid': 'rates-editor' },
        h('div', { class: 're-head' }, h('label', { for: typeSel.id }, t('rates.type')), typeSel, src),
        h('div', { class: 're-body' },
            h('div', { class: 're-left' }, table,
                h('div', { class: 're-limit' }, h('label', { for: limit.id }, t('rates.limit')), limit, h('span', { class: 'sr-unit' }, '°/s')),
                qeRow),
            chart),
        note,
        h('div', { class: 're-actions' }, reset, copy, importBtn),
        cliText);

    const refresh = (): void => {
        const c = value();
        if (builtFor !== c.type) build(c.type);
        if (document.activeElement !== typeSel) typeSel.value = c.type;
        src.textContent = isPreset() ? t('rates.fromPreset') : t('rates.yours');
        for (const ax of RATE_AXES) {
            for (const fd of RATE_FIELDS[c.type]) {
                const inp = inputs.get(`${ax}.${fd.key}`)!;
                if (document.activeElement !== inp) inp.value = shownText(fd, c[ax][fd.key]);
            }
            maxCells.get(ax)!.textContent = `${Math.round(fullStickRates(c)[ax])} °/s`;
        }
        if (document.activeElement !== limit) limit.value = String(c.rateLimit);
        qeRow.hidden = c.type !== 'QUICK';
        qe.checked = c.quickRcExpo === true;
        reset.disabled = isPreset();
        if (!cliText.hidden) cliText.value = ratesCli(c);
        draw(c);
    };
    refresh();
    // the row's name stays a plain title: "Rates type" labels the select
    return { el, focus: () => typeSel.focus({ preventScroll: true }), refresh };
}

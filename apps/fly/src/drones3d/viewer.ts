// The 3D stage as a piece of the page (v0.9 lane D): a canvas with the turntable (drag to turn, wheel or pinch to zoom,
// arrows and +/- from the keyboard), numbered pins on the model that fade when they turn away, and the legend of what
// the drone carries beside it, in the player's language. Two shapes: "full" (the drone picker's stage) and "card" (the
// small "your drone" card of the pause menu). It draws only while it is on the page and in view, and it disposes itself
// the moment its element leaves the page. One graphics device per stage (studio.ts), destroyed on dispose.
import './stage.css';
import type { PresetJson } from '@gsfpv/sim-core';
import { h } from '../ui/dom';
import { t } from '../i18n';
import { buildFor } from './build';
import type { Build } from './build';
import { calloutRows, cinelifterNote } from './callouts';
import type { CalloutRow } from './callouts';
import { modelOf } from './model';
import type { Anchor, CalloutId, Model } from './model';
import { Orbit } from './orbit';
import { viewFor } from './views';
import type { OrbitState } from './orbit';
import { PAYLOADS, PAYLOAD_IDS } from './payloads';
import type { PayloadId } from './payloads';
import { Studio } from './studio';
import type { Tally } from './studio';

export interface StageOptions {
    presets: Record<string, PresetJson>;
    droneId: string;
    /** the cinelifter's camera (default: what the preset assumes) */
    payload?: PayloadId;
    /** "full": canvas + pins + legend (the picker); "card": a small canvas and a few words (the pause menu) */
    mode: 'full' | 'card';
    /** the player chose another camera load on the cinelifter's stage */
    onPayload?: (id: PayloadId) => void;
    /** the card's "Change drone" button */
    onChange?: () => void;
    /** 'webgl2' forces the fallback device (the browser check runs both) */
    backend?: 'auto' | 'webgl2';
}

export interface StageInfo {
    drone: string;
    payload: PayloadId | null;
    /** the studio exists and has drawn */
    ready: boolean;
    unavailable: boolean;
    frames: number;
    tally: Tally | null;
    /** the legend: ids in order, and which have a pin */
    rows: { id: CalloutId; pinned: boolean; none: boolean; basis: string }[];
    pins: { id: CalloutId; visible: boolean; back: boolean }[];
    view: OrbitState;
}

export interface Stage {
    readonly root: HTMLElement;
    setDrone(id: string, payload?: PayloadId): void;
    info(): StageInfo;
    dispose(): void;
}

/** What the browser checks read (window.__gsfpvDrones3d): how many stages were made and freed, and the state of the live ones. */
interface Hook {
    created: number;
    disposed: number;
    live: number;
    infos: () => StageInfo[];
    /** the tally of the last stage that was disposed, and whether the GPU reported its device destroyed */
    lastClosed: { tally: Tally; gpuReleased: boolean; drone: string } | null;
}
const liveStages = new Set<Stage>();
function hook(): Hook {
    const w = window as unknown as { __gsfpvDrones3d?: Hook };
    return (w.__gsfpvDrones3d ??= { created: 0, disposed: 0, live: 0, infos: () => [...liveStages].map((s) => s.info()), lastClosed: null });
}

/** The panel colour behind the canvas, so it melts into the picker (the --bg2 of fly.css), as linear 0..1. */
function panelColour(): [number, number, number] {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim();
        const m = v.match(/^#([0-9a-f]{6})$/i);
        if (m) return [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255];
    } catch { /* no styles: the default */ }
    return [0.055, 0.067, 0.086];
}

export { viewFor };

export function mountStage(host: HTMLElement, o: StageOptions): Stage {
    const card = o.mode === 'card';
    const orbit = new Orbit();
    orbit.reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let drone = o.droneId;
    let payload: PayloadId | undefined = o.payload;
    let build: Build = buildFor(o.presets[drone], payload);
    let model: Model | null = null;
    let rows: CalloutRow[] = [];
    let studio: Studio | null = null;
    let disposed = false;
    let unavailable = false;
    let visible = true;
    const pins: { id: CalloutId; el: HTMLButtonElement; anchor: Anchor }[] = [];

    // ---- the page
    const canvas = h('canvas', { class: 'd3-canvas', id: `d3-canvas-${hook().created}`, tabindex: 0, role: 'img', 'aria-label': '' });
    const pinLayer = h('div', { class: 'd3-pins' });
    const status = h('div', { class: 'd3-status', role: 'status' }, t('d3.loading'));
    const resetBtn = h('button', { type: 'button', class: 'd3-reset', 'data-action': 'd3-reset', onclick: () => orbit.reset() }, t('d3.reset'));
    const view = h('div', { class: 'd3-view', 'data-testid': 'd3-view' }, canvas, pinLayer, status,
        card ? null : h('div', { class: 'd3-over' }, h('span', {}, t('d3.hint')), resetBtn));
    const legend = h('ol', { class: 'd3-legend', 'data-testid': 'd3-legend', 'aria-label': t('d3.legend') });
    const nameEl = h('h2', { class: 'd3-name' });
    const classEl = h('p', { class: 'muted small' });
    const specEl = h('p', { class: 'small' });
    const noteEl = h('p', { class: 'd3-note', 'data-testid': 'd3-note', hidden: true });
    const chipsEl = h('div', { class: 'd3-chips-wrap' });
    const cardName = h('h3', {});
    const root = card
        ? h('div', { class: 'd3-card', 'data-testid': 'd3-card' }, view,
            h('div', { class: 'd3-card-text' }, h('div', { class: 'muted small' }, t('d3.yourDrone')), cardName, classEl, specEl,
                o.onChange ? h('div', { class: 'd3-card-actions' }, h('button', { type: 'button', class: 'btn', 'data-action': 'd3-change', onclick: () => o.onChange?.() }, t('d3.change'))) : null))
        : h('section', { class: 'd3-stage', 'data-testid': 'drone-stage' }, view, h('div', { class: 'd3-side' }, nameEl, classEl, specEl, chipsEl, noteEl, legend));
    host.replaceChildren(root);

    // ---- what the drone carries
    function fill(): void {
        const p = o.presets[drone];
        build = buildFor(p, payload);
        model = modelOf(build);
        rows = calloutRows(build, t);
        (card ? cardName : nameEl).textContent = build.name;
        classEl.textContent = build.cls;
        specEl.textContent = `${t('drone.weight')}: ${build.auwG} g  ·  ${t('drone.twr')}: ${String(p.fields.twr?.value ?? '')}:1  ·  ${build.cells}S ${build.mah} mAh`;
        canvas.setAttribute('aria-label', t('d3.stage.aria', { name: build.name }));
        const note = cinelifterNote(build, t);
        noteEl.hidden = !note || card;
        noteEl.textContent = note ?? '';
        // legend rows, numbered in the order of the pins that exist
        legend.replaceChildren();
        pinLayer.replaceChildren();
        pins.length = 0;
        let n = 0;
        for (const r of rows) {
            const anchor = model.anchors.find((a) => a.id === r.id);
            const num = anchor && !card ? String(++n) : '';
            if (anchor && !card) {
                const el = h('button', { type: 'button', class: 'd3-pin back', 'data-callout': r.id, 'aria-label': t('d3.pinFor', { part: r.label }), onclick: () => focusRow(r.id) }, num);
                pinLayer.append(el);
                pins.push({ id: r.id, el, anchor });
            }
            if (card) continue;
            const basisTip = t(`d3.basisTip.${r.basis}`);
            const li = h('li', { 'data-callout': r.id, class: 'd3-li' },
                h('button', { type: 'button', class: `d3-row${r.none ? ' none' : ''}`, 'aria-label': `${r.label}: ${r.title}`, onclick: () => focusRow(r.id) },
                    h('span', { class: `d3-n${anchor ? ' pinned' : ''}`, 'aria-hidden': 'true' }, num || '-'),
                    h('span', { class: 'd3-label' }, r.label, h('span', { class: `d3-basis ${r.basis}`, title: basisTip }, t(`d3.basis.${r.basis}`))),
                    h('span', { class: 'd3-title' }, r.title),
                    h('span', { class: 'd3-facts' }, r.facts.join('  ·  '))),
                // the maker's page, beside the row (a link inside a button would not be valid)
                r.ref ? h('a', { class: 'd3-src', href: r.ref, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${r.label}: ${t('d3.source')}` }, t('d3.source')) : null);
            legend.append(li);
        }
        // the camera choice of the cinelifter
        chipsEl.replaceChildren();
        if (!card && build.payload && o.onPayload) {
            const chips = h('div', { class: 'd3-chips', role: 'group', 'aria-label': t('d3.payload.title') });
            for (const id of PAYLOAD_IDS) {
                chips.append(h('button', { type: 'button', class: 'd3-chip', 'data-payload': id, 'aria-pressed': String(id === build.payload), onclick: () => { o.onPayload?.(id); setDrone(drone, id); } }, PAYLOADS[id].name ?? t('d3.f.none')));
            }
            chipsEl.append(h('div', { class: 'd3-chips-label' }, t('d3.payload.title')), chips);
        }
        if (studio && model) { studio.setModel(model); studio.setView(orbit.state); }
    }

    function focusRow(id: CalloutId): void {
        const pin = pins.find((p) => p.id === id);
        if (pin) orbit.flyTo(viewFor(pin.anchor));
        for (const li of legend.querySelectorAll('.d3-row')) li.classList.toggle('on', li.parentElement?.getAttribute('data-callout') === id);
        for (const p of pins) p.el.classList.toggle('on', p.id === id);
        window.setTimeout(() => { for (const p of pins) p.el.classList.remove('on'); for (const li of legend.querySelectorAll('.d3-row')) li.classList.remove('on'); }, 2600);
    }

    function setDrone(id: string, p?: PayloadId): void {
        if (disposed || !o.presets[id]) return;
        drone = id;
        payload = p;
        orbit.reset();
        fill();
    }

    // ---- pins follow the model
    function updatePins(): void {
        if (!studio || !model || card) return;
        const cam = studio.cameraPosition();
        const w = canvas.clientWidth, hgt = canvas.clientHeight;
        for (const p of pins) {
            const s = studio.project(p.anchor.at);
            const inside = s.front && s.x > -10 && s.x < w + 10 && s.y > -10 && s.y < hgt + 10;
            p.el.hidden = !inside;
            if (!inside) continue;
            p.el.style.left = `${s.x.toFixed(1)}px`;
            p.el.style.top = `${s.y.toFixed(1)}px`;
            const n = p.anchor.normal;
            let back = false;
            if (n) {
                const dx = cam[0] - p.anchor.at[0], dy = cam[1] - p.anchor.at[1], dz = cam[2] - p.anchor.at[2];
                const l = Math.hypot(dx, dy, dz) || 1;
                back = (n[0] * dx + n[1] * dy + n[2] * dz) / l < 0.05;
            }
            p.el.classList.toggle('back', back);
        }
    }

    // ---- the turntable by hand
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    canvas.addEventListener('pointerdown', (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { canvas.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
        if (pointers.size === 1) orbit.grab();
        if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    canvas.addEventListener('pointermove', (e) => {
        const prev = pointers.get(e.pointerId);
        if (!prev) return;
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        prev.x = e.clientX; prev.y = e.clientY;
        if (pointers.size >= 2) {
            const [a, b] = [...pointers.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinch > 0) orbit.zoom((pinch - d) * 2.2);
            pinch = d;
        } else orbit.drag(dx, e.pointerType === 'touch' ? 0 : dy, canvas.clientWidth);
    });
    const up = (e: PointerEvent): void => {
        pointers.delete(e.pointerId);
        if (pointers.size === 0) orbit.release();
        pinch = 0;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    // the wheel zooms only when asked (Ctrl, or the stage has the focus), so scrolling the picker past the stage still scrolls
    canvas.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || document.activeElement === canvas)) return;
        orbit.zoom(e.deltaY);
        e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('dblclick', () => orbit.reset());
    canvas.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 20 : 8;
        const map: Record<string, () => void> = {
            ArrowLeft: () => orbit.nudge(-step, 0), ArrowRight: () => orbit.nudge(step, 0), ArrowUp: () => orbit.nudge(0, step), ArrowDown: () => orbit.nudge(0, -step),
            '+': () => orbit.zoom(-120), '=': () => orbit.zoom(-120), '-': () => orbit.zoom(120), Home: () => orbit.reset(), '0': () => orbit.reset()
        };
        const f = map[e.key];
        if (f) { f(); e.preventDefault(); e.stopPropagation(); }
    });

    // ---- the engine, and the rules of when it draws
    const tidy: (() => void)[] = [];
    const info = (): StageInfo => ({
        drone, payload: build.payload, ready: !!studio && studio.frames > 0, unavailable, frames: studio?.frames ?? 0, tally: studio?.tally() ?? null,
        rows: rows.map((r) => ({ id: r.id, pinned: pins.some((p) => p.id === r.id), none: !!r.none, basis: r.basis })),
        pins: pins.map((p) => ({ id: p.id, visible: !p.el.hidden, back: p.el.classList.contains('back') })),
        view: { ...orbit.state }
    });
    const stage: Stage = {
        root,
        setDrone,
        info,
        dispose(): void {
            if (disposed) return;
            disposed = true;
            for (const f of tidy.splice(0)) f();
            const s = studio;
            studio = null;
            liveStages.delete(stage);
            const k = hook();
            k.live = liveStages.size;
            k.disposed++;
            if (s) {
                const drone0 = drone;
                s.dispose();
                const tally = s.tally();
                void s.whenReleased().then((ok) => { k.lastClosed = { tally, gpuReleased: ok, drone: drone0 }; });
                k.lastClosed = { tally, gpuReleased: s.gpuReleased, drone: drone0 };
            }
            if (root.isConnected) root.remove();
        }
    };
    hook().created++;
    liveStages.add(stage);
    hook().live = liveStages.size;
    fill();

    const active = (): boolean => visible && !document.hidden && root.isConnected;
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); studio?.setActive(active()); }) : null;
    io?.observe(view);
    const onVis = (): void => studio?.setActive(active());
    document.addEventListener('visibilitychange', onVis);
    // the page forgot us (the pause menu closed, the picker was removed): free the GPU at once
    const mo = new MutationObserver(() => { if (!root.isConnected) stage.dispose(); });
    mo.observe(document.body, { childList: true, subtree: true });
    tidy.push(() => { io?.disconnect(); mo.disconnect(); document.removeEventListener('visibilitychange', onVis); });

    void (async () => {
        try {
            const s = await Studio.create(canvas, { backend: o.backend, background: panelColour() });
            if (disposed || !root.isConnected) { s.dispose(); if (!disposed) stage.dispose(); return; }
            studio = s;
            s.onFrame = (dt) => {
                if (!root.isConnected) { stage.dispose(); return; }
                orbit.tick(dt);
                s.halfRate = !orbit.interacting;
                s.setView(orbit.state);
                updatePins();
                if (!status.hidden && s.frames > 1) status.hidden = true;
            };
            if (model) s.setModel(model);
            s.setView(orbit.state);
            s.setActive(active());
        } catch (e) {
            unavailable = true;
            status.hidden = false;
            status.textContent = t('d3.unavailable');
            console.warn('drone stage: no 3D view', e);
        }
    })();
    return stage;
}

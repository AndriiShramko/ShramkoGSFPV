// In-flight UI: Betaflight-style OSD, arm-gate reason, crash overlay, pause menu, settings,
// replays and the measurements panel.
import { h, clear, panel, fmt } from './dom';
import { t, locale, setLocale, LOCALES } from '../i18n';
import type { Locale } from '../i18n';
import type { FlightSession } from '../session';
import type { CrashInfo } from '../crashview';
import type { ArmBlock } from '@gsfpv/input';

export class Hud {
    readonly root: HTMLDivElement;
    private tl = h('div', { class: 'osd tl' });
    private tr = h('div', { class: 'osd tr' });
    private bl = h('div', { class: 'osd bl' });
    private br = h('div', { class: 'osd br' });
    private gate = h('div', { class: 'gate-msg', role: 'status', 'aria-live': 'polite' });
    private frameStats = h('div', { class: 'osd frame hidden' });
    private last = 0;
    visible = true;
    rec = false;

    constructor(parent: HTMLElement) {
        this.root = h('div', { class: 'hud' }, this.tl, this.tr, this.bl, this.br, this.gate, this.frameStats);
        parent.append(this.root);
    }

    toggleFrameStats(): void {
        this.frameStats.classList.toggle('hidden');
    }

    update(s: FlightSession, block: ArmBlock, frameMs: { p50: number; p99: number }): void {
        const now = performance.now();
        if (now - this.last < 100) return;
        this.last = now;
        this.root.style.display = this.visible ? '' : 'none';
        const hd = s.hud();
        const status = hd.crashed ? `<span class="crash">${t('hud.crash')}</span>` : hd.armed ? `<span class="armed">${t('hud.armed')}</span>` : `<span class="disarmed">${t('hud.disarmed')}</span>`;
        const mode = s.sim.ch[5] > 0.5 ? t('hud.angle') : t('hud.acro');
        this.tl.innerHTML = `${status} · ${mode}${this.rec ? ` · <span class="rec">● ${t('hud.rec')}</span>` : ''}`;
        this.tr.textContent = `${fmt(hd.volts, 1)} V  ${fmt(hd.timeS, 1)} s`;
        this.bl.textContent = `THR ${hd.throttlePct}%  ${fmt(hd.speed, 1)} m/s  ALT ${fmt(hd.altitude, 1)} m`;
        this.br.textContent = `${t('hud.crashes', { n: hd.crashes })}  ·  ${t('hud.keys')}`;
        this.gate.textContent = !hd.armed && !hd.crashed && block ? t(block === 'throttle' ? 'arm.hint' : `arm.blocked.${block}`) : '';
        this.frameStats.textContent = `frame p50 ${fmt(frameMs.p50, 1)} ms · p99 ${fmt(frameMs.p99, 1)} ms · physics 1000 Hz`;
    }
}

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

export interface PauseActions {
    resume(): void;
    restart(): void;
    scene(): void;
    drone(): void;
    radio(): void;
    settings(): void;
    replays(): void;
    measure(): void;
}

export function pauseMenu(parent: HTMLElement, a: PauseActions): () => void {
    const p = panel(t('pause.title'), () => { p.close(); a.resume(); });
    const items: [string, () => void][] = [
        ['pause.continue', a.resume], ['pause.restart', a.restart], ['pause.scene', a.scene], ['pause.drone', a.drone],
        ['pause.radio', a.radio], ['pause.settings', a.settings], ['pause.replays', a.replays], ['pause.measure', a.measure]
    ];
    for (const [k, fn] of items) p.body.append(h('button', { type: 'button', class: 'btn block', 'data-action': k, onclick: () => { p.close(); fn(); } }, t(k)));
    p.body.append(h('a', { class: 'btn block', href: `/${locale}/#contact`, target: '_blank', rel: 'noopener' }, t('pause.contact')));
    parent.append(p.root);
    return p.close;
}

export interface SettingsValues {
    fov: number;
    uptilt: number;
    hud: boolean;
    units: 'metric' | 'imperial';
    quality: number; // 0..1 (0 = stable frame, 1 = detail)
    gravity: number;
    gravityMode: 'honest' | 'same-twr' | 'auto-throttle';
    vCrash: number;
    tauMs: number;
    cdaScale: number;
    reducedMotion: boolean;
    pid: { roll: number[]; pitch: number[]; yaw: number[] };
}

export function settingsPanel(parent: HTMLElement, v: SettingsValues, twr: number, onApply: (v: SettingsValues) => void, onClose: () => void): void {
    const p = panel(t('settings.title'), () => { p.close(); onClose(); });
    const lang = h('select', { 'aria-label': t('settings.language') }) as HTMLSelectElement;
    for (const l of LOCALES) lang.append(h('option', { value: l }, t(`lang.${l}`)));
    lang.value = locale;
    lang.addEventListener('change', () => { setLocale(lang.value as Locale); location.pathname = location.pathname.replace(/^\/(en|es|pl|ru)\//, `/${lang.value}/`); });
    const num = (label: string, val: number, min: number, max: number, step: number, key: keyof SettingsValues, unit = '') => {
        const input = h('input', { type: 'range', min, max, step, value: val, 'aria-label': label }) as HTMLInputElement;
        const out = h('output', {}, `${val}${unit}`);
        input.addEventListener('input', () => { (v as unknown as Record<string, number>)[key as string] = Number(input.value); out.textContent = `${input.value}${unit}`; });
        return h('label', { class: 'set-row' }, h('span', {}, label), input, out);
    };
    const hudBox = h('input', { type: 'checkbox' }) as HTMLInputElement;
    hudBox.checked = v.hud;
    hudBox.addEventListener('change', () => { v.hud = hudBox.checked; });
    const grav = h('select', { 'aria-label': t('settings.gravity') }) as HTMLSelectElement;
    for (const [k, g] of [['earth', 9.81], ['moon', 1.62], ['mars', 3.72], ['zero', 0]] as const) grav.append(h('option', { value: String(g) }, t(`settings.gravity.${k}`)));
    grav.value = String(v.gravity);
    const warn = h('p', { class: 'warn small' });
    const gMode = h('select', { 'aria-label': t('settings.gravityMode') }) as HTMLSelectElement;
    for (const k of ['honest', 'same-twr', 'auto-throttle'] as const) gMode.append(h('option', { value: k }, t(`settings.gravityMode.${k}`)));
    gMode.value = v.gravityMode;
    const updWarn = () => {
        const g = Number(grav.value);
        v.gravity = g;
        v.gravityMode = gMode.value as SettingsValues['gravityMode'];
        warn.textContent = g > 0 && g < 9.8 && v.gravityMode === 'honest' ? t('settings.gravityWarning', { g: fmt(g, 2), x: fmt(9.81 / g, 1) }) : '';
        void twr;
    };
    grav.addEventListener('change', updWarn);
    gMode.addEventListener('change', updWarn);
    updWarn();
    const rm = h('input', { type: 'checkbox' }) as HTMLInputElement;
    rm.checked = v.reducedMotion;
    rm.addEventListener('change', () => { v.reducedMotion = rm.checked; });
    const pidInputs = (['roll', 'pitch', 'yaw'] as const).map((ax) => {
        const inputs = v.pid[ax].map((x, i) => {
            const inp = h('input', { type: 'number', min: 0, max: 250, step: 1, value: x, class: 'pid', 'aria-label': `${ax} ${'PIDF'[i]}` }) as HTMLInputElement;
            inp.addEventListener('change', () => { v.pid[ax][i] = Math.max(0, Math.min(250, Number(inp.value) || 0)); });
            return inp;
        });
        return h('div', { class: 'set-row' }, h('span', {}, ax), ...inputs);
    });
    const adv = h('details', {},
        h('summary', {}, t('settings.advanced')),
        num(t('settings.quality'), v.quality, 0, 1, 0.05, 'quality'),
        h('p', { class: 'muted small' }, t('settings.qualityHint')),
        h('div', { class: 'set-row' }, h('span', {}, t('settings.gravity')), grav),
        h('div', { class: 'set-row' }, h('span', {}, t('settings.gravityMode')), gMode),
        warn,
        num(t('settings.crash'), v.vCrash, 2, 10, 0.5, 'vCrash', ' m/s'),
        num(t('settings.tau'), v.tauMs, 8, 30, 1, 'tauMs', ' ms'),
        num(t('settings.drag'), v.cdaScale, 0.5, 2, 0.05, 'cdaScale', '×'),
        h('div', {}, h('p', { class: 'muted small' }, t('settings.pid')), ...pidInputs),
        h('label', { class: 'set-row' }, h('span', {}, t('settings.reducedMotion')), rm)
    );
    p.body.append(
        h('div', { class: 'set-row' }, h('span', {}, t('settings.language')), lang),
        num(t('settings.fov'), v.fov, 70, 150, 1, 'fov', '°'),
        num(t('settings.uptilt'), v.uptilt, 0, 50, 1, 'uptilt', '°'),
        h('label', { class: 'set-row' }, h('span', {}, t('settings.hud')), hudBox),
        adv,
        h('button', { type: 'button', class: 'btn primary', 'data-action': 'apply', onclick: () => { p.close(); onApply(v); } }, t('settings.apply'))
    );
    parent.append(p.root);
}

export function measurePanel(parent: HTMLElement, report: Record<string, unknown>, onClose: () => void): void {
    const p = panel(t('measure.title'), () => { p.close(); onClose(); });
    const rows: [string, string][] = [
        [t('measure.renderer'), String(report.renderer)],
        [t('measure.output'), `${fmt(report.outputHz as number, 1)} Hz`],
        [t('measure.frame'), `${fmt(report.frameP50 as number, 1)} / ${fmt(report.frameP99 as number, 1)} ms`],
        [t('measure.physics'), `${fmt(report.physicsHz as number, 0)} Hz`],
        [t('measure.input'), `${report.inputSource ?? '—'} · ${fmt(report.inputHz as number, 0)} Hz`],
        [t('measure.pipeline'), report.pipelineMs === null ? t('measure.notMeasured') : `${fmt(report.pipelineMs as number, 1)} ms`],
        [t('measure.load'), `${fmt((report.loadMs as number) / 1000, 2)} s`],
        [t('measure.collision'), String(report.collision)],
        [t('measure.tunnel'), String(report.tunnelSelfTest)]
    ];
    const dl = h('dl', { class: 'measure' });
    for (const [k, val] of rows) dl.append(h('dt', {}, k), h('dd', {}, val));
    const hz = report.outputHz as number;
    const copyBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'copy-report' }, t('measure.copy'));
    copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); copyBtn.textContent = t('measure.copied'); } catch { /* clipboard blocked */ }
    });
    p.body.append(dl, h('p', { class: 'muted small' }, t('measure.note', { hz: fmt(hz, 0), ms: fmt(1000 / Math.max(1, hz), 0) })), copyBtn);
    parent.append(p.root);
}

export function replaysPanel(parent: HTMLElement, items: { label: string; play: () => void; exportCsv: () => void; exportJson: () => void }[], onClose: () => void): void {
    const p = panel(t('replays.title'), () => { p.close(); onClose(); });
    if (items.length === 0) p.body.append(h('p', { class: 'muted' }, t('replays.empty')));
    for (const it of items) {
        p.body.append(h('div', { class: 'replay-row' }, h('span', {}, it.label),
            h('button', { type: 'button', class: 'btn', onclick: () => { p.close(); it.play(); } }, t('replays.play')),
            h('button', { type: 'button', class: 'btn', onclick: it.exportCsv }, 'CSV'),
            h('button', { type: 'button', class: 'btn', onclick: it.exportJson }, 'JSON')));
    }
    parent.append(p.root);
    void clear;
}

export function warningModal(parent: HTMLElement, onOk: () => void): void {
    const p = panel(t('warning.title'));
    p.body.append(h('p', {}, t('warning.text')), h('button', { type: 'button', class: 'btn primary', 'data-action': 'warning-ok', onclick: () => { p.close(); onOk(); } }, t('warning.ok')));
    parent.append(p.root);
}

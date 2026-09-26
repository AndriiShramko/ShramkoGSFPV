// In-flight UI: Betaflight-style OSD, arm-gate reason, crash overlay, pause menu, settings,
// replays and the measurements panel.
import { h, clear, panel, fmt } from './dom';
import { t, locale, setLocale, LOCALES } from '../i18n';
import type { Locale } from '../i18n';
import type { FlightSession } from '../session';
import type { CrashInfo } from '../crashview';
import type { ArmBlock } from '@gsfpv/input';
import type { ArmView } from '../controls';
import { radioArt, knobsFrom, sideOf, tickIcon } from './radio-art';
import type { ArtTarget } from './radio-art';

/** Disarmed with a radio: what is still needed to arm, in order, with a small live radio drawing. */
class ArmCard {
    readonly el: HTMLDivElement;
    readonly disarm: HTMLButtonElement;
    private art = radioArt({ mini: true });
    private list: HTMLOListElement;
    private reason = h('p', { class: 'reason' });
    private rows: { li: HTMLLIElement; text: HTMLSpanElement }[] = [];
    private armBtn: HTMLButtonElement;

    constructor(onArm: () => void) {
        const row = (): { li: HTMLLIElement; text: HTMLSpanElement } => {
            const text = h('span');
            return { li: h('li', {}, h('span', { class: 'mk' }, tickIcon()), text), text };
        };
        this.rows = [row(), row(), row()];
        this.armBtn = h('button', { type: 'button', class: 'btn primary', 'data-action': 'hud-arm', onclick: () => onArm() }, t('arm.button'));
        this.rows[2].li.append(this.armBtn);
        this.list = h('ol', {}, ...this.rows.map((r) => r.li));
        // not a live region: the throttle % changes ten times a second. Hud.gate speaks the step instead
        this.el = h('div', { class: 'arm-card hidden' }, this.art.el, h('div', {}, h('h3', {}, t('arm.card.title')), this.list, this.reason));
        this.disarm = h('button', { type: 'button', class: 'btn arm-disarm hidden', 'data-action': 'hud-disarm', onclick: () => onArm() }, t('arm.disarmKey'));
    }

    update(v: ArmView | null, armed: boolean, crashed: boolean, block: ArmBlock): void {
        const screenOpen = !!document.querySelector('.screen.radio');
        const key = v?.armKind === 'key';
        this.disarm.classList.toggle('hidden', !(v && key && armed && !crashed && !screenOpen));
        const show = !!v && !armed && !crashed && !screenOpen && block !== null;
        this.el.classList.toggle('hidden', !show);
        if (!v || !show) return;
        // no signal, hidden tab, crashed, no profile: only the reason, the steps do not apply
        const reasonOnly = block === 'stale' || block === 'hidden' || block === 'crashed' || block === 'noProfile';
        this.list.hidden = reasonOnly;
        this.art.el.style.display = reasonOnly ? 'none' : '';
        this.reason.textContent = reasonOnly ? t(`arm.blocked.${block}`) : '';
        if (reasonOnly) return;
        const ch = v.ch;
        const u = (ch[2] + 1) / 2;
        const set = (i: number, text: string, done: boolean, now: boolean): void => {
            const r = this.rows[i];
            if (r.text.textContent !== text) r.text.textContent = text;
            r.li.classList.toggle('done', done);
            r.li.classList.toggle('now', now && !done);
        };
        set(0, t('arm.row.centre'), block !== 'center', block === 'center');
        set(1, t('arm.row.throttle', { pct: Math.round(Math.max(0, Math.min(1, u)) * 100) }), u <= 0.05, block === 'throttle');
        set(2, key ? t('arm.row.key') : t('arm.row.switch', { src: v.armLabel }), false, block === 'switch');
        this.armBtn.classList.toggle('hidden', !key);
        const mode = v.mode;
        const k = knobsFrom({ roll: ch[0], pitch: ch[1], throttle: ch[2], yaw: ch[3] }, mode);
        const target: ArtTarget = block === 'center' ? { side: 'both', dir: 'centre' }
            : block === 'throttle' ? { side: sideOf('throttle', mode), dir: 'down' }
            : block === 'switch' && !key ? { side: 'SW', dir: 'flip' } : null;
        this.art.set({ mode, target, knobL: k.L, knobR: k.R, hold: 0, ok: false, sw: key ? null : ch[4] > 0, tol: 0, label: '' });
    }
}

/**
 * Keyboard pilot, disarmed: what to press now, then every flying key (they live only in
 * devices/keyboard.ts, so a first-time pilot had no way to learn them). A keyboard has no arm switch.
 */
class KeyCard {
    readonly el: HTMLDivElement;
    private now = h('p', { class: 'reason now' });
    private rows: Record<'arm' | 'thr' | 'sticks', HTMLLIElement>;

    constructor() {
        const caps = (...ks: string[]): HTMLSpanElement => h('span', { class: 'kc-keys' }, ...ks.map((k) => h('kbd', {}, k)));
        const row = (keys: HTMLSpanElement, text: string): HTMLLIElement => h('li', {}, keys, h('span', {}, text));
        this.rows = {
            arm: row(caps(t('arm.keys.space')), t('arm.keys.arm')),
            thr: row(caps('W', 'S'), t('arm.keys.throttle')),
            sticks: row(caps('↑', '↓', '←', '→'), t('arm.keys.sticks'))
        };
        const list = h('ul', { class: 'kc-list' },
            this.rows.arm, this.rows.thr,
            row(caps('A', 'D'), t('arm.keys.yaw')),
            this.rows.sticks,
            row(caps('M'), t('arm.keys.mode')),
            row(caps('R'), t('arm.keys.respawn')),
            row(caps('P', 'Esc'), t('arm.keys.pause')));
        this.el = h('div', { class: 'arm-card key-card hidden' }, h('div', {}, h('h3', {}, t('arm.keys.title')), this.now, list));
    }

    update(show: boolean, say: string, block: ArmBlock): void {
        this.el.classList.toggle('hidden', !show);
        if (!show) return;
        if (this.now.textContent !== say) this.now.textContent = say;
        this.rows.arm.classList.toggle('now', block === 'switch');
        this.rows.thr.classList.toggle('now', block === 'throttle');
        this.rows.sticks.classList.toggle('now', block === 'center');
    }
}

/** The arm hint in the words of the input in use: keyboard and touch pilots have no arm switch. */
function gateText(block: Exclude<ArmBlock, null>, v: ArmView | undefined): string {
    const src = v?.source ?? null;
    if (src === 'keyboard') {
        if (block === 'switch') return t('arm.blocked.switchKey');
        if (block === 'throttle') return t('arm.blocked.throttleKey');
        if (block === 'center') return t('arm.blocked.centerKey');
    } else if (src === 'touch') {
        if (block === 'switch') return t('arm.blocked.switchTouch', { btn: t('arm.button') });
        if (block === 'throttle') return t('arm.blocked.throttleTouch', { btn: t('arm.button') });
    } else if (src === 'hid' || src === 'gamepad') {
        if (block === 'switch' && v?.armKind === 'key') return t('arm.row.key');
    } else if (block === 'throttle') {
        return t('arm.hint');
    }
    return t(`arm.blocked.${block}`);
}

/**
 * Notes at the top edge (no WebHID, no WebGPU, the gravity warning) stack under each other, and
 * #ui gets their total height as --banner-h: fly.css moves the OSD's top line, the top buttons and
 * the touch hint down by it. A note that wraps to two lines on a phone no longer prints over them.
 */
function stackBanners(ui: HTMLElement): void {
    let y = 0;
    for (const b of ui.querySelectorAll<HTMLElement>(':scope > .banner')) {
        const top = `${y}px`;
        if (b.style.top !== top) b.style.top = top;
        y += b.offsetHeight;
    }
    const v = `${Math.round(y)}px`;
    if (ui.style.getPropertyValue('--banner-h') !== v) ui.style.setProperty('--banner-h', v);
}

function watchBanners(ui: HTMLElement): void {
    const again = (): void => stackBanners(ui);
    // a note wraps differently after a resize or a language change: its height is watched too
    const sizes = new ResizeObserver(again);
    const observe = (): void => { for (const b of ui.querySelectorAll(':scope > .banner')) sizes.observe(b); };
    new MutationObserver(() => { observe(); again(); }).observe(ui, { childList: true });
    observe();
    again();
}

export class Hud {
    readonly root: HTMLDivElement;
    private tl = h('div', { class: 'osd tl' });
    private tr = h('div', { class: 'osd tr' });
    private bl = h('div', { class: 'osd bl' });
    private br = h('div', { class: 'osd br' });
    private gate = h('div', { class: 'gate-msg', role: 'status', 'aria-live': 'polite' });
    private frameStats = h('div', { class: 'osd frame hidden' });
    private card = new ArmCard(() => this.onArm?.());
    private keys = new KeyCard();
    private last = 0;
    visible = true;
    rec = false;
    /** Arm kind 'key' (no switch on the radio): the on-screen ARM / DISARM button. */
    onArm: (() => void) | null = null;

    constructor(parent: HTMLElement) {
        this.root = h('div', { class: 'hud' }, this.tl, this.tr, this.bl, this.br, this.gate, this.card.el, this.card.disarm, this.keys.el, this.frameStats);
        parent.append(this.root);
        watchBanners(parent);
    }

    /** Text widths of the corner line, measured once per text (it is one line, fly.css nowrap). */
    private brWidth = new Map<string, number>();
    /** Widest telemetry line seen at this window width: a digit more must not flip the corner text. */
    private blMax = 0;
    private blAt = 0;

    /**
     * The bottom-right line is the first of `texts` that fits between the telemetry line and the
     * right edge; the key card carries the full list, so a narrow window gets a shorter line
     * instead of two lines printed over the telemetry.
     */
    private setCorner(texts: string[]): void {
        if (this.br.offsetParent === null) { if (this.br.textContent !== texts[0]) this.br.textContent = texts[0]; return; } // hidden (touch, cinema)
        if (this.blAt !== innerWidth) { this.blAt = innerWidth; this.blMax = 0; }
        this.blMax = Math.max(this.blMax, this.bl.getBoundingClientRect().right);
        const room = innerWidth - 16 - this.blMax - 16;
        let pick = '';
        for (const s of texts) {
            let w = this.brWidth.get(s);
            if (w === undefined) {
                this.br.textContent = s;
                w = this.br.getBoundingClientRect().width;
                if (this.brWidth.size > 64) this.brWidth.clear();
                this.brWidth.set(s, w);
            }
            if (w <= room) { pick = s; break; }
        }
        if (this.br.textContent !== pick) this.br.textContent = pick;
    }

    toggleFrameStats(): void {
        this.frameStats.classList.toggle('hidden');
    }

    update(s: FlightSession, block: ArmBlock, frameMs: { p50: number; p99: number }, view?: ArmView): void {
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
        const src = view?.source ?? null;
        const kbd = src === 'keyboard';
        // a radio or gamepad gets the step-by-step card, the keyboard its keys; touch and sim the one line
        const radio = !!view && (src === 'hid' || src === 'gamepad');
        this.card.update(radio && view ? view : null, hd.armed, hd.crashed, block);
        const say = !hd.armed && !hd.crashed && block ? gateText(block, view) : '';
        const keyCard = kbd && say !== '' && !document.querySelector('.screen.radio');
        this.keys.update(keyCard, say, block);
        // keyboard: the flying keys stay in the corner once the key card is gone (armed, crashed)
        const keysLine = kbd ? (keyCard ? '' : t('hud.keysKbd')) : t('hud.keys');
        const n = t('hud.crashes', { n: hd.crashes });
        const short = t('hud.keysShort');
        this.setCorner(keysLine ? [`${n}  ·  ${keysLine}`, `${n}  ·  ${short}`, short, n] : [n]);
        // under a card the line is only spoken (visually hidden): the step, never the live throttle %
        this.gate.classList.toggle('visually-hidden', radio || kbd);
        // touch: mid-screen, clear of the pads and the ARM button it points to
        this.gate.classList.toggle('mid', src === 'touch');
        if (this.gate.textContent !== say) this.gate.textContent = say; // the same text again is announced again
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
    cinema(): void;
    import(): void;
}

/** A key as the pause menu shows it (`cap`) and as ARIA names it (`aria`, for aria-keyshortcuts). */
export interface KeyHint { cap: string; aria: string }

/**
 * Keys that do what a pause-menu item does, shown beside the item. They mirror main.ts's keydown
 * handler: P or Esc toggles the pause (so in the menu they continue), and R with the menu open runs
 * the menu's Restart. An item with no key shows none. A new binding in main.ts goes here too.
 */
export const PAUSE_KEYS: Partial<Record<keyof PauseActions, KeyHint[]>> = {
    resume: [{ cap: 'Esc', aria: 'Escape' }, { cap: 'P', aria: 'P' }],
    restart: [{ cap: 'R', aria: 'R' }]
};

export function pauseMenu(parent: HTMLElement, a: PauseActions, keys: Partial<Record<keyof PauseActions, KeyHint[]>> = PAUSE_KEYS): () => void {
    const p = panel(t('pause.title'), () => { p.close(); a.resume(); });
    p.root.classList.add('pause-menu');
    const items: [keyof PauseActions, string][] = [
        ['resume', 'pause.continue'], ['restart', 'pause.restart'], ['scene', 'pause.scene'], ['drone', 'pause.drone'],
        ['radio', 'pause.radio'], ['settings', 'pause.settings'], ['replays', 'pause.replays'], ['measure', 'pause.measure'], ['import', 'pause.import'], ['cinema', 'pause.cinema']
    ];
    for (const [act, k] of items) {
        const ks = keys[act] ?? [];
        // the caps are for the eye; a screen reader gets the same keys from aria-keyshortcuts
        const caps = ks.length ? h('span', { class: 'pm-keys', 'aria-hidden': 'true' }, ...ks.map((x) => h('kbd', {}, x.cap))) : null;
        p.body.append(h('button', { type: 'button', class: 'btn block', 'data-action': k, 'aria-keyshortcuts': ks.length ? ks.map((x) => x.aria).join(' ') : undefined, onclick: () => { p.close(); a[act](); } },
            h('span', { class: 'pm-label' }, t(k)), caps));
    }
    p.body.append(h('a', { class: 'btn block', href: `/${locale}/#contact`, target: '_blank', rel: 'noopener' }, h('span', { class: 'pm-label' }, t('pause.contact'))));
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

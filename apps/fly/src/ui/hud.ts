// The flight view's text (split from ui/flight.ts, v0.3 wave 1): Betaflight-style OSD, the arm-gate
// reason, the arm card (radio) and the key card (keyboard), the F3 frame line, the short notes a key
// leaves (H, C, V) and the top-edge banners stacked under each other. Keys are routed by
// app/keys.ts; app/builtin/hud.ts binds H and F3 to this class.
import { h, fmt } from './dom';
import { t } from '../i18n';
import type { FlightSession } from '../session';
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
            row(caps('V'), t('arm.keys.voxels')),
            row(caps('C'), t('arm.keys.walls')),
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

/** Focus in a form field (any input, a select, a text area): H is a letter or a toggle there, not the HUD key. */
export function isFormField(el: EventTarget | null): boolean {
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
}

/**
 * Guidance on the flight view (arm card, key card, touch hint, top notes, the walls box) is for
 * getting into the air: once armed and flying it goes, and it comes back when disarmed or crashed
 * (#ui.hud-flying, fly.css). A pilot saw a card hang over the whole flight. H switches every text
 * on the flight view off and on (#ui.hud-off); the buttons and the touch pads stay.
 * Built by the flight shell (app/flight.ts) and put on the page by mount() (app/builtin/hud.ts),
 * at its place among the flight view's parts.
 */
export class Hud {
    readonly root: HTMLDivElement;
    private ui: HTMLElement | null = null;
    private note = h('div', { class: 'hud-note', role: 'status', hidden: true });
    private noteTimer = 0;
    private textOff = false;
    private tl = h('div', { class: 'osd tl' });
    private tr = h('div', { class: 'osd tr' });
    private bl = h('div', { class: 'osd bl' });
    private br = h('div', { class: 'osd br' });
    private gate = h('div', { class: 'gate-msg', role: 'status', 'aria-live': 'polite' });
    // F3: display rate and estimated stick -> screen delay, then a hint when the screen is slow
    private statsMain = h('div', { 'data-testid': 'latency-line' });
    private statsHint = h('div', { 'data-testid': 'display-hint', hidden: true });
    private frameStats = h('div', { class: 'osd frame hidden' }, this.statsMain, this.statsHint);
    private card = new ArmCard(() => this.onArm?.());
    private keys = new KeyCard();
    private last = 0;
    visible = true;
    rec = false;
    /** Arm kind 'key' (no switch on the radio): the on-screen ARM / DISARM button. */
    onArm: (() => void) | null = null;

    constructor() {
        this.root = h('div', { class: 'hud' }, this.tl, this.tr, this.bl, this.br, this.gate, this.card.el, this.card.disarm, this.keys.el, this.frameStats);
    }

    /** Put the OSD on the page (once) and keep the top-edge banners stacked from now on. */
    mount(parent: HTMLElement): void {
        this.ui = parent;
        // outside .hud: it says how to get the text back while the rest is hidden
        parent.append(this.root, this.note);
        watchBanners(parent);
    }

    /** H: every text on the flight view off, or back on. */
    toggleText(): void {
        this.textOff = !this.textOff;
        this.ui?.classList.toggle('hud-off', this.textOff);
        this.root.style.display = this.visible && !this.textOff ? '' : 'none';
        this.flash(t(this.textOff ? 'hud.textOff' : 'hud.textOn'));
    }

    /** A short note under the OSD's top line (H, walls C, voxels V): what a key just did. */
    flash(text: string, ms = 2500): void {
        this.note.textContent = text;
        this.note.hidden = false;
        clearTimeout(this.noteTimer);
        this.noteTimer = window.setTimeout(() => { this.note.hidden = true; }, ms);
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
        const ui = this.ui;
        if (!ui) return; // not on the page yet
        const now = performance.now();
        if (now - this.last < 100) return;
        this.last = now;
        this.root.style.display = this.visible && !this.textOff ? '' : 'none';
        const hd = s.hud();
        // armed and in the air: the guidance outside .hud (touch hint, notes, walls box) goes too
        const flying = hd.armed && !hd.crashed;
        if (ui.classList.contains('hud-flying') !== flying) ui.classList.toggle('hud-flying', flying);
        const status = hd.crashed ? `<span class="crash">${t('hud.crash')}</span>` : hd.armed ? `<span class="armed">${t('hud.armed')}</span>` : `<span class="disarmed">${t('hud.disarmed')}</span>`;
        const mode = s.sim.ch[5] > 0.5 ? t('hud.angle') : t('hud.acro');
        // walls switched off (C): a tag the pilot must not forget, read from the flight itself each
        // time (never a copy: after a scene switch a copy said off over a flight with walls on)
        const walls = s.walls === 'off' ? ` · <span class="walls-off" data-testid="hud-walls-off">${t('hud.wallsOff')}</span>` : '';
        this.tl.innerHTML = `${status} · ${mode}${walls}${this.rec ? ` · <span class="rec">● ${t('hud.rec')}</span>` : ''}`;
        this.tr.textContent = `${fmt(hd.volts, 1)} V  ${fmt(hd.timeS, 1)} s`;
        this.bl.textContent = `THR ${hd.throttlePct}%  ${fmt(hd.speed, 1)} m/s  ALT ${fmt(hd.altitude, 1)} m`;
        const src = view?.source ?? null;
        const kbd = src === 'keyboard';
        // a radio or gamepad gets the step-by-step card, the keyboard its keys; touch and sim the one line
        const radio = !!view && (src === 'hid' || src === 'gamepad');
        this.card.update(radio && view ? view : null, hd.armed, hd.crashed, block);
        // the test pilot (?simradio=scenario) flies the model directly, past the arm gate: the gate's
        // "Calibrate your controls first" was never true for it, and it printed into every bot frame
        const say = !hd.armed && !hd.crashed && block && src !== 'sim' ? gateText(block, view) : '';
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
        this.latencyLine(s, frameMs.p50);
    }

    /**
     * Not the frame gap: "frame 33.3 ms" was read as the delay, while stick -> screen was 3-5 such
     * frames. The display rate and the renderer's estimate (measured rAF -> presentation) instead.
     */
    private latencyLine(s: FlightSession, frameP50: number): void {
        if (this.frameStats.classList.contains('hidden')) return;
        const L = s.renderer.latencyStats();
        const P = Number.isFinite(L.periodMs) ? L.periodMs : frameP50;
        const hz = Math.round(1000 / P);
        const main = t('hud.stats', { hz: Number.isFinite(hz) ? hz : '—', ms: fmt(L.inputToScreenMs, 0) });
        if (this.statsMain.textContent !== main) this.statsMain.textContent = main;
        // below 50 Hz every stage that waits for a frame waits 2x longer than at 60 Hz
        const slow = P > 20;
        this.statsHint.hidden = !slow;
        if (slow) {
            const hint = t('hud.slowDisplay', { hz, p: Math.round(P) });
            if (this.statsHint.textContent !== hint) this.statsHint.textContent = hint;
            this.statsHint.style.maxWidth = '60ch';
            this.statsHint.style.marginTop = '4px';
        }
    }
}

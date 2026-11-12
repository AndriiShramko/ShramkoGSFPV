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
import { watchTopRow } from './top-row';
import { linkLines } from './link-text';
import { keysFor } from '@gsfpv/prefs';
import { MODE2_KEYS } from '../play/keys';
import { gateSpoken, pilotCaps } from './controls-card-logic';
import { ArmOffer } from './arm-offer-logic';

/**
 * The throttle style of the radio or gamepad in use (lane center-throttle; app/builtin/throttle-style.ts sets it): the arm card
 * offers the centred style when the stick rests in the centre (ui/arm-offer-logic.ts), and in the centred style acro says in
 * one line that the throttle is direct.
 */
export interface HudThrottle {
    /** the style flying now; null: no radio or gamepad */
    style(): 'centred' | 'zero' | null;
    /** the craft flies acro now */
    acro(): boolean;
    /** the pilot took the offer (its button, the controller's arm input) */
    centred(): void;
}

/** Disarmed with a radio: what is still needed to arm, in order, with a small live radio drawing. */
class ArmCard {
    readonly el: HTMLDivElement;
    readonly disarm: HTMLButtonElement;
    private art = radioArt({ mini: true });
    private list: HTMLOListElement;
    private title: HTMLElement;
    private reason = h('p', { class: 'reason' });
    private rows: { li: HTMLLIElement; text: HTMLSpanElement }[] = [];
    private armBtn: HTMLButtonElement;
    /** "Your left stick is resting in the centre": the two ways, one button (ui/arm-offer-logic.ts says when) */
    private offer: HTMLDivElement;
    private offerKeys = h('p', { class: 'muted small' });
    /**
     * The drawing is in sight (set by `update`, which runs at the text's 10 Hz, cleared when the card hides
     * or shows only a reason): `live` then paints the knobs every frame. They are the pilot's own stick;
     * behind the text's 100 ms gate a move was drawn 59 ms after it reached the page on average, up to 135 ms
     * (frames every 33 ms), where a draw in every frame takes 17 and at most 35 ms (docs/wip/v09-e.md).
     */
    private drawn: { key: boolean; block: Exclude<ArmBlock, null> } | null = null;

    constructor(onArm: () => void, onCentred: () => void) {
        const row = (): { li: HTMLLIElement; text: HTMLSpanElement } => {
            const text = h('span');
            return { li: h('li', {}, h('span', { class: 'mk' }, tickIcon()), text), text };
        };
        this.rows = [row(), row(), row()];
        this.armBtn = h('button', { type: 'button', class: 'btn primary', 'data-action': 'hud-arm', onclick: () => onArm() }, t('arm.button'));
        this.rows[2].li.append(this.armBtn);
        this.list = h('ol', {}, ...this.rows.map((r) => r.li));
        // not a live region: the throttle % changes ten times a second. Hud.gate speaks the step instead
        this.offer = h('div', { class: 'arm-offer', 'data-testid': 'arm-offer', role: 'status', hidden: true },
            h('p', {}, t('throttle.offer.rest')),
            h('p', {}, t('throttle.offer.fpv')),
            h('button', { type: 'button', class: 'btn primary', 'data-action': 'throttle-centred', 'aria-keyshortcuts': 'J', onclick: () => onCentred() }, t('throttle.offer.button')),
            this.offerKeys);
        this.title = h('h3', {}, t('arm.card.title'));
        this.el = h('div', { class: 'arm-card hidden' }, this.art.el, h('div', {}, this.title, this.list, this.reason, this.offer));
        this.disarm = h('button', { type: 'button', class: 'btn arm-disarm hidden', 'data-action': 'hud-disarm', onclick: () => onArm() }, t('arm.disarmKey'));
    }

    update(v: ArmView | null, armed: boolean, crashed: boolean, block: ArmBlock, offer = false, centred = false, acro = false): void {
        const screenOpen = !!document.querySelector('.screen.radio');
        const key = v?.armKind === 'key';
        this.disarm.classList.toggle('hidden', !(v && key && armed && !crashed && !screenOpen));
        const show = !!v && !armed && !crashed && !screenOpen && block !== null;
        this.el.classList.toggle('hidden', !show);
        this.drawn = null;
        const offered = show && offer && !!v;
        if (this.offer.hidden === offered) this.offer.hidden = !offered;
        if (offered && v) {
            // the controller's own arm input takes it too (a switch or the DJI start/stop button); a key-armed setup has none
            const keys = v.armKind && v.armKind !== 'key' && v.armLabel ? t('throttle.offer.keys', { src: v.armLabel }) : t('throttle.offer.keysOnly');
            if (this.offerKeys.textContent !== keys) this.offerKeys.textContent = keys;
        }
        if (!v || !show || block === null) return;
        // no signal, hidden tab, crashed, no profile: only the reason, the steps do not apply. The centred style (lane
        // center-throttle) has no arming steps either: one line says how its motors start (a stick moved)
        const reasonOnly = block === 'stale' || block === 'hidden' || block === 'crashed' || block === 'noProfile';
        const plain = reasonOnly || centred;
        this.list.hidden = plain;
        // the centred style has nothing to arm: no "To arm" heading over its one line (review m2)
        this.title.hidden = centred && !reasonOnly;
        this.art.el.style.display = plain ? 'none' : '';
        this.reason.textContent = reasonOnly ? t(`arm.blocked.${block}`) : centred ? t(acro ? 'throttle.card.acro' : 'throttle.card.centred') : '';
        this.el.classList.toggle('centred', centred && !reasonOnly);
        if (plain) return;
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
        this.drawn = { key, block };
        this.paint(v, this.drawn);
    }

    /** Every frame, whatever the text's rate: the knobs and the arm lever follow the sticks where they are now. */
    live(v: ArmView | null): void {
        if (v && this.drawn) this.paint(v, this.drawn);
    }

    private paint(v: ArmView, d: { key: boolean; block: Exclude<ArmBlock, null> }): void {
        const ch = v.ch;
        const mode = v.mode;
        const k = knobsFrom({ roll: ch[0], pitch: ch[1], throttle: ch[2], yaw: ch[3] }, mode);
        const target: ArtTarget = d.block === 'center' ? { side: 'both', dir: 'centre' }
            : d.block === 'throttle' ? { side: sideOf('throttle', mode), dir: 'down' }
            : d.block === 'switch' && !d.key ? { side: 'SW', dir: 'flip' } : null;
        this.art.set({ mode, target, knobL: k.L, knobR: k.R, hold: 0, ok: false, sw: d.key ? null : ch[4] > 0, tol: 0, label: '' });
    }
}

/**
 * The pilot keyboard's key card: what to press now (arm, throttle, centre), then every pilot key, with the step that is
 * missing lit. It shows while the drone waits on the ground. The game scheme (v0.9: the mouse, W A S D, Space up, Shift down)
 * has no ground card any more: its keys are on the "How to fly" card (ui/controls-card.ts, v0.10 lane K), which opens when
 * the scan is ready and again with K or the pause menu. K no longer pins this card.
 */
class KeyCard {
    readonly el: HTMLDivElement;
    private now = h('p', { class: 'reason now' });
    private title = h('h3', {});
    private list = h('ul', { class: 'kc-list' });
    private rows: Partial<Record<'arm' | 'thr' | 'sticks', HTMLLIElement>> = {};

    constructor() {
        this.el = h('div', { class: 'arm-card key-card hidden', 'data-testid': 'key-card' }, h('div', {}, this.title, this.now, this.list));
        const caps = (...ks: string[]): HTMLSpanElement => h('span', { class: 'kc-keys' }, ...ks.map((k) => h('kbd', {}, k)));
        const row = (keys: HTMLSpanElement, text: string): HTMLLIElement => h('li', {}, keys, h('span', {}, text));
        const space = t('arm.keys.space');
        // the caps are the tables the keyboard flies with (play/keys.ts MODE2_KEYS) and the keymap's, not a list of this card's own
        const pc = pilotCaps(MODE2_KEYS, space);
        const km = (action: string): string[] => keysFor(action).map((k) => (k.cap === 'Space' ? space : k.cap));
        this.title.textContent = t('arm.keys.title');
        this.rows = {
            arm: row(caps(...km('arm.toggle')), t('arm.keys.arm')),
            thr: row(caps(...pc.throttle), t('arm.keys.throttle')),
            sticks: row(caps(...pc.sticks), t('arm.keys.sticks'))
        };
        this.list.replaceChildren(
            this.rows.arm!, this.rows.thr!,
            row(caps(...pc.yaw), t('arm.keys.yaw')),
            this.rows.sticks!,
            row(caps(...km('mode.cycle')), t('arm.keys.mode')),
            row(caps(...km('voxels.cycle')), t('arm.keys.voxels')),
            row(caps(...km('walls.toggle')), t('arm.keys.walls')),
            row(caps(...km('respawn.start')), t('arm.keys.respawn')),
            row(caps(...km('pause.toggle').reverse()), t('arm.keys.pause')),
            row(caps(...km('help.keys')), t('play.keys.toggle')));
    }

    update(show: boolean, say: string, block: ArmBlock): void {
        this.el.classList.toggle('hidden', !show);
        if (!show) return;
        if (this.now.textContent !== say) this.now.textContent = say;
        this.now.hidden = !say;
        this.rows.arm?.classList.toggle('now', block === 'switch');
        this.rows.thr?.classList.toggle('now', block === 'throttle');
        this.rows.sticks?.classList.toggle('now', block === 'center');
    }
}

/** The arm hint in the words of the input in use: keyboard and touch pilots have no arm switch. */
function gateText(block: Exclude<ArmBlock, null>, v: ArmView | undefined, centred = false, acro = false): string {
    const src = v?.source ?? null;
    // the centred style (lane center-throttle): the gate is fed the start of the motors, its 'switch' is not the pilot's;
    // the spoken line says what the card says (review m2)
    const reasonOnly = block === 'stale' || block === 'hidden' || block === 'crashed' || block === 'noProfile';
    if (centred && !reasonOnly && (src === 'hid' || src === 'gamepad')) return t(acro ? 'throttle.card.acro' : 'throttle.card.centred');
    // easy play (v0.8): no arming; the first flying key or touch starts the motors
    if (v?.easy && block !== 'hidden' && block !== 'stale') return t(src === 'touch' ? 'play.gate.touch' : 'play.gate.keys');
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
    // F3: the levels of detail at work (app/lod.ts lodLine, written by app/builtin/hud.ts)
    private statsDetail = h('div', { 'data-testid': 'detail-line', class: 'detail', hidden: true });
    // F3: how the scan is drawn and who decided it (app/drawing.ts drawingLine, written by app/builtin/hud.ts)
    private statsDrawing = h('div', { 'data-testid': 'drawing-line', class: 'detail', hidden: true });
    // F3: how the radio's or gamepad's reports arrive (interval, jitter, longest gap) and, for a slow or
    // bunched link, the note about a cable (v0.9 lane E, @gsfpv/input link.ts)
    private statsInput = h('div', { 'data-testid': 'input-line', class: 'detail', hidden: true });
    private statsLink = h('div', { 'data-testid': 'link-hint', class: 'detail', hidden: true });
    private frameStats = h('div', { class: 'osd frame hidden' }, this.statsMain, this.statsInput, this.statsLink, this.statsDetail, this.statsDrawing, this.statsHint);
    private inputAt = -1e9;
    private card = new ArmCard(() => this.onArm?.(), () => this.throttle?.centred());
    private offer = new ArmOffer();
    private offerShown = false;
    /** centred style and acro: the throttle is direct (one line under the OSD's top line) */
    private acroLine = h('div', { class: 'osd acro-thr', 'data-testid': 'acro-throttle', hidden: true });
    /** The throttle style of the controller in use (app/builtin/throttle-style.ts); null: never set (the arm card has no offer). */
    throttle: HudThrottle | null = null;
    private keys = new KeyCard();
    private last = 0;
    visible = true;
    /** the game scheme's take-off line is being drawn (set at 10 Hz by update) */
    private groundLine = false;
    /** Arm kind 'key' (no switch on the radio): the on-screen ARM / DISARM button. */
    onArm: (() => void) | null = null;

    constructor() {
        this.root = h('div', { class: 'hud' }, this.tl, this.tr, this.bl, this.br, this.gate, this.card.el, this.card.disarm, this.keys.el,
            // one column at the F3 block's place: the acro line flows under F3 when it is shown, never over it (review m7)
            h('div', { class: 'osd-col' }, this.frameStats, this.acroLine));
    }

    /**
     * Put the OSD on the page (once) and from now on keep the top-edge banners stacked and the
     * walls box and the author notice clear of the top buttons (ui/top-row.ts).
     */
    mount(parent: HTMLElement): void {
        this.ui = parent;
        // outside .hud: it says how to get the text back while the rest is hidden
        parent.append(this.root, this.note);
        watchBanners(parent);
        watchTopRow(parent);
    }

    /**
     * The game scheme waits on the ground and its take-off line is on the screen: "Click to fly with the mouse" would only
     * say the same under it (app/builtin/play.ts leaves that pill out then).
     */
    get groundLineShown(): boolean {
        return this.groundLine && this.visible && !this.textOff;
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

    /** The F3 frame line is on screen. */
    get frameStatsShown(): boolean {
        return !this.frameStats.classList.contains('hidden');
    }

    /** The F3 line about the levels of detail (app/lod.ts lodLine); null hides it. */
    setDetailLine(text: string | null): void {
        this.statsDetail.hidden = text === null;
        if (text !== null && this.statsDetail.textContent !== text) this.statsDetail.textContent = text;
    }

    /** The F3 line about the drawing (app/drawing.ts drawingLine); null hides it. */
    setDrawingLine(text: string | null): void {
        this.statsDrawing.hidden = text === null;
        if (text !== null && this.statsDrawing.textContent !== text) this.statsDrawing.textContent = text;
    }

    update(s: FlightSession, block: ArmBlock, frameMs: { p50: number; p99: number }, view?: ArmView): void {
        const ui = this.ui;
        if (!ui) return; // not on the page yet
        const now = performance.now();
        const src = view?.source ?? null;
        // a radio or gamepad gets the step-by-step card, the keyboard its keys; touch and sim the one line
        const radio = !!view && (src === 'hid' || src === 'gamepad');
        // the radio drawing is the pilot's own stick: every frame. Everything else is text, at 10 Hz
        // (a number that changes with every frame cannot be read)
        this.card.live(radio && view ? view : null);
        // every frame: a short press of the controller's arm button must not fall between two of the text's updates
        const style = radio ? this.throttle?.style() ?? null : null;
        const seen = this.visible && !this.textOff && !s.paused && !document.querySelector('.screen');
        const of = this.offer.update({
            style, block, throttle: view ? view.ch[2] : Number.NaN, presses: view?.presses ?? 0, toggle: view?.armKind === 'toggle',
            visible: seen, profileGen: view?.profileGen ?? 0, now
        });
        this.offerShown = of.show;
        if (of.accept) this.throttle?.centred();
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
        // recording: the red dot in the top-right row says it (builtin/cinema.ts), not this line
        this.tl.innerHTML = `${status} · ${mode}${walls}`;
        this.tr.textContent = `${fmt(hd.volts, 1)} V  ${fmt(hd.timeS, 1)} s`;
        this.bl.textContent = `THR ${hd.throttlePct}%  ${fmt(hd.speed, 1)} m/s  ALT ${fmt(hd.altitude, 1)} m`;
        const kbd = src === 'keyboard';
        const acro = style === 'centred' && !!this.throttle?.acro();
        this.card.update(radio && view ? view : null, hd.armed, hd.crashed, block, this.offerShown, style === 'centred', acro);
        if (this.acroLine.hidden === acro) this.acroLine.hidden = !acro;
        if (acro && !this.acroLine.textContent) this.acroLine.textContent = t('throttle.acro');
        // the test pilot (?simradio=scenario) flies the model directly, past the arm gate: the gate's
        // "Calibrate your controls first" was never true for it, and it printed into every bot frame
        const say = !hd.armed && !hd.crashed && block && src !== 'sim' ? gateText(block, view, style === 'centred', acro) : '';
        // the pilot keyboard's ground card; the game scheme's keys are on the "How to fly" card (app/builtin/how-to-fly.ts)
        const keyCard = kbd && !view?.game && say !== '' && !document.querySelector('.screen.radio');
        const easy = !!view?.easy;
        this.keys.update(keyCard, say, block);
        // keyboard: the flying keys stay in the corner once the key card is gone (armed, crashed)
        const keysLine = kbd ? (keyCard ? '' : t(easy ? 'play.hud.keys' : 'hud.keysKbd')) : t('hud.keys');
        const n = t('hud.crashes', { n: hd.crashes });
        const short = t('hud.keysShort');
        this.setCorner(keysLine ? [`${n}  ·  ${keysLine}`, `${n}  ·  ${short}`, short, n] : [n]);
        // under a card the line is only spoken (visually hidden): the step, never the live throttle %. The game scheme has no ground
        // card, so its take-off line is drawn (play.css .gate-msg.game): a pilot who closed the How to fly card unread, or switched
        // it off, still sees how to leave the ground
        const spoken = gateSpoken(src, !!view?.game);
        this.groundLine = !spoken && !!view?.game && say !== '';
        this.gate.classList.toggle('visually-hidden', spoken);
        this.gate.classList.toggle('game', !spoken && !!view?.game);
        // touch: mid-screen, clear of the pads and the ARM button it points to
        this.gate.classList.toggle('mid', src === 'touch');
        if (this.gate.textContent !== say) this.gate.textContent = say; // the same text again is announced again
        this.latencyLine(s, frameMs.p50);
        this.inputLine(view, now);
    }

    /** F3's line about the device's reports: four times a second, only while F3 is on and a radio or gamepad flies. */
    private inputLine(view: ArmView | undefined, now: number): void {
        if (this.frameStats.classList.contains('hidden')) return;
        const link = view?.link ?? null;
        if (!link) {
            this.statsInput.hidden = true;
            this.statsLink.hidden = true;
            return;
        }
        if (now - this.inputAt < 250) return;
        this.inputAt = now;
        const ll = linkLines(link(now), t, 'f3');
        this.statsInput.hidden = !ll;
        this.statsLink.hidden = !ll?.note;
        if (ll && this.statsInput.textContent !== ll.line) this.statsInput.textContent = ll.line;
        if (ll?.note && this.statsLink.textContent !== ll.note) this.statsLink.textContent = ll.note;
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

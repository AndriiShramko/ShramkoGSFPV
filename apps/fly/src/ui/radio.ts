// Controls screen and the radio setup wizard. Every decision lives in @gsfpv/input
// (CalibrationWizard); this file only draws its state: one instruction per screen on a drawing of
// a radio (which stick, which way), live channel bars, a hint with numbers when something is off,
// and a way out on every screen (Back, Start again, Cancel, the wizard's escapes, and Close / Esc,
// which leaves the whole screen with nothing changed). The radio in use gets Recalibrate and
// Reverse channels at the top, so neither hides behind "connect a device" again.
import './wizard.css';
import { ArmLatch, CalibrationWizard, STEP_IDS, channelOrder } from '@gsfpv/input';
import type { Fn, Hint, Profile, RawFrame, WizardState } from '@gsfpv/input';
import { h, clear } from './dom';
import { t } from '../i18n';
import { HidSource } from '../devices/hid';
import { GamepadSource } from '../devices/gamepad';
import { saveProfile, profileFor, downloadProfile, parseProfile, getStickMode, setStickMode } from '../controls';
import { radioArt, sideOf, knobsFrom, tickIcon } from './radio-art';
import type { ArtState, ArtTarget } from './radio-art';

export type SourceKind = 'hid' | 'gamepad' | 'touch' | 'keyboard';

export interface RadioChoice {
    kind: SourceKind;
    profile: Profile | null;
    hid?: HidSource;
    gamepad?: GamepadSource;
}

export interface RadioScreenOptions {
    /** The first open right after the scan loaded: the device choice asks "The scan is ready. How
     *  will you fly?". Left out: true for the first Controls screen of this page (a new scan is a
     *  new page, and main.ts opens Controls as soon as the scan is in). */
    firstOpen?: boolean;
}

type Subscribe = (cb: (f: RawFrame) => void) => void;
type Device = HidSource | GamepadSource;

let screensOpened = 0; // per page: tells the first open after loading from later ones

const FN4: Fn[] = ['throttle', 'yaw', 'pitch', 'roll'];
const FN_LETTER: Record<Fn | 'arm', string> = { throttle: 'T', yaw: 'R', pitch: 'E', roll: 'A', arm: 'ARM' };
const BARS: (Fn | 'arm')[] = ['throttle', 'yaw', 'pitch', 'roll', 'arm'];

const isFn = (w: string): w is Fn => w === 'roll' || w === 'pitch' || w === 'throttle' || w === 'yaw';

/** Second line under the instruction: which physical stick and which way (depends on the mode). */
function subKey(st: WizardState, mode: 1 | 2): string | null {
    const id = st.id;
    if (id === 'stir' || id === 'centre' || id === 'check') return `wizard.sub.${id}`;
    if (id === 'arm') return st.phase === 'off' ? 'wizard.sub.arm.off' : 'wizard.sub.arm.on';
    if (!isFn(id)) return null;
    const side = sideOf(id, mode);
    if (st.phase === 'push') return `wizard.sub.${side}.${id === 'throttle' || id === 'pitch' ? 'up' : 'right'}`;
    return id === 'throttle' ? `wizard.sub.${side}.down` : `wizard.sub.${side}.let`;
}

function hintText(hint: Hint): string {
    const p: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(hint.params)) p[k] = k === 'fn' ? t(`wizard.axis.${v}`) : v;
    return t(hint.key, p);
}

function isTyping(el: EventTarget | null): boolean {
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
}

function setText(el: Element, s: string): void {
    // assigning the same text again would make screen readers repeat it
    if (el.textContent !== s) el.textContent = s;
}

function toggle(el: Element, name: string, on: boolean): void {
    if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

function pct(v: number): string {
    return `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
}

export class RadioScreen {
    readonly root: HTMLDivElement;
    private body: HTMLDivElement;
    onDone: ((c: RadioChoice) => void) | null = null;
    /** Close (x) or Esc on any screen: leave with nothing changed. The caller removes the screen;
     *  remove() gives the radio in use its frame callback back. */
    onClose: (() => void) | null = null;
    wizard: CalibrationWizard | null = null;
    private hid: HidSource;
    private gp: GamepadSource;
    private current: RadioChoice | null;
    private curDev: Device | undefined; // the radio in use (with a profile), if any
    private curOnFrame: Device['onFrame'] = null; // its callback before this screen borrowed it
    private firstOpen: boolean;
    private owned = new Set<Device>(); // opened here: closed on remove() unless handed over
    private handed: Device | null = null;
    private chosen = false; // onDone was called: the flight now listens to that choice
    private gen = 0; // bumps on every screen change: stale frame callbacks and loops stop
    private raf = 0;
    private timer = 0;
    private mode: 1 | 2 = getStickMode();

    constructor(parent: HTMLElement, current: RadioChoice | null = null, opts: RadioScreenOptions = {}) {
        this.current = current;
        this.hid = current?.hid ?? new HidSource();
        this.gp = current?.gamepad ?? new GamepadSource();
        this.curDev = current?.profile ? (current.kind === 'hid' ? current.hid : current.kind === 'gamepad' ? current.gamepad : undefined) : undefined;
        this.curOnFrame = this.curDev?.onFrame ?? null;
        this.firstOpen = opts.firstOpen ?? screensOpened === 0;
        screensOpened++;
        this.body = h('div', { class: 'radio-body' });
        this.root = h('div', { class: 'screen radio interactive', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'radio-title' }, this.body);
        parent.append(this.root);
        addEventListener('keydown', this.onKey, { capture: true });
        this.choose();
    }

    /** Leave the screen with nothing changed (x and Esc on every screen). */
    close(): void {
        if (this.onClose) { this.onClose(); return; }
        // not wired (a test page): keep the radio in use, or step back to the device choice
        if (!this.keepCurrent() && this.wizard) this.choose();
    }

    /** Hand the radio in use back unchanged; false when there is none. */
    private keepCurrent(): boolean {
        const cur = this.current;
        if (!cur || !this.curDev) return false;
        this.handed = this.curDev;
        this.done(cur);
        return true;
    }

    private done(c: RadioChoice): void {
        this.chosen = true;
        this.onDone?.(c);
    }

    private closeBtn(): HTMLButtonElement {
        return h('button', { type: 'button', class: 'panel-x', 'aria-label': t('wizard.btn.close'), 'aria-keyshortcuts': 'Escape', title: `${t('wizard.btn.close')} (Esc)`, 'data-action': 'radio-close', onclick: () => this.close() }, '×');
    }

    private onKey = (e: KeyboardEvent): void => {
        const c = e.code;
        // the flight shortcuts (pause, respawn, arm) must not act behind this screen
        if (c === 'Escape' || c === 'Backspace' || c === 'KeyP' || c === 'KeyR' || c === 'Space') e.stopPropagation();
        if (c === 'Escape') {
            e.preventDefault();
            this.close();
        } else if (c === 'Backspace' && this.wizard && !isTyping(e.target)) {
            e.preventDefault();
            if (!this.wizard.back()) this.choose();
        }
    };

    /** Stop the current screen: its loops, timers and the previous wizard's frame callback. */
    private leave(): void {
        this.gen++;
        cancelAnimationFrame(this.raf);
        clearInterval(this.timer);
        this.wizard = null;
        clear(this.body);
    }

    private choose(): void {
        this.leave();
        // a radio opened here and then cancelled: let it go, picking it again asks the browser anew
        for (const d of this.owned) if (d instanceof HidSource) { d.onFrame = null; d.close(); this.owned.delete(d); }
        this.root.setAttribute('aria-labelledby', 'radio-title');
        const hidOk = HidSource.supported();
        // the accent goes to the best way that works here: no WebHID (phones, Firefox, Safari) means
        // touch sticks on a touch screen, a gamepad elsewhere; a greyed-out green button looked tappable
        const best: SourceKind = hidOk ? 'hid' : matchMedia('(pointer: coarse)').matches ? 'touch' : 'gamepad';
        const cls = (k: SourceKind): string => (!this.curDev && k === best ? 'btn primary' : 'btn');
        const gpRate = h('span', { class: 'muted small' });
        const hidStatus = h('p', { class: 'muted small radio-status', role: 'status' });
        const cur = this.current;
        const curDev = this.curDev;
        this.body.append(h('div', { class: 'radio-head' },
            h('div', {}, h('h1', { id: 'radio-title' }, t('radio.title')),
                this.firstOpen ? h('p', { class: 'radio-ask' }, t('loading.readyAsk')) : null),
            this.closeBtn()));
        if (cur && cur.profile && curDev) {
            // the radio in use: fly on, recalibrate it or reverse a channel, without connecting again
            this.body.append(h('div', { class: 'radio-current' },
                h('p', { class: 'radio-cur-name' }, t('radio.connected', { name: cur.profile.deviceName })),
                h('p', { class: 'muted small' }, t('radio.rate', { hz: Math.round(curDev.rateHz) })),
                h('div', { class: 'actions' },
                    h('button', { type: 'button', class: 'btn primary', 'data-action': 'radio-keep', onclick: () => this.keepCurrent() }, t('common.fly')),
                    h('button', { type: 'button', class: 'btn', 'data-action': 'radio-setup', onclick: () => this.setupCurrent(cur) }, t('radio.recalibrate')),
                    h('button', { type: 'button', class: 'btn', 'data-action': 'radio-reverse', onclick: () => this.checkCurrent(cur) }, t('radio.reverse')))));
        }
        this.body.append(
            h('div', { class: 'choice' },
                h('button', { type: 'button', class: cls('hid'), disabled: !hidOk, onclick: () => void this.connectHid(hidStatus) }, t('radio.hid')),
                h('p', { class: 'muted small' }, hidOk ? t('radio.hidHint') : t('preflight.noHid')),
                hidStatus),
            h('div', { class: 'choice' },
                h('button', { type: 'button', class: cls('gamepad'), onclick: () => this.connectGamepad(gpRate) }, t('radio.gamepad')),
                h('p', { class: 'muted small' }, t('radio.moveStick'), ' ', gpRate)),
            h('div', { class: 'choice' },
                h('button', { type: 'button', class: cls('touch'), onclick: () => this.done({ kind: 'touch', profile: null }) }, t('radio.touch')),
                h('p', { class: 'muted small' }, t('radio.touchHint'))),
            h('div', { class: 'choice' },
                h('button', { type: 'button', class: 'btn', 'data-action': 'radio-keyboard', onclick: () => this.done({ kind: 'keyboard', profile: null }) }, t('radio.keyboard')),
                h('p', { class: 'muted small' }, t('radio.keyboardHint'))),
            h('p', { class: 'muted small' }, t('radio.real'))
        );
        (this.body.querySelector<HTMLElement>('.btn.primary:not([disabled])') ?? this.body.querySelector<HTMLElement>('.btn:not([disabled])'))?.focus({ preventScroll: true });
    }

    /** "Recalibrate" on the radio that is already in use. */
    private setupCurrent(cur: RadioChoice): void {
        const name = cur.profile?.deviceName ?? 'radio';
        if (cur.kind === 'hid' && cur.hid) {
            const d = cur.hid;
            this.hid = d;
            this.runWizard(d.key, name, (cb) => { d.onFrame = cb; }, () => d.rateHz, 'hid');
        } else if (cur.kind === 'gamepad' && cur.gamepad) {
            const g = cur.gamepad;
            this.gp = g;
            this.runWizard(g.key, name, (cb) => { g.onFrame = cb; }, () => g.rateHz, 'gamepad');
        }
    }

    /** "Reverse channels" on the radio in use: its setup on the check screen, where each line has a
     *  Reverse toggle. A copy: Close leaves the profile in use untouched, Fly saves the copy. */
    private checkCurrent(cur: RadioChoice): void {
        if (!cur.profile) return;
        const p = structuredClone(cur.profile);
        if (cur.kind === 'hid' && cur.hid) {
            const d = cur.hid;
            this.hid = d;
            this.mount(CalibrationWizard.resume(p), d.key, p.deviceName, (cb) => { d.onFrame = cb; }, () => d.rateHz, 'hid', p);
        } else if (cur.kind === 'gamepad' && cur.gamepad) {
            const g = cur.gamepad;
            this.gp = g;
            this.mount(CalibrationWizard.resume(p), g.key, p.deviceName, (cb) => { g.onFrame = cb; }, () => g.rateHz, 'gamepad', p);
        }
    }

    private async connectHid(status: HTMLElement): Promise<void> {
        const gen = this.gen;
        const src = new HidSource();
        this.owned.add(src);
        try {
            const d = await src.request();
            if (!d || gen !== this.gen) return;
            await src.open(d);
            status.className = 'muted small radio-status';
            status.textContent = t('wizard.say.connect');
            // wait for the first report so the fingerprint includes the report length
            await new Promise<void>((res) => { src.onFrame = () => { src.onFrame = null; res(); }; setTimeout(res, 1500); });
            if (gen !== this.gen) return;
            this.hid = src;
            const name = d.productName || 'radio';
            const sub: Subscribe = (cb) => { src.onFrame = cb; };
            const saved = profileFor(src.key);
            // a saved setup is shown for checking, never handed over blindly
            if (saved) this.mount(CalibrationWizard.resume(saved), src.key, name, sub, () => src.rateHz, 'hid', saved);
            else this.runWizard(src.key, name, sub, () => src.rateHz, 'hid');
        } catch (e) {
            if (gen !== this.gen) return;
            status.className = 'error small radio-status';
            status.textContent = String((e as Error).message ?? e);
        }
    }

    private connectGamepad(rate: HTMLElement): void {
        const gp = this.gp;
        if (gp !== this.current?.gamepad) this.owned.add(gp);
        gp.start();
        rate.textContent = t('wizard.waiting');
        const gen = this.gen;
        let started = false;
        gp.onFrame = () => {
            if (gen !== this.gen) return;
            rate.textContent = t('radio.rate', { hz: Math.round(gp.rateHz) });
            if (started) return;
            started = true;
            const sub: Subscribe = (cb) => { gp.onFrame = cb; };
            const name = gp.id || 'gamepad';
            const saved = profileFor(gp.key);
            if (saved) this.mount(CalibrationWizard.resume(saved), gp.key, name, sub, () => gp.rateHz, 'gamepad', saved);
            else this.runWizard(gp.key, name, sub, () => gp.rateHz, 'gamepad');
        };
    }

    /** Also used by tests with the simulated radio (fake HID device). */
    runWizard(key: string, name: string, subscribe: Subscribe, rate: () => number, kind: SourceKind): void {
        this.mount(new CalibrationWizard(key, name), key, name, subscribe, rate, kind, null);
    }

    private finish(kind: SourceKind, p: Profile): void {
        const dev = kind === 'hid' ? this.hid : kind === 'gamepad' ? this.gp : null;
        this.handed = dev;
        this.done({ kind, profile: p, hid: kind === 'hid' ? this.hid : undefined, gamepad: kind === 'gamepad' ? this.gp : undefined });
    }

    private mount(wz: CalibrationWizard, key: string, name: string, subscribe: Subscribe, rate: () => number, kind: SourceKind, saved: Profile | null): void {
        this.leave();
        const gen = this.gen;
        this.wizard = wz;
        this.root.setAttribute('aria-labelledby', 'wz-title');
        const restart = (): void => this.runWizard(key, name, subscribe, rate, kind);
        const latch = new ArmLatch(); // live preview of a momentary arm button on the check screen
        const bad = this.hid as HidSource & { badReports?: number; lastBadLen?: number };

        // ---- layout (C.3)
        const stepEls = STEP_IDS.map((id, i) => h('li', { 'data-step': id },
            h('span', { class: 'n' }, h('span', { class: 'num' }, String(i + 1)), tickIcon()),
            h('span', { class: 'lbl' }, t(`wizard.steps.${id}`)),
            h('span', { class: 'visually-hidden' })));
        const title = h('h1', { id: 'wz-title', tabindex: -1 }, t('wizard.heading'));
        const modeBtn = h('button', { type: 'button', class: 'wz-mode', 'data-action': 'wizard-mode' });
        const say = h('p', { class: 'wz-say' });
        const sub = h('p', { class: 'wz-sub' });
        const art = radioArt();
        const count = h('p', { class: 'wz-count muted' });
        const hint = h('p', { class: 'wz-hint', role: 'status', hidden: true });
        const extra = h('div', { class: 'wz-extra' });
        const chans = h('div', { class: 'wz-chans', hidden: true });
        const rateEl = h('p', { class: 'wz-rate muted small' });
        const actions = h('div', { class: 'wz-actions' });
        const note = saved ? h('div', { class: 'wz-note' },
            h('p', {}, t('radio.saved', { name: saved.deviceName })),
            saved.wizard ? null : h('p', { class: 'warn small' }, t('wizard.oldProfile'))) : null;
        const wzEl = h('div', { class: 'wz' },
            h('ol', { class: 'wz-steps' }, ...stepEls),
            h('div', { class: 'wz-main' },
                h('div', { class: 'wz-head' }, title, h('div', { class: 'wz-head-r' }, modeBtn, this.closeBtn())),
                h('div', { class: 'wz-live', 'aria-live': 'polite' }, say, sub),
                note,
                h('div', { class: 'wz-stage' }, art.el, count),
                hint, extra, chans,
                h('div', { class: 'wz-foot' }, rateEl, h('p', { class: 'wz-kbd muted small' }, t('wizard.kbd'))),
                actions));
        this.body.append(wzEl);

        const stepsEl = wzEl.firstElementChild as HTMLElement;
        let lastCur = -1;
        let lastW = -1;
        let sig = ''; // rebuild buttons and the extra panel only when this changes
        let phaseKey = '';
        let pickOpen = false;
        let arrived: boolean[] = [];
        let startEnd: (boolean | undefined)[] = []; // push: channel parked at an end when the screen appeared
        let flyBtn: HTMLButtonElement | null = null;
        let wasCheck = false;
        let last: RawFrame | null = null;
        let chCells: { cell: HTMLElement; cov: HTMLElement; v: HTMLElement; fn: HTMLElement }[] = [];
        let live: (() => void) | null = null; // per-frame update of the extra panel
        // check screen: each row seen done at least once. The drawing then shows the first row not
        // seen yet (throttle down, flip the switch, let go), so moving the sticks to try them does
        // not make the guidance flicker
        const seen = { thr: false, arm: false, cen: false };
        // Reverse is shown against the setup as it reached the check screen, per function and
        // channel: after Back and forward again a line stays reversed
        const baseRev = new Map<string, boolean>();

        // The stick mode is asked on the stir screen, before any stick step: a Mode 1 pilot who follows
        // a Mode 2 drawing pushes pitch where it says throttle, and no later screen can tell (the
        // channels look the same either way). Not blocking: the choice is remembered, so most see it
        // already answered.
        const pickMode = (m: 1 | 2): void => { this.mode = m; setStickMode(m); setMode(); sig = ''; };
        const modeOpts = ([2, 1] as const).map((m) => h('button', { type: 'button', class: 'btn', 'data-action': `wizard-mode-${m}`, 'aria-pressed': 'false', onclick: () => pickMode(m) }, t(`wizard.mode.${m}`)));
        const modeAsk = h('div', { class: 'wz-modeask', role: 'group', 'aria-labelledby': 'wz-modeask-q' },
            h('p', { id: 'wz-modeask-q' }, t('wizard.modeAsk')), h('div', { class: 'wz-modeask-btns' }, ...modeOpts));
        const setMode = (): void => {
            modeBtn.textContent = t(`wizard.mode.${this.mode}`);
            modeBtn.setAttribute('aria-label', `${t('wizard.mode.change')}: ${t(`wizard.mode.${this.mode}`)}`);
            modeOpts.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0 ? 2 : 1) === this.mode)));
        };
        setMode();
        modeBtn.addEventListener('click', () => pickMode(this.mode === 2 ? 1 : 2));

        // push: how far the pushed stick has gone. The sign is not known before the push is
        // taken, and a channel parked at an end since the screen appeared does not count (the
        // wizard's own arrival rule), so a throttle resting at the bottom is not drawn as pushed.
        // The throttle rests at an end: its knob is drawn at the bottom (where the hand and the ghost
        // start) until a channel that was parked at an end comes through the middle.
        const pushMag = (st: WizardState): { mag: number; fromEnd: boolean } => {
            let best = 0;
            let parked = false;
            let crossed = false;
            for (const i of wz.freeChannels()) {
                const c = st.channels[i];
                if (!c || !Number.isFinite(c.lo) || !Number.isFinite(c.hi)) continue;
                const half = Math.max(0.05, (c.hi - c.lo) / 2);
                const d = Math.abs(c.v - (c.hi + c.lo) / 2) / half;
                if (startEnd[i] === undefined) startEnd[i] = d >= 0.35;
                if (d < 0.35) arrived[i] = true;
                if (arrived[i] && d > best) best = d;
                if (startEnd[i]) { parked = true; if (arrived[i]) crossed = true; }
            }
            return { mag: Math.min(1, best), fromEnd: parked && !crossed };
        };

        const armLevel = (st: WizardState): boolean | null => {
            const p = st.profile;
            if (st.id === 'check' && p?.arm?.kind === 'button' && p.arm.toggle) return last ? latch.level(p.arm, last) : false;
            return st.id === 'arm' || st.id === 'check' ? st.mapped.arm : null;
        };

        /** The check screen's next unmet row, as a wizard-style target for the drawing. */
        const checkTarget = (): WizardState['target'] => {
            if (!seen.thr) return { what: 'throttle', dir: 'down' };
            if (!seen.arm) return { what: 'arm', dir: 'flip' };
            if (!seen.cen) return { what: 'sticks', dir: 'centre' };
            return null;
        };

        const artState = (st: WizardState, sayText: string, subText: string): ArtState => {
            const mode = this.mode;
            const onCheck = st.id === 'check';
            const tg = onCheck ? checkTarget() : st.target;
            let target: ArtTarget = null;
            let also: ArtState['also'] = null;
            if (tg) {
                if (tg.what === 'sticks') target = { side: 'both', dir: tg.dir === 'stir' ? 'stir' : 'centre' };
                // the arm step says ON, then OFF; the check screen asks for the other position than now
                else if (tg.what === 'arm') target = { side: 'SW', dir: onCheck ? 'flip' : st.phase === 'off' ? 'off' : 'on' };
                else target = { side: sideOf(tg.what, mode), dir: tg.dir as 'up' | 'down' | 'right' | 'centre' };
                // "let go of both sticks" but the throttle stays down: that well shows down
                if (tg.what === 'sticks' && tg.dir === 'centre') also = { side: sideOf('throttle', mode), dir: 'down' };
            }
            const m = { roll: st.mapped.roll, pitch: st.mapped.pitch, throttle: st.mapped.throttle, yaw: st.mapped.yaw };
            const known = { L: false, R: false };
            for (const fn of FN4) if (st.assigned[fn] !== undefined) known[sideOf(fn, mode)] = true;
            if (st.phase === 'push' && !st.ok && tg && isFn(tg.what)) {
                const push = pushMag(st);
                m[tg.what] = tg.what === 'throttle' && push.fromEnd ? -1 : push.mag;
                known[sideOf(tg.what, mode)] = true;
            }
            const k = knobsFrom(m, mode);
            // the ghost keeps the other axis of that stick where it is: letting go of yaw with the
            // throttle down means the knob ends at the bottom, not in the middle of the well
            let home: [number, number] | null = null;
            let from: [number, number] | null = null;
            if (tg && isFn(tg.what)) {
                const kk = sideOf(tg.what, mode) === 'L' ? k.L : k.R;
                const sideways = tg.what === 'yaw' || tg.what === 'roll';
                home = sideways ? [0, kk[1]] : [kk[0], 0];
                // the throttle does not spring back: it is pushed up from the bottom and pulled down
                // from the top; a let-go springs back from where that stick was just pushed
                if (tg.what === 'throttle') from = [kk[0], tg.dir === 'up' ? -1 : onCheck ? 0.5 : 1];
                else if (tg.dir === 'centre') from = sideways ? [1, kk[1]] : [kk[0], 1];
            }
            return {
                mode, target, also, home, from,
                knobL: known.L ? k.L : null,
                knobR: known.R ? k.R : null,
                hold: onCheck ? 0 : st.hold, ok: onCheck ? false : st.ok, sw: armLevel(st),
                tol: tg && tg.dir === 'centre' ? 0.2 : 0,
                dimOthers: !onCheck, // every stick is being tried on the check screen
                label: `${sayText} ${subText}`.trim()
            };
        };

        const btn = (label: string, action: string, onclick: () => void, o: { primary?: boolean; big?: boolean; disabled?: boolean } = {}): HTMLButtonElement =>
            h('button', { type: 'button', class: `btn${o.primary ? ' primary' : ''}${o.big ? ' big' : ''}`, 'data-action': action, disabled: !!o.disabled, onclick }, label);

        const buildActions = (st: WizardState): void => {
            clear(actions);
            flyBtn = null;
            const can = st.can;
            const back = (): HTMLButtonElement => btn(t('wizard.btn.back'), 'wizard-back', () => { if (!wz.back()) this.choose(); }, { disabled: !can.back });
            const again = (): HTMLButtonElement => btn(t('wizard.restart'), 'wizard-restart', restart);
            const cancel = (): HTMLButtonElement => btn(t('wizard.btn.cancel'), 'wizard-cancel', () => this.choose());
            const cont = (): HTMLButtonElement | null => (can.cont ? btn(t('wizard.btn.continue'), 'wizard-continue', () => wz.cont()) : null);
            const useCur = (): HTMLButtonElement | null => (can.useCurrent ? btn(t('wizard.btn.useCurrent'), 'wizard-use-current', () => wz.useCurrent()) : null);
            const list: (HTMLElement | null)[] = [];
            if (st.id === 'connect') list.push(cancel());
            else if (st.id === 'stir') list.push(cancel(), cont(), again());
            else if (st.id === 'centre') list.push(back(), useCur(), again());
            else if (isFn(st.id) && st.phase === 'push') list.push(back(), can.pick ? btn(t('wizard.btn.pick'), 'wizard-pick', () => { pickOpen = !pickOpen; sig = ''; }) : null, again());
            else if (st.id === 'throttle') list.push(back(), cont(), again());
            else if (isFn(st.id)) list.push(back(), useCur(), again());
            else if (st.id === 'arm') {
                const noSwitch = st.hint?.key === 'wizard.hint.arm.none';
                list.push(back(), btn(t('wizard.btn.skipArm'), 'wizard-skip-arm', () => wz.skipArm(), { primary: noSwitch, disabled: !can.skipArm }), st.phase === 'off' ? cont() : null, again());
            } else if (st.id === 'check' && st.profile) {
                const p = st.profile;
                const resumed = !can.back;
                flyBtn = btn(t('common.fly'), 'wizard-done', () => { p.mode = this.mode; saveProfile(p); this.finish(kind, p); }, { primary: true, big: true, disabled: !can.fly });
                list.push(flyBtn, resumed ? btn(t('radio.recalibrate'), 'wizard-restart', restart) : back(), resumed ? null : again());
            }
            for (const el of list) if (el) actions.append(el);
        };

        /** Which way a function reads now, and the key it is compared under (function and channel). */
        const revOf = (p: Profile, f: Fn | 'arm'): { key: string; v: boolean } | null => {
            if (f !== 'arm') { const a = p.axes[f]; return a ? { key: `${f}@${a.index}`, v: a.invert } : null; }
            const a = p.arm;
            if (!a || a.kind === 'key') return null;
            return a.kind === 'axis' ? { key: `arm@ch${a.index}`, v: a.onAbove } : { key: `arm@b${a.bit}`, v: !!a.inverted };
        };
        const isReversed = (p: Profile, f: Fn | 'arm'): boolean => {
            const r = revOf(p, f);
            if (!r) return false;
            if (!baseRev.has(r.key)) baseRev.set(r.key, r.v);
            return baseRev.get(r.key) !== r.v;
        };
        /** Reverse as a toggle: pressed = this line now reads the other way than detected (or saved).
         *  It changes the profile at once, so the bar and the knob follow the new direction live. */
        const revToggle = (f: Fn | 'arm'): HTMLButtonElement => {
            const p0 = wz.state.profile;
            const b = h('button', { type: 'button', class: 'btn rev', 'data-action': `reverse-${f}`, 'aria-pressed': String(!!p0 && isReversed(p0, f)) },
                h('span', { class: 'mk', 'aria-hidden': 'true' }, tickIcon()), t('wizard.btn.reverse'));
            b.addEventListener('click', () => {
                wz.reverse(f);
                const p = wz.state.profile;
                b.setAttribute('aria-pressed', String(!!p && isReversed(p, f)));
            });
            return b;
        };

        const buildExtra = (st: WizardState): void => {
            clear(extra);
            live = null;
            if (st.id === 'stir') {
                extra.append(modeAsk);
            } else if (st.id === 'arm' && st.hint?.key === 'wizard.hint.arm.none') {
                extra.append(h('div', { class: 'wz-howto' },
                    h('h3', {}, t('wizard.howto.title')),
                    h('ol', {}, h('li', {}, t('wizard.howto.1')), h('li', {}, t('wizard.howto.2')), h('li', {}, t('wizard.howto.3'))),
                    h('p', { class: 'muted' }, t('wizard.howto.skip'))));
            } else if (isFn(st.id) && st.phase === 'push' && pickOpen && st.can.pick) {
                const fn = st.id;
                const bars: [number, HTMLElement][] = [];
                const listEl = h('div', { class: 'wz-pick-list' });
                for (const i of wz.freeChannels()) {
                    const fill = h('i');
                    bars.push([i, fill]);
                    listEl.append(h('button', { type: 'button', class: 'btn', 'data-action': `pick-ch-${i + 1}`, onclick: () => { wz.pick(i); pickOpen = false; sig = ''; } },
                        `CH${i + 1}`, h('span', { class: 'mini', 'aria-hidden': 'true' }, fill)));
                }
                extra.append(h('div', { class: 'wz-pick' }, h('p', {}, t('wizard.pick.title', { fn: t(`wizard.axis.${fn}`) })), listEl));
                live = () => {
                    for (const [i, fill] of bars) {
                        const c = wz.state.channels[i];
                        if (c) fill.style.width = pct((c.v + 1) / 2);
                    }
                };
            } else if (st.id === 'check' && st.profile) {
                const p = st.profile;
                const armKind = p.arm?.kind === 'button' && p.arm.toggle ? 'toggle' : p.arm?.kind ?? 'key';
                const row = (key: string, info = false): HTMLLIElement => h('li', { class: info ? 'info' : '' }, h('span', { class: 'mk' }, tickIcon()), h('span', {}, t(key)));
                const rThr = row('wizard.check.throttle');
                const rArm = armKind === 'key' ? row('wizard.check.armKey', true) : row(armKind === 'toggle' ? 'wizard.check.armToggle' : 'wizard.check.arm');
                const rCen = row('wizard.check.centre');
                const fills: [Fn, HTMLElement][] = [];
                const fb = h('div', { class: 'wz-fbars' });
                // arm: a big live ON / OFF beside Reverse instead of a bar, so a switch that reads the
                // wrong way round is seen here and not on the first try to arm
                let armNow: HTMLElement | null = null;
                let armHint: HTMLElement | null = null;
                for (const f of BARS) {
                    if (f === 'arm' && armKind === 'key') continue; // arming by key: nothing to show
                    // a momentary button that latches has no direction to reverse
                    const canRev = st.can.reverse && !(f === 'arm' && armKind === 'toggle');
                    if (f === 'arm') {
                        armNow = h('div', { class: 'wz-armnow', role: 'status', 'data-on': '' });
                        fb.append(h('div', { class: 'wz-fbar arm' }, h('span', {}, t('wizard.axis.arm')), armNow, canRev ? revToggle(f) : h('span')));
                        if (canRev) armHint = h('p', { class: 'wz-armnow-hint small' }, t('wizard.check.armNowHint'));
                        continue;
                    }
                    const fill = h('i');
                    fills.push([f, fill]);
                    fb.append(h('div', { class: 'wz-fbar' },
                        h('span', {}, t(`wizard.axis.${f}`)),
                        h('div', { class: `trk${f === 'throttle' ? '' : ' mid'}` }, fill),
                        canRev ? revToggle(f) : h('span')));
                }
                const src = st.armSource;
                const armText = !src ? '-' : src.kind === 'key' ? t('wizard.armSource.key') : t(`wizard.armSource.${src.kind}`, { n: src.n });
                // profile as a file: secondary, so outside the sticky bar that holds Fly
                const fileIn = h('input', { type: 'file', accept: 'application/json', class: 'visually-hidden', tabindex: -1, 'aria-hidden': 'true' }) as HTMLInputElement;
                fileIn.addEventListener('change', async () => {
                    const txt = await fileIn.files?.[0]?.text();
                    const loaded = txt ? parseProfile(txt) : null;
                    if (loaded) { saveProfile(loaded); this.finish(kind, loaded); }
                });
                extra.append(h('ul', { class: 'wz-checks', 'aria-live': 'off' }, rThr, rArm, rCen),
                    h('p', { class: 'wz-revhint muted small', hidden: !st.can.reverse }, t('wizard.reverseHint')), fb, ...(armHint ? [armHint] : []),
                    h('p', { class: 'wz-summary' }, t('wizard.summary', { order: channelOrder(p), arm: armText })),
                    h('div', { class: 'wz-files' },
                        btn(t('wizard.export'), 'wizard-export', () => { p.mode = this.mode; downloadProfile(p); }),
                        btn(t('wizard.import'), 'wizard-import', () => fileIn.click()), fileIn));
                live = () => {
                    const s = wz.state;
                    const ck = s.checks;
                    toggle(rThr, 'done', !!ck?.throttleLow);
                    if (armKind !== 'key') toggle(rArm, 'done', armKind === 'toggle' ? armLevel(s) === true : !!ck?.armOn);
                    toggle(rCen, 'done', !!ck?.centred);
                    if (armNow) {
                        const on = String(armLevel(s) === true);
                        // written on a change only: the status line is announced once per flip
                        if (armNow.dataset.on !== on) { armNow.dataset.on = on; armNow.textContent = t(on === 'true' ? 'wizard.check.armNowOn' : 'wizard.check.armNowOff'); }
                    }
                    for (const [f, fill] of fills) {
                        const v = s.mapped[f];
                        const x = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
                        if (f === 'throttle') { fill.style.left = '0'; fill.style.width = pct((x + 1) / 2); }
                        else { fill.style.left = pct(0.5 + Math.min(0, x) / 2); fill.style.width = pct(Math.abs(x) / 2); }
                    }
                };
            }
        };

        const buildChans = (n: number): void => {
            clear(chans);
            chCells = [];
            chans.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
            for (let i = 0; i < n; i++) {
                const cov = h('i', { class: 'cov' });
                const v = h('i', { class: 'v' });
                const fn = h('span', { class: 'fn' });
                const cell = h('div', { class: 'wz-ch' }, h('div', { class: 'trk' }, cov, v), h('span', {}, `CH${i + 1} `), fn, h('span', { class: 'dot', 'aria-hidden': 'true' }));
                chans.append(cell);
                chCells.push({ cell, cov, v, fn });
            }
        };

        const render = (): void => {
            const st = wz.state;
            const pk = `${st.id}|${st.phase}`;
            if (pk !== phaseKey) { phaseKey = pk; pickOpen = false; arrived = []; startEnd = []; seen.thr = seen.arm = seen.cen = false; }
            if (st.id === 'check') {
                const ck = st.checks;
                const arm = st.profile?.arm;
                if (ck?.throttleLow) seen.thr = true;
                if (!arm || arm.kind === 'key' || armLevel(st) === true) seen.arm = true;
                if (ck?.centred) seen.cen = true;
            }
            // steps list: the step gets its check as soon as its last part is taken
            const cur = STEP_IDS.indexOf(st.id);
            const stepDone = st.ok && st.phase !== 'push' && st.phase !== 'on';
            const armSkipped = st.id === 'check' && st.profile?.arm?.kind === 'key';
            if (cur !== lastCur || stepsEl.clientWidth !== lastW) {
                lastCur = cur;
                lastW = stepsEl.clientWidth;
                // phones show the steps as a row that scrolls sideways: keep the current one in view
                const li = stepEls[cur];
                if (li && stepsEl.scrollWidth > stepsEl.clientWidth) {
                    const a = stepsEl.getBoundingClientRect();
                    const b = li.getBoundingClientRect();
                    stepsEl.scrollLeft += b.left - a.left - (a.width - b.width) / 2;
                }
            }
            stepEls.forEach((li, i) => {
                const skipped = armSkipped && STEP_IDS[i] === 'arm';
                const done = !skipped && (i < cur || (i === cur && stepDone && st.id !== 'check'));
                toggle(li, 'done', done);
                toggle(li, 'skipped', skipped);
                if (i === cur) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
                setText(li.lastElementChild as HTMLElement, done ? ` (${t('wizard.steps.done')})` : '');
            });
            // instruction and drawing
            const sayText = t(st.message);
            const sk = subKey(st, this.mode);
            const subText = sk ? t(sk) : '';
            setText(say, sayText);
            setText(sub, subText);
            art.set(artState(st, sayText, subText));
            count.hidden = st.id !== 'stir';
            if (st.id === 'stir') setText(count, t('wizard.stir.count', { n: st.sticksDone }));
            // hint: what is wrong, in numbers
            let hs = st.hint ? hintText(st.hint) : '';
            // one stick already stirred to its edges and the other not yet: stirring one at a time is
            // not a USB mode problem, so that is said last
            if (st.hint?.key === 'wizard.hint.stir.few' && st.sticksDone >= 1) hs = t('wizard.hint.stir.other');
            if (kind === 'hid' && st.id === 'connect' && (bad.badReports ?? 0) > 0) hs = t('wizard.hint.badReport', { len: bad.lastBadLen ?? 0 });
            setText(hint, hs);
            hint.hidden = hs === '';
            // raw channel bars: the live feedback while the mapping is not known yet
            const chs = st.channels;
            chans.hidden = st.id === 'check' || chs.length === 0;
            if (!chans.hidden) {
                if (chs.length !== chCells.length) buildChans(chs.length);
                toggle(chans, 'dots', st.id === 'centre' || st.phase === 'release');
                for (let i = 0; i < chs.length; i++) {
                    const c = chs[i];
                    const cc = chCells[i];
                    cc.v.style.top = pct(1 - (c.v + 1) / 2);
                    const covered = Number.isFinite(c.lo) && Number.isFinite(c.hi) && c.hi >= c.lo;
                    cc.cov.style.display = covered ? '' : 'none';
                    if (covered) { cc.cov.style.top = pct(1 - (c.hi + 1) / 2); cc.cov.style.bottom = pct((c.lo + 1) / 2); }
                    toggle(cc.cell, 'ok', c.kind === 'stick' && c.cover >= 0.9);
                    toggle(cc.cell, 'sw', c.kind === 'switch');
                    toggle(cc.cell, 'still', c.still);
                    setText(cc.fn, c.fn ? FN_LETTER[c.fn] : '');
                }
            }
            setText(rateEl, chs.length ? t('radio.rate', { hz: Math.round(rate()) }) : ''); // nothing to count before the first report
            // buttons and the extra panel
            const can = st.can;
            const s2 = [pk, st.hint?.key ?? '', can.back, can.cont, can.useCurrent, can.pick, can.skipArm, can.fly, can.reverse, pickOpen, this.mode, !!st.profile].join('|');
            if (s2 !== sig) {
                sig = s2;
                const had = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                const hadFocus = actions.contains(had) || extra.contains(had);
                buildExtra(st);
                buildActions(st);
                if (st.id === 'check' && !wasCheck) flyBtn?.focus({ preventScroll: true }); // ready: Enter flies
                // keep keyboard users inside: on the same control when it is back (the mode question)
                else if (hadFocus) (had?.isConnected ? had : actions.querySelector<HTMLElement>('.btn:not([disabled])'))?.focus({ preventScroll: true });
            }
            wasCheck = st.id === 'check';
            toggle(wzEl, 'is-check', wasCheck);
            live?.();
        };

        subscribe((f) => {
            if (gen !== this.gen) return;
            last = f;
            wz.feed(f);
        });
        if (!saved) wz.start(performance.now());
        const loop = (): void => {
            if (gen !== this.gen) return;
            render();
            this.raf = requestAnimationFrame(loop);
        };
        render();
        this.raf = requestAnimationFrame(loop);
        this.timer = window.setInterval(() => { if (gen === this.gen) wz.tick(performance.now()); }, 250);
        if (!saved) title.focus({ preventScroll: true });
    }

    remove(): void {
        this.leave();
        removeEventListener('keydown', this.onKey, { capture: true });
        // the radio in use may have lent its frames to Recalibrate / Reverse channels. Closed with
        // nothing chosen: they go back to whoever had them, or the flight would get no more input
        // from it. Another source chosen: it stops feeding the flight next to the new one
        const cd = this.curDev;
        if (cd && this.handed !== cd) cd.onFrame = this.chosen ? null : this.curOnFrame;
        for (const d of this.owned) {
            if (d === this.handed) continue;
            d.onFrame = null;
            if (d instanceof HidSource) d.close();
            else d.stop();
        }
        this.owned.clear();
        this.root.remove();
    }
}

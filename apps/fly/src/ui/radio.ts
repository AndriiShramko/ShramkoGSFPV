// Controls screen and the radio setup wizard. Every decision lives in @gsfpv/input
// (CalibrationWizard); this file only draws its state and passes the pilot's presses on.
// Wizard v3 is paced by the pilot: every step is Start (the big green button, Enter or Space),
// the move, a visible result, then Next. Nothing here advances a screen by itself. Each screen has
// one instruction on a drawing of a radio (which stick, which way, how far it has gone), live
// channel bars, a hint with numbers when a press is refused, and a way out on every screen (Back,
// Start again, and Close / Esc, which leaves the whole screen with nothing changed). The radio in
// use gets Recalibrate and Reverse channels at the top, so neither hides behind "connect a device".
import './wizard.css';
import { ArmLatch, CalibrationWizard, STEP_IDS, TUNING, channelOrder } from '@gsfpv/input';
import type { ArmSource, Fn, Hint, Profile, RawFrame, StepResult, Verdict, WizardState } from '@gsfpv/input';
import { h, clear } from './dom';
import { t } from '../i18n';
import { HidSource } from '../devices/hid';
import { GamepadSource } from '../devices/gamepad';
import { saveProfile, profileFor, downloadProfile, parseProfile, getStickMode, setStickMode } from '../controls';
import { radioArt, sideOf, knobsFrom, tickIcon } from './radio-art';
import type { ArtState, ArtTarget } from './radio-art';
import { modeSwitchRow, modeRowKey } from './mode-switch-row';

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
type Cmd = () => Verdict | boolean | void;

let screensOpened = 0; // per page: tells the first open after loading from later ones

const FN4: Fn[] = ['throttle', 'yaw', 'pitch', 'roll'];
const FN_LETTER: Record<Fn | 'arm', string> = { throttle: 'T', yaw: 'R', pitch: 'E', roll: 'A', arm: 'ARM' };
// one bouncing press must not press Start and then Next of the stage it opened (spec 5.3)
const KEY_GUARD_MS = 300;
const GAUGE_TEXT_MS = 150; // the "further: 45 %" line: readable, not flickering
const REFUSAL_MS = 4000; // a refused press keeps its answer on screen at least this long
const CENTRE_TOL = 0.15; // calib.ts CENTRE_TOL: a stick counts as let go within this of its middle
const END_TOL = 0.10; // calib.ts END_TOL: a stick counts as at its end within this of it

const isFn = (w: string): w is Fn => w === 'roll' || w === 'pitch' || w === 'throttle' || w === 'yaw';

function hintText(hint: Hint): string {
    const p: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(hint.params)) p[k] = k === 'fn' ? t(`wizard.axis.${v}`) : v;
    // the arm hints name a channel ({ch}) or, for a gamepad, a button ({btn}): its own wording
    const key = hint.key === 'wizard.hint.arm.wasOn' && p.btn !== undefined && p.ch === undefined ? 'wizard.hint.arm.wasOnBtn' : hint.key;
    return t(key, p);
}

/** How a live arm channel reads, for the pick list: the value in % of -100..+100. */
function levelText(v: number): string {
    if (!Number.isFinite(v)) return '';
    const p = Math.round(Math.max(-1, Math.min(1, v)) * 100);
    return `${p > 0 ? '+' : ''}${p} %`;
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

/** A live bar: throttle filled from the left (0..100 %), the others from the middle. */
function setBar(fill: HTMLElement, v: number, fromLeft: boolean): void {
    const x = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : fromLeft ? -1 : 0;
    if (fromLeft) { fill.style.left = '0'; fill.style.width = pct((x + 1) / 2); }
    else { fill.style.left = pct(0.5 + Math.min(0, x) / 2); fill.style.width = pct(Math.abs(x) / 2); }
}

/** The arm step ended with Skip: Space / the on-screen button, no switch. */
function armKeyResult(st: WizardState): boolean {
    return st.id === 'arm' && st.stage === 'done' && st.result?.kind === 'arm' && st.result.source.kind === 'key';
}

function armText(src: ArmSource | null): string {
    if (!src) return '-';
    return src.kind === 'key' ? t('wizard.armSource.key') : t(`wizard.armSource.${src.kind}`, { n: src.n });
}

/** Where a channel rests against its collected range: in the middle, at an end, or parked between. */
function restOf(c: { v: number; lo: number; hi: number }): 'centred' | 'end' | 'parked' | null {
    if (!Number.isFinite(c.lo) || !Number.isFinite(c.hi) || c.hi < c.lo) return null;
    const half = Math.max(0.05, (c.hi - c.lo) / 2);
    const d = Math.abs(c.v - (c.hi + c.lo) / 2) / half;
    return d <= CENTRE_TOL ? 'centred' : d >= 1 - END_TOL ? 'end' : 'parked';
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
    private primary: HTMLButtonElement | null = null; // the big green button of the wizard screen
    private guardUntil = 0; // Enter / Space do nothing until then (KEY_GUARD_MS after a stage change)
    private wzBack: (() => void) | null = null; // Back of the wizard screen (Backspace)

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
            if (!e.repeat) this.wzBack?.();
        } else if ((c === 'Enter' || c === 'NumpadEnter' || c === 'Space') && this.wizard) {
            this.onEnter(e);
        }
    };

    /** Enter or Space on the wizard: the green button, unless another control has the focus (then
     *  the browser's own activation runs). Never a repeat, never right after a stage change. */
    private onEnter(e: KeyboardEvent): void {
        e.stopPropagation();
        // not even the focused button's own activation: the press that opened this stage bounced
        if (performance.now() < this.guardUntil) { e.preventDefault(); return; }
        if (e.repeat) { e.preventDefault(); return; }
        const p = this.primary;
        const el = e.target instanceof Element ? e.target : null;
        const other = !!el && el !== p && el.closest('button, a[href], input, select, textarea, summary, [contenteditable="true"]') !== null;
        if (other) return;
        e.preventDefault(); // Space would scroll; Enter on the focused primary would click it twice
        if (p && p.isConnected && !p.disabled) p.click();
    }

    /** Stop the current screen: its loops, timers and the previous wizard's frame callback. */
    private leave(): void {
        this.gen++;
        cancelAnimationFrame(this.raf);
        clearInterval(this.timer);
        this.wizard = null;
        this.primary = null;
        this.wzBack = null;
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
        // Liftoff-style: the sticks move the wizard on, no Start / Next per step (Andrii 2026-09-27)
        wz.auto = true;
        this.wizard = wz;
        this.root.setAttribute('aria-labelledby', 'wz-title');
        const restart = (): void => this.runWizard(key, name, subscribe, rate, kind);
        const latch = new ArmLatch(); // live preview of a momentary arm button on the check screen
        const bad = this.hid as HidSource & { badReports?: number; lastBadLen?: number };
        const resumed = saved !== null; // a saved setup shown for checking: nothing before its check

        // ---- layout
        const stepEls = STEP_IDS.map((id, i) => h('li', { 'data-step': id },
            h('span', { class: 'n' }, h('span', { class: 'num' }, String(i + 1)), tickIcon()),
            h('span', { class: 'lbl' }, t(`wizard.steps.${id}`)),
            h('span', { class: 'visually-hidden' })));
        const title = h('h1', { id: 'wz-title', tabindex: -1 }, t('wizard.heading'));
        const modeBtn = h('button', { type: 'button', class: 'wz-mode', 'data-action': 'wizard-mode' });
        const say = h('p', { class: 'wz-say' });
        const sub = h('p', { class: 'wz-sub' });
        const art = radioArt();
        // over the drawing while nothing is measured yet: the move comes after the green button
        const chip = h('span', { class: 'wz-chip', 'aria-hidden': 'true', hidden: true }, t('wizard.pressStart'));
        const count = h('p', { class: 'wz-count muted' });
        const gaugeT = h('p', { class: 'wz-gauge-t', 'aria-live': 'off', hidden: true });
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
                h('div', { class: 'wz-stage' }, art.el, chip, count, gaugeT),
                hint, extra, chans,
                h('div', { class: 'wz-foot' }, rateEl, h('p', { class: 'wz-kbd muted small' }, t('wizard.kbd'))),
                actions));
        this.body.append(wzEl);

        const stepsEl = wzEl.firstElementChild as HTMLElement;
        let lastCur = -1;
        let lastW = -1;
        let sig = ''; // rebuild buttons and the extra panel only when this changes
        let stageKey = ''; // id|stage: a change is a new screen (focus, key guard, resets)
        let pickOpen = false;
        let thrFromEnd = true; // throttle push: the stick rests at an end (a radio), not in the middle
        let refusal: { hint: Hint; at: number } | null = null; // the answer to the last refused press
        let gaugeAt = 0;
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
        // a result card's Reverse: pressed = reads the other way than detected on this visit
        const doneRev = new Map<string, boolean>();
        let armFlips = 0;

        const focusPrimary = (): void => {
            const p = this.primary;
            if (p && p.isConnected && !p.disabled) p.focus({ preventScroll: true });
            else title.focus({ preventScroll: true }); // Enter / Space still reach the key handler
        };

        /** Run a press; a refusal's hint is shown at once, with a nudge so a repeat is noticed. */
        const exec = (cmd: Cmd): void => {
            const v = cmd();
            // 'disabled' = pressed at the moment the stage changed under the finger: nothing to say
            if (v && typeof v === 'object' && !v.ok && v.hint.key !== 'wizard.hint.disabled') {
                refusal = { hint: v.hint, at: performance.now() };
                hint.classList.remove('flash');
                void hint.offsetWidth; // restart the animation on a repeated refusal
                hint.classList.add('flash');
            }
            render();
        };
        const goBack = (): void => {
            if (!wz.back()) { this.choose(); return; }
            render();
        };
        this.wzBack = goBack;
        /** Another per-frame update of the extra panel, next to the ones already set for it. */
        const addLive = (fn: () => void): void => {
            const prev = live;
            live = prev ? () => { prev(); fn(); } : fn;
        };

        // The stick mode is asked on the stir screen, before any stick step: a Mode 1 pilot who follows
        // a Mode 2 drawing pushes pitch where it says throttle, and no later screen can tell (the
        // channels look the same either way). Not blocking: the choice is remembered, so most see it
        // already answered.
        const pickMode = (m: 1 | 2): void => { this.mode = m; setStickMode(m); setMode(); sig = ''; };
        const modeOpts = ([2, 1] as const).map((m) => h('button', { type: 'button', class: 'btn', 'data-action': `wizard-mode-${m}`, 'aria-pressed': 'false' }, t(`wizard.mode.${m}`)));
        modeOpts.forEach((b, i) => b.addEventListener('click', (ev) => { pickMode(i === 0 ? 2 : 1); if (ev.detail > 0) focusPrimary(); }));
        const modeAsk = h('div', { class: 'wz-modeask', role: 'group', 'aria-labelledby': 'wz-modeask-q' },
            h('p', { id: 'wz-modeask-q' }, t('wizard.modeAsk')), h('div', { class: 'wz-modeask-btns' }, ...modeOpts));
        const setMode = (): void => {
            modeBtn.textContent = t(`wizard.mode.${this.mode}`);
            modeBtn.setAttribute('aria-label', `${t('wizard.mode.change')}: ${t(`wizard.mode.${this.mode}`)}`);
            modeOpts.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0 ? 2 : 1) === this.mode)));
        };
        setMode();
        modeBtn.addEventListener('click', () => pickMode(this.mode === 2 ? 1 : 2));

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

        /** The throttle push starts where the throttle rests: a radio throttle at its bottom end, a
         *  gamepad's spring throttle in the middle (the knob is drawn from there). */
        const restsAtEnd = (st: WizardState): boolean => {
            for (const i of wz.freeChannels()) {
                const c = st.channels[i];
                if (c && c.kind === 'stick' && restOf(c) === 'end') return true;
            }
            return false;
        };

        /** Second line under the instruction: which physical stick and which way (by stick mode). */
        const subText = (st: WizardState): string => {
            const id = st.id;
            if (id === 'connect') return '';
            if (id === 'stir' || id === 'centre' || id === 'check') return t(`wizard.sub.${id}`);
            if (id === 'arm') {
                if (st.stage === 'ready') return t('wizard.sub.arm.ready');
                // ON has counted: now back to OFF (the say line says so too, calib.ts)
                if (st.stage === 'active') return t(st.armFlip?.phase === 'off' ? 'wizard.sub.arm.back' : 'wizard.sub.arm.on');
                return t(armKeyResult(st) ? 'wizard.sub.arm.key' : 'wizard.sub.arm.off');
            }
            if (!isFn(id)) return '';
            const side = sideOf(id, this.mode);
            const move = t(`wizard.sub.${side}.${id === 'throttle' || id === 'pitch' ? 'up' : 'right'}`);
            if (st.stage === 'active') return move;
            if (st.stage === 'done') return t(`wizard.sub.${side}.${st.target?.dir === 'down' ? 'down' : 'let'}`);
            if (id === 'throttle' && st.target?.dir === 'down') return t(`wizard.sub.${side}.down`);
            // ready: the move is only announced, it is measured after Start
            return t('wizard.sub.afterStart', { move: move.charAt(0).toLocaleLowerCase() + move.slice(1) });
        };

        const artState = (st: WizardState, label: string): ArtState => {
            const mode = this.mode;
            const onCheck = st.id === 'check';
            // skipped: no switch to point at (Space / the ARM button arm instead)
            const tg = onCheck ? checkTarget() : armKeyResult(st) ? null : st.target;
            let target: ArtTarget = null;
            let also: ArtState['also'] = null;
            if (tg) {
                if (tg.what === 'sticks') target = { side: 'both', dir: tg.dir === 'stir' ? 'stir' : 'centre' };
                // the arm step asks OFF (ready, done) or ON (active); the check asks the other position than now
                else if (tg.what === 'arm') target = { side: 'SW', dir: onCheck || tg.dir === 'flip' ? 'flip' : tg.dir === 'off' ? 'off' : 'on' };
                else target = { side: sideOf(tg.what, mode), dir: tg.dir === 'down' || tg.dir === 'right' || tg.dir === 'centre' ? tg.dir : 'up' };
                // "let go of both sticks" but the throttle stays down: that well shows down
                if (tg.what === 'sticks' && tg.dir === 'centre') also = { side: sideOf('throttle', mode), dir: 'down' };
            }
            const m = { roll: st.mapped.roll, pitch: st.mapped.pitch, throttle: st.mapped.throttle, yaw: st.mapped.yaw };
            const known = { L: false, R: false };
            for (const fn of FN4) if (st.assigned[fn] !== undefined) known[sideOf(fn, mode)] = true;
            const g = st.stage === 'active' ? st.gauge : null;
            // measuring a push: the channel is not known yet, so the knob of the asked stick moves
            // the asked way by how far the leading channel has gone (its sign is not known either)
            if (g && tg && isFn(tg.what)) {
                const f = Math.max(0, Math.min(1, g.frac));
                m[tg.what] = tg.what === 'throttle' && thrFromEnd ? -1 + 2 * f : f;
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
                if (tg.what === 'throttle') from = tg.dir === 'up' ? (thrFromEnd ? [kk[0], -1] : null) : [kk[0], onCheck ? 0.5 : 1];
                else if (tg.dir === 'centre') from = sideways ? [1, kk[1]] : [kk[0], 1];
            }
            // arm/active: the lever as the flip seen so far reads (ON, or back at OFF once its ring
            // starts filling); nothing seen yet: grey, the wizard does not know the switch
            const fl = st.id === 'arm' && st.stage === 'active' ? st.armFlip : null;
            const sw = fl ? fl.phase === 'on' || fl.held <= 0 : armLevel(st);
            return {
                mode, target, also, home, from,
                knobL: known.L ? k.L : null,
                knobR: known.R ? k.R : null,
                hold: onCheck ? 0 : st.hold,
                ok: !onCheck && st.stage === 'done' && tg !== null,
                sw,
                swHold: fl ? fl.held : 0,
                tol: tg && tg.dir === 'centre' ? 0.2 : 0,
                dimOthers: !onCheck, // every stick is being tried on the check screen
                preview: !onCheck && st.preview,
                gauge: g ? { frac: g.frac, zone: g.zone } : null,
                label
            };
        };

        const btn = (label: string, action: string, onclick: () => void, o: { primary?: boolean; big?: boolean; disabled?: boolean; accent?: boolean } = {}): HTMLButtonElement => {
            const b = h('button', { type: 'button', class: `btn${o.primary || o.accent ? ' primary' : ''}${o.big ? ' big' : ''}`, 'data-action': action, 'data-primary': !!o.primary, disabled: !!o.disabled }, label);
            // a mouse or finger press leaves the focus on that button; Enter / Space belong to the
            // green button, so the focus goes back there (keyboard users keep theirs)
            b.addEventListener('click', (ev) => { onclick(); if (ev.detail > 0 && !o.primary && this.wizard === wz) focusPrimary(); });
            return b;
        };

        const buildActions = (st: WizardState): void => {
            clear(actions);
            this.primary = null;
            const can = st.can;
            const list: (HTMLElement | null)[] = [];
            let prim: HTMLButtonElement | null = null;
            if (st.id === 'check' && st.profile) {
                const p = st.profile;
                prim = btn(t('common.fly'), 'wizard-done', () => { p.mode = this.mode; saveProfile(p); this.finish(kind, p); }, { primary: true, big: true, disabled: !can.fly });
            } else if (!wz.auto && st.stage === 'ready') {
                prim = btn(t('wizard.btn.start'), 'wizard-start', () => exec(() => wz.begin(performance.now())), { primary: true, big: true, disabled: !can.begin });
            } else if (!wz.auto && st.stage === 'active') {
                const label = st.id === 'stir' ? 'wizard.btn.done' : st.id === 'centre' ? 'wizard.btn.measure' : 'wizard.btn.next';
                prim = btn(t(label), 'wizard-next', () => exec(() => wz.next(performance.now())), { primary: true, big: true, disabled: !can.next });
            } else if (!wz.auto && st.stage === 'done') {
                prim = btn(t('wizard.btn.next'), 'wizard-next', () => exec(() => wz.next(performance.now())), { primary: true, big: true, disabled: !can.next });
            }
            // auto pacing: no button to press; the sticks move it on (Enter / Space still do the same)
            list.push(prim);
            // the escapes of this stage, then Back and Start again (every screen, rule 6)
            if (st.id === 'centre' && st.stage === 'active' && can.measureAnyway) list.push(btn(t('wizard.btn.measureAnyway'), 'wizard-measure-anyway', () => exec(() => wz.measureAnyway())));
            if (isFn(st.id) && st.stage === 'active' && can.pick) list.push(btn(t('wizard.btn.pick'), 'wizard-pick', () => { pickOpen = !pickOpen; sig = ''; render(); }));
            // every arm stage, also after a switch was found (the pilot may rather arm with Space)
            if (st.id === 'arm' && can.skipArm && !armKeyResult(st)) {
                const noSwitch = st.hint?.key === 'wizard.hint.arm.none';
                list.push(btn(t('wizard.btn.skipArm'), 'wizard-skip-arm', () => exec(() => wz.skipArm()), { accent: noSwitch }));
            }
            list.push(btn(t('wizard.btn.back'), 'wizard-back', goBack));
            list.push(btn(resumed && st.id === 'check' ? t('radio.recalibrate') : t('wizard.restart'), 'wizard-restart', restart));
            for (const el of list) if (el) actions.append(el);
            this.primary = prim;
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
         *  It changes the capture at once, so the bar and the knob follow the new direction live. */
        const revToggle = (f: Fn | 'arm', pressed: () => boolean): HTMLButtonElement => {
            const b = h('button', { type: 'button', class: 'btn rev', 'data-action': `reverse-${f}`, 'aria-pressed': String(pressed()) },
                h('span', { class: 'mk', 'aria-hidden': 'true' }, tickIcon()), t('wizard.btn.reverse'));
            b.addEventListener('click', (ev) => {
                wz.reverse(f);
                if (f === 'arm') armFlips++;
                b.setAttribute('aria-pressed', String(pressed()));
                render();
                // a mouse press: Enter / Space belong to the green button again (it would flip back)
                if (ev.detail > 0) focusPrimary();
            });
            return b;
        };
        const checkRev = (f: Fn | 'arm'): HTMLButtonElement => revToggle(f, () => { const p = wz.state.profile; return !!p && isReversed(p, f); });

        const armNowEl = (): HTMLElement => h('div', { class: 'wz-armnow', role: 'status', 'data-on': '' });
        const setArmNow = (el: HTMLElement, on: boolean | null): void => {
            const v = String(on === true);
            // written on a change only: the status line is announced once per flip
            if (el.dataset.on !== v) { el.dataset.on = v; el.textContent = t(v === 'true' ? 'wizard.check.armNowOn' : 'wizard.check.armNowOff'); }
        };

        /** The result of a finished stage, live until the pilot presses Next (spec 5.5). */
        const resultCard = (st: WizardState, r: StepResult): HTMLElement => {
            const head = (text: string): HTMLElement => h('p', { class: 'wz-result-h' }, h('span', { class: 'mk', 'aria-hidden': 'true' }, tickIcon()), h('span', {}, text));
            const chList = (a: number[]): string => (a.length ? a.map((i) => `CH${i + 1}`).join(', ') : '-');
            const card = h('div', { class: `wz-result ${r.kind}`, 'data-result': r.kind });
            if (r.kind === 'stir') {
                card.append(head(t('wizard.result.stir', { list: chList(r.sticks) })), h('p', { class: 'muted' }, t('wizard.result.switches', { list: chList(r.switches) })));
            } else if (r.kind === 'centre') {
                const ul = h('ul', { class: 'wz-centres' });
                for (const c of r.centres) {
                    const txt = c.ch === r.end ? t('wizard.result.end', { ch: c.ch + 1 }) : `CH${c.ch + 1}: ${c.pct >= 0 ? '+' : ''}${c.pct.toFixed(1)} %`;
                    ul.append(h('li', {}, txt));
                }
                if (r.end >= 0 && !r.centres.some((c) => c.ch === r.end)) ul.append(h('li', {}, t('wizard.result.end', { ch: r.end + 1 })));
                card.append(head(t('wizard.result.centre')), ul);
            } else if (r.kind === 'fn') {
                const f = r.fn;
                const k = `${f}@${r.ch}`;
                if (!doneRev.has(k)) doneRev.set(k, !!st.inverted[f]);
                const inv = h('p', { class: 'wz-result-inv small', hidden: !st.inverted[f] }, t('wizard.result.inv'));
                const fill = h('i');
                const down = st.target?.dir === 'down';
                card.append(head(t('wizard.result.fn', { fn: t(`wizard.axis.${f}`), ch: r.ch + 1 })), inv,
                    h('div', { class: 'wz-fbar' }, h('span', {}, t(`wizard.axis.${f}`)), h('div', { class: `trk${f === 'throttle' ? '' : ' mid'}` }, fill),
                        st.can.reverse ? revToggle(f, () => !!wz.state.inverted[f] !== doneRev.get(k)) : h('span')),
                    h('p', { class: 'wz-result-next' }, t(down ? 'wizard.result.thrDown' : 'wizard.result.letGo')));
                addLive(() => {
                    const s = wz.state;
                    setBar(fill, s.mapped[f], f === 'throttle');
                    inv.hidden = !s.inverted[f];
                });
            } else {
                const src = r.source;
                card.append(head(t('wizard.result.arm', { src: armText(src) })));
                if (src.kind !== 'key') {
                    const now = armNowEl();
                    const canRev = st.can.reverse; // a level switch; a momentary button has no direction
                    card.append(h('div', { class: 'wz-fbar arm' }, h('span', {}, t('wizard.axis.arm')), now, canRev ? revToggle('arm', () => armFlips % 2 === 1) : h('span')));
                    // which channel was taken, as it reads now: the pilot sees it is the switch in hand
                    let lvl: (() => void) | null = null;
                    if (src.kind === 'ch') {
                        const fill = h('i');
                        const val = h('span', { class: 'val' });
                        card.append(h('div', { class: 'wz-fbar lvl' }, h('span', {}, `CH${src.n}`), h('div', { class: 'trk' }, fill), val));
                        lvl = () => { const c = wz.state.channels[src.n - 1]; const v = c ? c.v : NaN; setBar(fill, v, true); setText(val, levelText(v)); };
                    }
                    card.append(h('p', { class: 'wz-result-next' }, t('wizard.result.armTry')));
                    // a momentary button reads nothing by itself: it latches like in flight, and the
                    // tap that was just taken turned it ON
                    const tap = src.kind === 'button' && !canRev ? new ArmLatch() : null;
                    if (tap) tap.on = true;
                    const tapMap = src.kind === 'button' ? { kind: 'button' as const, bit: src.n - 1, toggle: true } : null;
                    addLive(() => { setArmNow(now, tap ? tap.level(tapMap, last) : wz.state.mapped.arm); lvl?.(); });
                } else card.append(h('p', { class: 'wz-result-next' }, t('wizard.result.armKey')));
            }
            return card;
        };

        /** The check (rule 5): one row per function with its channel, a live bar, Reverse and Set
         *  again; the arm row with its live ON / OFF. Then the checklist, summary and files. */
        const checkPanel = (st: WizardState, p: Profile): void => {
            const can = st.can;
            const armKind = p.arm?.kind === 'button' && p.arm.toggle ? 'toggle' : p.arm?.kind ?? 'key';
            const redo = (f: Fn | 'arm', label = t('wizard.btn.redo')): HTMLButtonElement | null =>
                (can.redo ? btn(label, `wizard-redo-${f}`, () => exec(() => wz.redo(f))) : null);
            const rows = h('div', { class: 'wz-rows' });
            const fills: [Fn, HTMLElement][] = [];
            for (const f of FN4) {
                const a = p.axes[f];
                const fill = h('i');
                fills.push([f, fill]);
                rows.append(h('div', { class: 'wz-row', 'data-fn': f },
                    h('span', { class: 'nm' }, t(`wizard.axis.${f}`)),
                    h('span', { class: 'ch' }, a ? `CH${a.index + 1}` : '-'),
                    h('div', { class: `trk${f === 'throttle' ? '' : ' mid'}` }, fill),
                    h('div', { class: 'acts' }, can.reverse ? checkRev(f) : null, redo(f))));
            }
            // arm: a big live ON / OFF instead of a bar, so a switch that reads the wrong way round is
            // seen here and not on the first try to arm
            let armNow: HTMLElement | null = null;
            if (armKind === 'key') {
                rows.append(h('div', { class: 'wz-row arm', 'data-fn': 'arm' },
                    h('span', { class: 'nm' }, t('wizard.axis.arm')), h('span', { class: 'ch wide' }, t('wizard.armSource.key')),
                    h('div', { class: 'acts' }, redo('arm', t('wizard.btn.redoArm')))));
            } else {
                armNow = armNowEl();
                const canRev = can.reverse && armKind !== 'toggle'; // a momentary button that latches has no direction
                rows.append(h('div', { class: 'wz-row arm', 'data-fn': 'arm' },
                    h('span', { class: 'nm' }, t('wizard.axis.arm')), h('span', { class: 'ch' }, armText(st.armSource)), armNow,
                    h('div', { class: 'acts' }, canRev ? checkRev('arm') : null, redo('arm'))));
            }
            // the radio's flight-mode switch: found by a flip, no press (mode-switch-row.ts)
            const modeRow = modeSwitchRow(wz, (l, a, f) => btn(l, a, f), () => { sig = ''; render(); });
            rows.append(modeRow.el);
            const row = (k: string, info = false): HTMLLIElement => h('li', { class: info ? 'info' : '' }, h('span', { class: 'mk' }, tickIcon()), h('span', {}, t(k)));
            const rThr = row('wizard.check.throttle');
            const rArm = armKind === 'key' ? row('wizard.check.armKey', true) : row(armKind === 'toggle' ? 'wizard.check.armToggle' : 'wizard.check.arm');
            const rCen = row('wizard.check.centre');
            // profile as a file: secondary, so outside the sticky bar that holds Fly
            const fileIn = h('input', { type: 'file', accept: 'application/json', class: 'visually-hidden', tabindex: -1, 'aria-hidden': 'true' }) as HTMLInputElement;
            fileIn.addEventListener('change', async () => {
                const txt = await fileIn.files?.[0]?.text();
                const loaded = txt ? parseProfile(txt) : null;
                if (loaded) { saveProfile(loaded); this.finish(kind, loaded); }
            });
            extra.append(rows, h('p', { class: 'wz-revhint muted small', hidden: !can.reverse }, t('wizard.reverseHint')));
            if (armKind !== 'key' && armKind !== 'toggle' && can.reverse) extra.append(h('p', { class: 'wz-armnow-hint small' }, t('wizard.check.armNowHint')));
            extra.append(
                h('ul', { class: 'wz-checks', 'aria-live': 'off' }, rThr, rArm, rCen),
                h('p', { class: 'wz-summary' }, t('wizard.summary', { order: channelOrder(p), arm: armText(st.armSource) })),
                h('div', { class: 'wz-files' },
                    btn(t('wizard.export'), 'wizard-export', () => { p.mode = this.mode; downloadProfile(p); }),
                    btn(t('wizard.import'), 'wizard-import', () => fileIn.click()), fileIn));
            live = () => {
                const s = wz.state;
                const ck = s.checks;
                toggle(rThr, 'done', !!ck?.throttleLow);
                if (armKind !== 'key') toggle(rArm, 'done', armKind === 'toggle' ? armLevel(s) === true : !!ck?.armOn);
                toggle(rCen, 'done', !!ck?.centred);
                if (armNow) setArmNow(armNow, armLevel(s));
                for (const [f, fill] of fills) setBar(fill, s.mapped[f], f === 'throttle');
                modeRow.live();
            };
        };

        /** arm/active: the two halves of the flip, ON then back OFF, and where it was seen. */
        const flipPanel = (): HTMLElement => {
            const stepOn = h('li', {}, h('span', { class: 'mk', 'aria-hidden': 'true' }, tickIcon()), h('span', {}, t('wizard.arm.flipOn')));
            const stepOff = h('li', {}, h('span', { class: 'mk', 'aria-hidden': 'true' }, tickIcon()), h('span', {}, t('wizard.arm.flipOff')));
            const src = h('p', { class: 'wz-flip-src' });
            const only = h('p', { class: 'wz-flip-only muted small', hidden: true });
            addLive(() => {
                const s = wz.state;
                const fl = s.armFlip;
                const back = fl?.phase === 'off';
                toggle(stepOn, 'done', back);
                toggle(stepOn, 'now', !back);
                toggle(stepOff, 'now', back);
                setText(src, fl ? t('wizard.arm.seen', { src: armText(fl.src) }) : t('wizard.arm.nothing'));
                only.hidden = s.picked === null;
                if (s.picked !== null) setText(only, t('wizard.arm.listening', { ch: s.picked + 1 }));
            });
            return h('div', { class: 'wz-flip' }, h('ol', { class: 'wz-flip-steps' }, stepOn, stepOff), src, only);
        };

        /** Every arm stage (Liftoff's clickable dots): each channel that is not a stick, live, to
         *  pick by hand. A pick listens to that channel only; the flip ON and OFF is still needed. */
        const armPickPanel = (st: WizardState): HTMLElement | null => {
            const list = wz.freeChannels();
            if (!st.can.pick || list.length === 0) return null;
            const rows: { i: number; b: HTMLButtonElement; fill: HTMLElement; val: HTMLElement }[] = [];
            const listEl = h('div', { class: 'wz-arm-list' });
            for (const i of list) {
                const fill = h('i');
                const val = h('span', { class: 'val' });
                const b = btn(`CH${i + 1}`, `pick-ch-${i + 1}`, () => exec(() => wz.pick(i, performance.now())));
                b.classList.add('wz-armch');
                b.append(h('span', { class: 'bar', 'aria-hidden': 'true' }, fill), val);
                listEl.append(b);
                rows.push({ i, b, fill, val });
            }
            const title = st.stage === 'done' ? (armKeyResult(st) ? 'wizard.arm.pickSwitch' : 'wizard.arm.pickOther') : 'wizard.arm.pickTitle';
            addLive(() => {
                const s = wz.state;
                const seen = s.armFlip?.src.kind === 'ch' ? s.armFlip.src.n - 1 : -1;
                const got = s.result?.kind === 'arm' && s.result.source.kind === 'ch' ? s.result.source.n - 1 : -1;
                for (const r of rows) {
                    const c = s.channels[r.i];
                    const v = c ? c.v : NaN;
                    setBar(r.fill, v, true);
                    setText(r.val, levelText(v));
                    toggle(r.b, 'seen', r.i === seen);
                    toggle(r.b, 'picked', r.i === s.picked);
                    toggle(r.b, 'taken', r.i === got);
                    const pressed = String(r.i === s.picked || r.i === got);
                    if (r.b.getAttribute('aria-pressed') !== pressed) r.b.setAttribute('aria-pressed', pressed);
                }
            });
            return h('div', { class: 'wz-pick arm' }, h('p', {}, t(title)), listEl, h('p', { class: 'muted small' }, t('wizard.arm.pickHint')));
        };

        const buildExtra = (st: WizardState): void => {
            clear(extra);
            live = null;
            const r = st.result;
            if (st.id === 'stir' && st.stage !== 'done') {
                extra.append(modeAsk);
            } else if (st.id === 'arm' && st.stage !== null) {
                if (st.stage === 'active') extra.append(flipPanel());
                else if (st.stage === 'done' && r) extra.append(resultCard(st, r));
                const pick = armPickPanel(st);
                if (pick) extra.append(pick);
                if (st.stage !== 'done' && st.hint?.key === 'wizard.hint.arm.none') {
                    extra.append(h('div', { class: 'wz-howto' },
                        h('h3', {}, t('wizard.howto.title')),
                        h('ol', {}, h('li', {}, t('wizard.howto.1')), h('li', {}, t('wizard.howto.2')), h('li', {}, t('wizard.howto.3'))),
                        h('p', { class: 'muted' }, t('wizard.howto.skip'))));
                }
            } else if (isFn(st.id) && st.stage === 'active' && pickOpen && st.can.pick) {
                const fn = st.id;
                const bars: [number, HTMLElement][] = [];
                const listEl = h('div', { class: 'wz-pick-list' });
                for (const i of wz.freeChannels()) {
                    const fill = h('i');
                    bars.push([i, fill]);
                    listEl.append(btn(`CH${i + 1}`, `pick-ch-${i + 1}`, () => { pickOpen = false; sig = ''; exec(() => wz.pick(i)); }));
                    listEl.lastElementChild?.append(h('span', { class: 'mini', 'aria-hidden': 'true' }, fill));
                }
                extra.append(h('div', { class: 'wz-pick' }, h('p', {}, t('wizard.pick.title', { fn: t(`wizard.axis.${fn}`) })), listEl));
                live = () => {
                    for (const [i, fill] of bars) {
                        const c = wz.state.channels[i];
                        if (c) fill.style.width = pct((c.v + 1) / 2);
                    }
                };
            } else if (st.stage === 'done' && r) {
                extra.append(resultCard(st, r));
            } else if (st.id === 'check' && st.profile) {
                checkPanel(st, st.profile);
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

        /** The hint line: the answer to a refused press first, then what the wizard says. */
        const hintOf = (st: WizardState, now: number): string => {
            let hn: Hint | null = st.hint;
            if (refusal && (!hn || hn.key === refusal.hint.key || now - refusal.at < REFUSAL_MS)) hn = hn && hn.key === refusal.hint.key ? hn : refusal.hint;
            if (kind === 'hid' && st.id === 'connect' && (bad.badReports ?? 0) > 0) return t('wizard.hint.badReport', { len: bad.lastBadLen ?? 0 });
            if (!hn) return '';
            // the gauge line under the drawing already says "two channels move"
            if (hn.key === 'wizard.hint.push.two' && st.stage === 'active' && st.gauge?.zone === 'two') return '';
            // one stick already stirred to its edges and the other not yet: stirring one at a time is
            // not a USB mode problem, so that is said last
            if (hn.key === 'wizard.hint.stir.few' && st.sticksDone >= 1) return t('wizard.hint.stir.other');
            return hintText(hn);
        };

        const render = (): void => {
            if (gen !== this.gen) return;
            const st = wz.state;
            const now = performance.now();
            // Skip on arm/done replaces the switch with the key without leaving the stage: a new result
            const rs = st.result?.kind === 'arm' ? armText(st.result.source) : '';
            const sk = `${st.id}|${st.stage ?? ''}|${rs}`;
            const changed = sk !== stageKey;
            if (changed) {
                stageKey = sk;
                this.guardUntil = now + KEY_GUARD_MS;
                pickOpen = false;
                refusal = null;
                gaugeAt = 0;
                doneRev.clear();
                armFlips = 0;
                seen.thr = seen.arm = seen.cen = false;
                if (st.id === 'throttle' && st.stage === 'active') thrFromEnd = restsAtEnd(st);
            }
            if (st.id === 'check') {
                const ck = st.checks;
                const arm = st.profile?.arm;
                if (ck?.throttleLow) seen.thr = true;
                if (!arm || arm.kind === 'key' || armLevel(st) === true) seen.arm = true;
                if (ck?.centred) seen.cen = true;
            }
            // steps list: a step gets its tick when its result is shown or it lies behind
            const cur = STEP_IDS.indexOf(st.id);
            const armIdx = STEP_IDS.indexOf('arm');
            const checkIdx = STEP_IDS.indexOf('check');
            const armSkipped = st.armSource?.kind === 'key' && st.id !== 'arm';
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
                // setting one step again from the check: every other step keeps its capture
                const behind = i < cur || (st.redoing && i !== cur && i < checkIdx);
                const skipped = armSkipped && i === armIdx && behind;
                const done = !skipped && (behind || (i === cur && st.stage === 'done'));
                toggle(li, 'done', done);
                toggle(li, 'skipped', skipped);
                if (i === cur) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
                setText(li.lastElementChild as HTMLElement, done ? ` (${t('wizard.steps.done')})` : '');
            });
            // instruction and drawing
            const sayText = t(armKeyResult(st) ? 'wizard.say.arm.key' : st.message);
            const sText = subText(st);
            setText(say, sayText);
            setText(sub, sText);
            art.set(artState(st, `${sayText} ${sText}`.trim()));
            chip.hidden = wz.auto || st.stage !== 'ready';
            count.hidden = st.id !== 'stir' || st.stage === 'done';
            if (!count.hidden) setText(count, t('wizard.stir.count', { n: st.sticksDone }));
            // how far the push has gone, in words beside the gauge
            const g = st.stage === 'active' && isFn(st.id) ? st.gauge : null;
            gaugeT.hidden = !g;
            if (g && now - gaugeAt >= GAUGE_TEXT_MS) {
                gaugeAt = now;
                const p = Math.round(Math.max(0, Math.min(1, g.frac)) * 100);
                const txt = g.zone === 'two' ? hintText({ key: 'wizard.hint.push.two', params: { a: g.ch + 1, b: g.other + 1 } })
                    : g.zone === 'enough' ? t('wizard.gauge.hold')
                        : g.zone === 'rest' ? t('wizard.gauge.wait') : t('wizard.gauge.further', { pct: p });
                setText(gaugeT, txt);
                for (const z of ['rest', 'tiny', 'almost', 'enough', 'two']) toggle(gaugeT, `z-${z}`, g.zone === z);
            }
            // hint: what is wrong, in numbers
            const hs = hintOf(st, now);
            setText(hint, hs);
            hint.hidden = hs === '';
            // raw channel bars: the live feedback while the mapping is not known yet
            const chs = st.channels;
            const measuring = st.stage === 'ready' || st.stage === 'active';
            // arm: the pick list under the drawing shows the channels (live, clickable) instead
            chans.hidden = chs.length === 0 || st.id === 'arm' || !(st.id === 'stir' || (measuring && st.id !== 'check'));
            if (!chans.hidden) {
                if (chs.length !== chCells.length) buildChans(chs.length);
                const onCentre = st.id === 'centre';
                toggle(chans, 'dots', onCentre);
                const lead = g && g.zone !== 'rest' ? g.ch : -1;
                for (let i = 0; i < chs.length; i++) {
                    const c = chs[i];
                    const cc = chCells[i];
                    cc.v.style.top = pct(1 - (c.v + 1) / 2);
                    const covered = Number.isFinite(c.lo) && Number.isFinite(c.hi) && c.hi >= c.lo;
                    cc.cov.style.display = covered ? '' : 'none';
                    if (covered) { cc.cov.style.top = pct(1 - (c.hi + 1) / 2); cc.cov.style.bottom = pct((c.lo + 1) / 2); }
                    toggle(cc.cell, 'ok', c.kind === 'stick' && c.cover >= TUNING.STIR_COVER);
                    toggle(cc.cell, 'sw', c.kind === 'switch');
                    toggle(cc.cell, 'still', c.still);
                    // centre: amber while it moves, red when a stick stays between its middle and its end
                    toggle(cc.cell, 'park', onCentre && c.kind === 'stick' && c.still && restOf(c) === 'parked');
                    toggle(cc.cell, 'lead', i === lead);
                    setText(cc.fn, c.fn ? FN_LETTER[c.fn] : '');
                }
            }
            setText(rateEl, chs.length ? t('radio.rate', { hz: Math.round(rate()) }) : ''); // nothing to count before the first report
            // buttons and the extra panel
            const can = st.can;
            const s2 = [sk, st.hint?.key === 'wizard.hint.arm.none', can.begin, can.next, can.back, can.pick, can.skipArm, can.measureAnyway, can.fly, can.reverse, can.redo,
                st.result?.kind ?? '', st.redoing, pickOpen, this.mode, !!st.profile, modeRowKey(st)].join('|');
            if (s2 !== sig) {
                sig = s2;
                const had = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                const hadFocus = !!had && (actions.contains(had) || extra.contains(had));
                buildExtra(st);
                buildActions(st);
                // a new screen: the focus on its green button, so Enter / Space press it
                if (changed) focusPrimary();
                // keep keyboard users inside: on the same control when it is back (the mode question)
                else if (hadFocus) { if (had?.isConnected) had.focus({ preventScroll: true }); else focusPrimary(); }
            } else if (changed) focusPrimary();
            toggle(wzEl, 'is-check', st.id === 'check');
            toggle(wzEl, 'is-ready', st.stage === 'ready');
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
        if (!saved && !this.primary) title.focus({ preventScroll: true });
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

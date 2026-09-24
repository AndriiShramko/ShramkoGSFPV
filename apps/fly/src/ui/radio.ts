// Controls screen and calibration wizard UI. The decisions live in @gsfpv/input (CalibrationWizard);
// this file shows one action per screen, live bars, and the result.
import { CalibrationWizard, channelOrder, mapFrame } from '@gsfpv/input';
import type { Profile, RawFrame } from '@gsfpv/input';
import { h, clear } from './dom';
import { t } from '../i18n';
import { HidSource } from '../devices/hid';
import { GamepadSource } from '../devices/gamepad';
import { saveProfile, profileFor, downloadProfile, parseProfile } from '../controls';

export type SourceKind = 'hid' | 'gamepad' | 'touch' | 'keyboard';

export interface RadioChoice {
    kind: SourceKind;
    profile: Profile | null;
    hid?: HidSource;
    gamepad?: GamepadSource;
}

export class RadioScreen {
    readonly root: HTMLDivElement;
    private body: HTMLDivElement;
    onDone: ((c: RadioChoice) => void) | null = null;
    private hid = new HidSource();
    private gp = new GamepadSource();
    wizard: CalibrationWizard | null = null;

    constructor(parent: HTMLElement) {
        this.body = h('div', { class: 'radio-body' });
        this.root = h('div', { class: 'screen radio interactive' }, h('h1', {}, t('radio.title')), this.body);
        parent.append(this.root);
        this.choose();
    }

    private choose(): void {
        clear(this.body);
        const hidOk = HidSource.supported();
        const touchOk = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
        const gpRate = h('span', { class: 'muted small' });
        this.body.append(
            h('div', { class: 'choice' },
                h('button', { type: 'button', class: 'btn primary', disabled: !hidOk, onclick: () => this.connectHid() }, t('radio.hid')),
                h('p', { class: 'muted small' }, hidOk ? t('radio.hidHint') : t('preflight.noHid'))),
            h('div', { class: 'choice' },
                h('button', { type: 'button', class: 'btn', onclick: () => this.connectGamepad(gpRate) }, t('radio.gamepad')),
                h('p', { class: 'muted small' }, t('radio.moveStick'), ' ', gpRate)),
            h('div', { class: 'choice' },
                h('button', { type: 'button', class: 'btn', onclick: () => this.onDone?.({ kind: 'touch', profile: null }) }, t('radio.touch')),
                h('p', { class: 'muted small' }, t('radio.touchHint'), touchOk ? '' : '')),
            h('div', { class: 'choice' },
                h('button', { type: 'button', class: 'btn', onclick: () => this.onDone?.({ kind: 'keyboard', profile: null }) }, t('radio.keyboard'))),
            h('p', { class: 'muted small' }, t('radio.real'))
        );
    }

    private async connectHid(): Promise<void> {
        try {
            const d = await this.hid.request();
            if (!d) return;
            await this.hid.open(d);
            // wait for the first report so the fingerprint includes the report length
            await new Promise<void>((res) => { const prev = this.hid.onFrame; this.hid.onFrame = (f) => { this.hid.onFrame = prev; res(); void f; }; setTimeout(res, 1500); });
            const saved = profileFor(this.hid.key);
            if (saved) { this.onDone?.({ kind: 'hid', profile: saved, hid: this.hid }); return; }
            this.runWizard(this.hid.key, d.productName || 'radio', (cb) => { this.hid.onFrame = cb; }, () => this.hid.rateHz, 'hid');
        } catch (e) {
            this.body.prepend(h('p', { class: 'error' }, String((e as Error).message ?? e)));
        }
    }

    private connectGamepad(rate: HTMLElement): void {
        this.gp.start();
        rate.textContent = t('wizard.waiting');
        let started = false;
        this.gp.onFrame = () => {
            rate.textContent = t('radio.rate', { hz: Math.round(this.gp.rateHz) });
            if (started) return;
            started = true;
            const saved = profileFor(this.gp.key);
            if (saved) { this.onDone?.({ kind: 'gamepad', profile: saved, gamepad: this.gp }); return; }
            this.runWizard(this.gp.key, this.gp.id || 'gamepad', (cb) => { this.gp.onFrame = cb; }, () => this.gp.rateHz, 'gamepad');
        };
    }

    /** Also used by tests with the simulated radio (fake HID device). */
    runWizard(key: string, name: string, subscribe: (cb: (f: RawFrame) => void) => void, rate: () => number, kind: SourceKind): void {
        const wz = new CalibrationWizard(key, name);
        this.wizard = wz;
        clear(this.body);
        const title = h('h2', {}, t('wizard.title'));
        const msg = h('p', { class: 'wizard-msg', 'aria-live': 'polite' });
        const bar = h('div', { class: 'progress' }, h('i'));
        const rateEl = h('p', { class: 'muted small' });
        const anim = h('div', { class: 'stick-anim' });
        const bars = h('div', { class: 'bars' });
        const actions = h('div', { class: 'actions' });
        this.body.append(title, msg, bar, anim, rateEl, bars, actions);
        const ch = new Float32Array(8);
        let started = false;
        subscribe((f: RawFrame) => {
            if (!started) { started = true; wz.start(f.t); }
            const st = wz.feed(f);
            msg.textContent = t(st.error && st.step !== 3 ? st.error : st.message) + (st.error === 'wizard.waiting' ? ` — ${t('wizard.waiting')}` : '');
            msg.setAttribute('data-step', String(st.step));
            (bar.firstChild as HTMLElement).style.width = `${Math.round(st.progress * 100)}%`;
            anim.setAttribute('data-prompt', st.prompt ?? '');
            rateEl.textContent = t('radio.rate', { hz: Math.round(rate()) });
            if (st.step === 6 && st.profile) {
                mapFrame(st.profile, f, ch);
                this.showBars(bars, ch, st.profile);
                if (!actions.firstChild) {
                    saveProfile(st.profile);
                    const p = st.profile;
                    const fileIn = h('input', { type: 'file', accept: 'application/json', class: 'visually-hidden', id: 'prof-in' }) as HTMLInputElement;
                    fileIn.addEventListener('change', async () => {
                        const txt = await fileIn.files?.[0]?.text();
                        const loaded = txt ? parseProfile(txt) : null;
                        if (loaded) { saveProfile(loaded); this.onDone?.({ kind, profile: loaded, hid: kind === 'hid' ? this.hid : undefined, gamepad: kind === 'gamepad' ? this.gp : undefined }); }
                    });
                    actions.append(
                        h('p', { class: 'ok' }, `${t('wizard.ready')} · ${channelOrder(p)}${channelOrder(p) === 'AETR' || channelOrder(p) === 'TAER' ? ` · ${t('wizard.mode2')}` : ''}`),
                        h('button', { type: 'button', class: 'btn primary', 'data-action': 'wizard-done', onclick: () => this.onDone?.({ kind, profile: p, hid: kind === 'hid' ? this.hid : undefined, gamepad: kind === 'gamepad' ? this.gp : undefined }) }, t('common.fly')),
                        h('button', { type: 'button', class: 'btn', onclick: () => downloadProfile(p) }, t('wizard.export')),
                        h('label', { class: 'btn', for: 'prof-in' }, t('wizard.import')), fileIn,
                        h('button', { type: 'button', class: 'btn', onclick: () => this.runWizard(key, name, subscribe, rate, kind) }, t('wizard.restart'))
                    );
                }
            }
        });
        msg.textContent = t('wizard.step1');
    }

    private showBars(el: HTMLElement, ch: Float32Array, p: Profile): void {
        if (!el.firstChild) {
            for (const [k, i] of [['throttle', 2], ['yaw', 3], ['pitch', 1], ['roll', 0], ['arm', 4]] as const) {
                el.append(h('div', { class: 'bar-row', 'data-ch': String(i) }, h('span', {}, t(`wizard.axis.${k}`)), h('div', { class: 'bar' }, h('i'))));
            }
        }
        for (const row of el.children) {
            const i = Number(row.getAttribute('data-ch'));
            const v = ch[i];
            const fill = row.querySelector('i') as HTMLElement;
            fill.style.width = `${Math.round(((v + 1) / 2) * 100)}%`;
        }
        void p;
    }

    remove(): void {
        this.root.remove();
    }
}

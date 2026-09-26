// One place where every input source ends up: raw device frames -> calibration profile ->
// channels -> arm gate -> the flight session. Profiles live in localStorage (try/catch) keyed by
// the device fingerprint, versioned, and can be downloaded / loaded as a file.

import { ArmGate, ArmLatch, mapFrame } from '@gsfpv/input';
import type { Profile, RawFrame, ArmBlock } from '@gsfpv/input';
import type { FlightSession } from './session';
import { t } from './i18n';

const KEY = 'gsfpv.profiles.v1';
const MODE_KEY = 'gsfpv.stickMode';
const LAST_KEY = 'gsfpv.lastInput';

export type InputKind = 'hid' | 'gamepad' | 'touch' | 'keyboard';

/** The input flown last time, so the next scan starts with it instead of the Controls screen. */
export interface LastInput {
    kind: InputKind;
    /** device fingerprint of a radio or gamepad (its saved profile's key) */
    key?: string;
}

export function loadLastInput(): LastInput | null {
    try {
        const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as LastInput | null;
        return v && (v.kind === 'hid' || v.kind === 'gamepad' || v.kind === 'touch' || v.kind === 'keyboard') ? v : null;
    } catch {
        return null;
    }
}

export function saveLastInput(v: LastInput): void {
    try {
        localStorage.setItem(LAST_KEY, JSON.stringify(v));
    } catch {
        /* storage blocked: the Controls screen asks again next time */
    }
}

/** Stick mode for the drawings only (which stick is the throttle); never used for mapping. */
export function getStickMode(): 1 | 2 {
    try {
        return localStorage.getItem(MODE_KEY) === '1' ? 1 : 2;
    } catch {
        return 2;
    }
}

export function setStickMode(m: 1 | 2): void {
    try {
        localStorage.setItem(MODE_KEY, String(m));
    } catch {
        /* storage blocked: the choice lasts until reload */
    }
}

export function loadProfiles(): Record<string, Profile> {
    try {
        const s = localStorage.getItem(KEY);
        return s ? (JSON.parse(s) as Record<string, Profile>) : {};
    } catch {
        return {};
    }
}

export function saveProfile(p: Profile): void {
    try {
        const all = loadProfiles();
        all[p.deviceKey] = p;
        localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
        /* storage blocked: the profile still works for this session */
    }
}

export function profileFor(key: string): Profile | null {
    return loadProfiles()[key] ?? null;
}

export function downloadProfile(p: Profile): void {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gsfpv-profile-${p.deviceName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function parseProfile(text: string): Profile | null {
    try {
        const p = JSON.parse(text) as Profile;
        if (p.version !== 1 || !p.axes || !p.deviceKey) return null;
        // an arm input this version cannot read must not load as "no arm switch"
        const kind = (p.arm as { kind?: unknown } | null)?.kind;
        if (p.arm && kind !== 'axis' && kind !== 'button' && kind !== 'key') return null;
        return p;
    } catch {
        return null;
    }
}

/** What the HUD's "to arm" card needs: channels before the gate and how this profile arms. */
export interface ArmView {
    ch: Float32Array; // mapped channels before the arm gate (roll, pitch, throttle, yaw, arm, mode)
    armKind: 'axis' | 'button' | 'toggle' | 'key' | null;
    armLabel: string; // "CH5", "button 3", or the Space / ARM text
    mode: 1 | 2;
    source: Controls['source'];
}

/** Routes mapped channels through the arm gate into the session. */
export class Controls {
    gate = new ArmGate();
    profile: Profile | null = null;
    private latch = new ArmLatch(); // keyboard arm and momentary arm buttons
    private armView: ArmView;
    private ch = new Float32Array([0, 0, -1, 0, -1, -1, 0, 0]);
    private out = new Float32Array(8);
    lastSampleAt = -1e9;
    private lastTick = 0;
    source: 'hid' | 'gamepad' | 'touch' | 'keyboard' | 'sim' | null = null;
    private session: FlightSession;
    block: ArmBlock = 'noProfile';

    constructor(session: FlightSession) {
        this.session = session;
        this.armView = { ch: this.ch, armKind: null, armLabel: '', mode: 2, source: null };
    }

    /**
     * Use a profile (or none). A new profile starts disarmed: a fresh gate wants the switch seen
     * OFF and every stick through its centre again, so a switch left ON under the old mapping (or
     * another device) cannot arm the new one.
     */
    setProfile(p: Profile | null): void {
        this.profile = p;
        this.latch.reset();
        this.gate = new ArmGate();
        this.block = this.gate.block;
    }

    /** A raw device frame through the current profile. */
    raw(f: RawFrame): void {
        if (!this.profile) return;
        mapFrame(this.profile, f, this.ch);
        this.ch[4] = this.latch.level(this.profile.arm, f) ? 1 : -1;
        this.push(f.t);
    }

    /** Space or the on-screen ARM button, for a profile that arms with the key (no switch). */
    toggleArm(): void {
        if (this.profile?.arm?.kind !== 'key') return;
        this.latch.toggle();
        this.ch[4] = this.latch.on ? 1 : -1;
        this.push(performance.now()); // act at once, not at the next radio report
    }

    /** For the HUD; the same object every call (the HUD reads it at 10 Hz). */
    view(): ArmView {
        const v = this.armView;
        const a = this.profile?.arm ?? null;
        v.armKind = !a ? null : a.kind === 'button' ? (a.toggle ? 'toggle' : 'button') : a.kind;
        v.armLabel = !a ? '' : a.kind === 'axis' ? t('wizard.armSource.ch', { n: a.index + 1 }) : a.kind === 'button' ? t('wizard.armSource.button', { n: a.bit + 1 }) : t('wizard.armSource.key');
        v.mode = this.profile?.mode ?? getStickMode();
        v.source = this.source;
        return v;
    }

    /** Already-mapped channels (touch sticks, keyboard, simulated radio at channel level); `id`: latency probe. */
    channels(ch: ArrayLike<number>, tMs: number, id?: number): void {
        for (let i = 0; i < 8; i++) this.ch[i] = ch[i] ?? 0;
        this.push(tMs, id);
    }

    private push(tMs: number, id?: number): void {
        // staleness is about when the page last HEARD from the device (arrival), not the event's
        // own timestamp: a touch event can be stamped 40 ms before the last keep-alive
        this.lastSampleAt = performance.now();
        this.out.set(this.ch);
        const profileOk = this.profile !== null || this.source === 'touch' || this.source === 'keyboard' || this.source === 'sim';
        const fakeProfile = profileOk ? ({} as Profile) : null;
        this.out[4] = this.gate.update(fakeProfile, this.ch, 0, document.visibilityState === 'visible', this.session.sim?.crashed ?? false);
        this.block = this.gate.block;
        this.dropLatch();
        this.session.input(this.out, tMs, id);
    }

    /** A latched arm request the gate refused (or a crash / stale input) must not stay pending. */
    private dropLatch(): void {
        const a = this.profile?.arm;
        const latched = !!a && (a.kind === 'key' || (a.kind === 'button' && !!a.toggle));
        if (!latched || !this.latch.on) return;
        if (!this.gate.armed || this.gate.block === 'crashed' || this.gate.block === 'stale') {
            this.latch.reset();
            this.ch[4] = -1;
        }
    }

    /** Called every frame: disarm on stale input or hidden tab even when no new sample arrives. */
    tick(now: number): void {
        // A frame that itself comes late means the main thread stalled: queued device reports have
        // not been delivered yet, so silence proves nothing this frame. Touch and keyboard live in
        // the page and cannot drop out; only a radio or a gamepad can go stale. A connected gamepad
        // repeats its held values (gamepad.ts), so a pad that reports only changes stays armed
        // with the sticks still; a radio that stops sending or a pad that is gone still disarms.
        const stalled = now - this.lastTick > 80;
        this.lastTick = now;
        const remote = this.source === 'hid' || this.source === 'gamepad';
        const age = remote && !stalled ? now - this.lastSampleAt : 0;
        if (this.gate.armed && (age > 100 || document.visibilityState !== 'visible')) {
            this.out.set(this.ch);
            this.out[4] = this.gate.update({} as Profile, this.ch, age, document.visibilityState === 'visible', this.session.sim.crashed);
            this.block = this.gate.block;
            this.dropLatch();
            this.session.input(this.out, now);
        }
    }
}

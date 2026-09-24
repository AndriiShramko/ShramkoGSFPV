// One place where every input source ends up: raw device frames -> calibration profile ->
// channels -> arm gate -> the flight session. Profiles live in localStorage (try/catch) keyed by
// the device fingerprint, versioned, and can be downloaded / loaded as a file.

import { ArmGate, mapFrame } from '@gsfpv/input';
import type { Profile, RawFrame, ArmBlock } from '@gsfpv/input';
import type { FlightSession } from './session';

const KEY = 'gsfpv.profiles.v1';

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
        return p;
    } catch {
        return null;
    }
}

/** Routes mapped channels through the arm gate into the session. */
export class Controls {
    readonly gate = new ArmGate();
    profile: Profile | null = null;
    private ch = new Float32Array([0, 0, -1, 0, -1, -1, 0, 0]);
    private out = new Float32Array(8);
    lastSampleAt = -1e9;
    private lastTick = 0;
    source: 'hid' | 'gamepad' | 'touch' | 'keyboard' | 'sim' | null = null;
    private session: FlightSession;
    block: ArmBlock = 'noProfile';

    constructor(session: FlightSession) {
        this.session = session;
    }

    /** A raw device frame through the current profile. */
    raw(f: RawFrame): void {
        if (!this.profile) return;
        mapFrame(this.profile, f, this.ch);
        this.push(f.t);
    }

    /** Already-mapped channels (touch sticks, keyboard, simulated radio at channel level). */
    channels(ch: ArrayLike<number>, tMs: number): void {
        for (let i = 0; i < 8; i++) this.ch[i] = ch[i] ?? 0;
        this.push(tMs);
    }

    private push(tMs: number): void {
        // staleness is about when the page last HEARD from the device (arrival), not the event's
        // own timestamp: a touch event can be stamped 40 ms before the last keep-alive
        this.lastSampleAt = performance.now();
        this.out.set(this.ch);
        const profileOk = this.profile !== null || this.source === 'touch' || this.source === 'keyboard' || this.source === 'sim';
        const fakeProfile = profileOk ? ({} as Profile) : null;
        this.out[4] = this.gate.update(fakeProfile, this.ch, 0, document.visibilityState === 'visible', this.session.sim?.crashed ?? false);
        this.block = this.gate.block;
        this.session.input(this.out, tMs);
    }

    /** Called every frame: disarm on stale input or hidden tab even when no new sample arrives. */
    tick(now: number): void {
        // A frame that itself comes late means the main thread stalled: queued device reports have
        // not been delivered yet, so silence proves nothing this frame. Touch and keyboard live in
        // the page and cannot drop out; only a radio or a gamepad can go stale.
        const stalled = now - this.lastTick > 80;
        this.lastTick = now;
        const remote = this.source === 'hid' || this.source === 'gamepad';
        const age = remote && !stalled ? now - this.lastSampleAt : 0;
        if (this.gate.armed && (age > 100 || document.visibilityState !== 'visible')) {
            this.out.set(this.ch);
            this.out[4] = this.gate.update({} as Profile, this.ch, age, document.visibilityState === 'visible', this.session.sim.crashed);
            this.block = this.gate.block;
            this.session.input(this.out, now);
        }
    }
}

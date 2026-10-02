// One place where every input source ends up: raw device frames -> calibration profile ->
// channels -> arm gate -> the flight session. Profiles (keyed by the device fingerprint, version
// 1), the input flown last time and the stick mode live in the page's preferences store
// (@gsfpv/prefs, app/prefs.ts: the collection radioProfiles and the setting input.stickMode), so
// they are exported, imported and erased with every other setting. The first v0.3 boot moved v0.2's
// own keys (gsfpv.profiles.v1, gsfpv.lastInput, gsfpv.stickMode) into it; those keys are only read
// by that migration and never written again (packages/prefs migrate.ts), so a rollback still finds
// them. A profile can also be downloaded / loaded as a file.
//
// The flight mode (design B.2): ch[5] is the pilot's mode (prefs flight.mode, set by
// app/builtin/modes.ts) unless the radio's profile has a mode switch, which then decides. The arm
// gate keeps a craft armed through a crash and its respawn while respawn.keepArmed is on (C.3).

import { ArmGate, ArmLatch, mapFrame, validModeSwitch } from '@gsfpv/input';
import type { Profile, RawFrame, ArmBlock } from '@gsfpv/input';
import { MODE_CHANNEL, modeFromChannel } from '@gsfpv/sim-core';
import type { FlightMode } from '@gsfpv/sim-core';
import { LEGACY_KEYS } from '@gsfpv/prefs';
import type { PrefsStore, RadioProfileItem } from '@gsfpv/prefs';
import type { FlightSession } from './session';
import { t } from './i18n';
import { pagePrefs } from './app/prefs';

export type InputKind = 'hid' | 'gamepad' | 'touch' | 'keyboard';

/** The input flown last time, so the next scan starts with it instead of the Controls screen. */
export interface LastInput {
    kind: InputKind;
    /** device fingerprint of a radio or gamepad (its saved profile's key) */
    key?: string;
}

/**
 * The page's store (boot.ts opens it before anything here runs). Without one (a test page, a lab
 * tool) nothing is remembered: no profiles, stick mode 2. Blocked storage is the store's matter:
 * it keeps the values in memory for this page and shows its banner.
 */
let storeOf: () => PrefsStore | null = pagePrefs;

/** Tests: the store these functions use. */
export function useStore(get: () => PrefsStore | null): void {
    storeOf = get;
}

export function loadLastInput(): LastInput | null {
    const v = storeOf()?.collection('radioProfiles').last ?? null;
    return v && (v.kind === 'hid' || v.kind === 'gamepad' || v.kind === 'touch' || v.kind === 'keyboard') ? { ...v } : null;
}

export function saveLastInput(v: LastInput): void {
    storeOf()?.updateCollection('radioProfiles', (d) => { d.last = v.key ? { kind: v.kind, key: v.key } : { kind: v.kind }; });
}

/** Stick mode for the drawings only (which stick is the throttle); never used for mapping. */
export function getStickMode(): 1 | 2 {
    return storeOf()?.get('input.stickMode') === '1' ? 1 : 2;
}

export function setStickMode(m: 1 | 2): void {
    storeOf()?.set('input.stickMode', String(m));
}

/**
 * Every saved profile this version can fly with, by device key. One whose mode switch cannot be
 * read loads without it (its sticks and arm must never be lost over an extra) and says so.
 */
export function loadProfiles(): Record<string, Profile> {
    const store = storeOf();
    if (!store) return {};
    reportMigration(store);
    const out: Record<string, Profile> = {};
    for (const [key, item] of Object.entries(store.collection('radioProfiles').items)) {
        const p = checkProfile(item);
        if (p) out[key] = p;
    }
    return out;
}

export function saveProfile(p: Profile): void {
    const copy = JSON.parse(JSON.stringify(p)) as RadioProfileItem;
    storeOf()?.updateCollection('radioProfiles', (d) => { d.items[p.deviceKey] = copy; });
}

export function profileFor(key: string): Profile | null {
    const all = loadProfiles();
    return Object.hasOwn(all, key) ? all[key] : null;
}

let reported: PrefsStore | null = null;
/**
 * The first v0.3 boot moved v0.2's profiles into the store. Any it could not read stay in the old
 * key (never deleted, see the header) and are reported here, not dropped in silence.
 */
function reportMigration(store: PrefsStore): void {
    if (reported === store) return;
    reported = store;
    for (const i of store.migrated?.ignored ?? []) {
        if (i.key === LEGACY_KEYS.profiles || i.key === LEGACY_KEYS.lastInput) console.warn(`radio setups: ${i.key} was not moved into the settings (${i.why}); the old copy stays in this browser`);
    }
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
        return checkProfile(JSON.parse(text));
    } catch {
        return null;
    }
}

/**
 * A profile from a file or the store, read as v0.2 read it: version 1, a device key, axes, and an
 * arm input this version reads (one it cannot read must not load as "no arm switch"). The mode
 * switch is optional: without one it is any older profile; one this version cannot read is
 * dropped and the profile kept.
 */
export function checkProfile(v: unknown): Profile | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const p = v as Profile;
    if (p.version !== 1 || !p.axes || typeof p.axes !== 'object' || !p.deviceKey) return null;
    const kind = (p.arm as { kind?: unknown } | null)?.kind;
    if (p.arm && kind !== 'axis' && kind !== 'button' && kind !== 'key') return null;
    if (p.modeSwitch === undefined) return p;
    const ms = validModeSwitch(p.modeSwitch);
    const out: Profile = { ...p };
    if (ms) out.modeSwitch = ms;
    else {
        delete out.modeSwitch;
        console.warn(`radio setup ${String(p.deviceName)}: its mode switch could not be read; it flies without one`);
    }
    return out;
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
    /** respawn.keepArmed: on by default (A.8), set by app/builtin/modes.ts from the store */
    private keepArmed = true;
    gate = new ArmGate({ keepArmedAfterCrash: this.keepArmed });
    profile: Profile | null = null;
    /** The pilot's flight mode (prefs flight.mode, app/builtin/modes.ts): ch[5] unless the radio's switch decides. */
    mode: FlightMode = 'angle';
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

    /** A new scene (E.4): the same input, profile and arm gate feed the new session. */
    setSession(session: FlightSession): void {
        this.session = session;
    }

    /**
     * Use a profile (or none). A new profile starts disarmed: a fresh gate wants the switch seen
     * OFF and every stick through its centre again, so a switch left ON under the old mapping (or
     * another device) cannot arm the new one.
     */
    setProfile(p: Profile | null): void {
        this.profile = p;
        this.latch.reset();
        this.gate = new ArmGate({ keepArmedAfterCrash: this.keepArmed });
        this.block = this.gate.block;
    }

    /**
     * respawn.keepArmed (design C.3, item 23): a switch left on through a crash arms the respawned
     * craft with no new flip. Applies to the gate in use at once and to every new one.
     */
    get keepArmedAfterCrash(): boolean {
        return this.keepArmed;
    }

    set keepArmedAfterCrash(on: boolean) {
        this.keepArmed = on;
        this.gate.keepArmedAfterCrash = on;
    }

    /** The radio's mode switch sets the mode (a radio or gamepad whose profile has one); the pilot's mode is not used then. */
    radioDecides(): boolean {
        const p = this.profile;
        return (this.source === 'hid' || this.source === 'gamepad') && !!p && (!!p.modeSwitch || !!p.angleMode);
    }

    /** The mode flying now: the radio switch's position, or the pilot's mode. */
    flyingMode(): FlightMode {
        return this.radioDecides() ? modeFromChannel(this.ch[5]) : this.mode;
    }

    /**
     * The pilot picked another mode (the chip, M, settings). Keyboard and touch send nothing while
     * nothing moves, so it goes out now; a radio or gamepad carries it with its next report (8 ms
     * at 125 Hz): a sample re-sent here would hide a radio that went silent from the stale check.
     */
    setMode(m: FlightMode): void {
        if (m === this.mode) return;
        this.mode = m;
        if ((this.source === 'keyboard' || this.source === 'touch') && this.lastSampleAt > 0) this.push(performance.now());
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
        this.fill();
        const profileOk = this.profile !== null || this.source === 'touch' || this.source === 'keyboard' || this.source === 'sim';
        const fakeProfile = profileOk ? ({} as Profile) : null;
        this.out[4] = this.gate.update(fakeProfile, this.ch, 0, document.visibilityState === 'visible', this.session.sim?.crashed ?? false);
        this.block = this.gate.block;
        this.dropLatch();
        this.session.input(this.out, tMs, id);
    }

    /** The channels as they go out: the pilot's mode on ch[5] unless the radio's switch decides (the bot pilot sets its own). */
    private fill(): void {
        this.out.set(this.ch);
        if (this.source !== 'sim' && !this.radioDecides()) this.out[5] = MODE_CHANNEL[this.mode];
    }

    /**
     * A latched arm request the gate refused (or a crash / stale input) must not stay pending. A
     * crash with keepArmed is the exception: the latch is the switch the gate passes on to the
     * respawn (C.3), like a radio's switch left on.
     */
    private dropLatch(): void {
        const a = this.profile?.arm;
        const latched = !!a && (a.kind === 'key' || (a.kind === 'button' && !!a.toggle));
        if (!latched || !this.latch.on) return;
        const b = this.gate.block;
        if (b === 'stale' || (b === 'crashed' ? !this.keepArmed : !this.gate.armed)) {
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
            this.fill();
            this.out[4] = this.gate.update({} as Profile, this.ch, age, document.visibilityState === 'visible', this.session.sim.crashed);
            this.block = this.gate.block;
            this.dropLatch();
            this.session.input(this.out, now);
        }
    }
}

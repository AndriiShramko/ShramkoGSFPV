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
// v0.7: a profile's channel functions (Profile.switches, @gsfpv/input switches.ts; the Switches
// screen) decide the arm and the mode instead when it has them, and their action ranges run app
// actions (onSwitchAction, wired to the key router by app/builtin/switches.ts).

import { ArmGate, ArmLatch, SwitchActionWatch, armByRanges, inputName, knownDevice, mapFrame, profileArmLevel, radioSetsMode, readChannelTable, readSwitches, validModeSwitch } from '@gsfpv/input';
import type { ChannelTable, LinkStats, Profile, RawFrame, ArmBlock, RadioDevice, SwitchAction, SwitchInput } from '@gsfpv/input';
import { MODE_CHANNEL, modeFromChannel } from '@gsfpv/sim-core';
import type { FlightMode } from '@gsfpv/sim-core';
import { LEGACY_KEYS } from '@gsfpv/prefs';
import type { PrefsStore, RadioProfileItem } from '@gsfpv/prefs';
import type { FlightSession } from './session';
import { t } from './i18n';
import { pagePrefs } from './app/prefs';

export type InputKind = 'hid' | 'gamepad' | 'touch' | 'keyboard';

/**
 * A switch input as text, the one naming of @gsfpv/input inputName through the wizard's strings:
 * the device's own channel when its profile has a channel table (`table`, Profile.channels: "CH5" is
 * a DJI controller's flight-mode switch), else "CH6" on a USB radio (buttons too: CH9..CH32), "CH5"
 * or "button 3" on a gamepad; a two-bit switch with no channel of its own "CH13/14" or "buttons 5/6".
 */
export function inputLabel(input: SwitchInput, device: RadioDevice, table?: ChannelTable): string {
    const n = inputName(input, device, table);
    if ('a' in n) return t(`controllers.input.${n.kind}`, { a: n.a, b: n.b });
    if (n.kind === 'axis') return t('controllers.input.axis', { n: n.n });
    return t(n.kind === 'ch' ? 'wizard.armSource.ch' : 'wizard.armSource.button', { n: n.n });
}

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
    if (p.modeSwitch === undefined && p.switches === undefined && p.channels === undefined && p.known === undefined) return p;
    const out: Profile = { ...p };
    if (p.channels !== undefined) {
        // the device's channel numbering (a recognised controller's): names only, so one that cannot be read goes and the profile stays
        const table = readChannelTable(p.channels);
        if (table) out.channels = table;
        else {
            delete out.channels;
            console.warn(`radio setup ${String(p.deviceName)}: its channel numbering could not be read; channels are named as on an EdgeTX radio`);
        }
    }
    if (p.known !== undefined && typeof p.known !== 'string') delete out.known;
    if (p.modeSwitch !== undefined) {
        const ms = validModeSwitch(p.modeSwitch);
        if (ms) out.modeSwitch = ms;
        else {
            delete out.modeSwitch;
            console.warn(`radio setup ${String(p.deviceName)}: its mode switch could not be read; it flies without one`);
        }
    }
    if (p.switches !== undefined) {
        // channel functions: the readable ranges stay; none readable, the wizard's arm and mode switch fly
        const r = readSwitches(p.switches);
        if (r.switches) out.switches = r.switches;
        else delete out.switches;
        if (!r.switches) console.warn(`radio setup ${String(p.deviceName)}: its switches could not be read; the setup wizard's arm and mode switch fly`);
        else if (r.dropped > 0) console.warn(`radio setup ${String(p.deviceName)}: ${r.dropped} switch range(s) could not be read and were dropped`);
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
    /** easy play flies (touch or keyboard with prefs input.play 'easy', v0.8): no arming, the HUD says "take off" */
    easy: boolean;
    /**
     * How often the radio's or gamepad's reports arrive (interval, jitter, longest gap; F3 says it,
     * v0.9 lane E); asked only while F3 is on. Null for touch, keyboard, and a device that measures nothing.
     */
    link: ((now: number) => LinkStats) | null;
}

/** Routes mapped channels through the arm gate into the session. */
export class Controls {
    /** respawn.keepArmed: on by default (A.8), set by app/builtin/modes.ts from the store */
    private keepArmed = true;
    gate = new ArmGate({ keepArmedAfterCrash: this.keepArmed });
    profile: Profile | null = null;
    /** The pilot's flight mode (prefs flight.mode, app/builtin/modes.ts): ch[5] unless the radio's switch decides. */
    mode: FlightMode = 'angle';
    /**
     * How touch and keyboard fly (prefs input.play, set by app/builtin/play.ts; v0.8 lane A): 'easy'
     * starts the motors with the first flying input (play/easy.ts). Never read for a radio or gamepad.
     */
    play: 'easy' | 'pilot' = 'pilot';
    private latch = new ArmLatch(); // keyboard arm and momentary arm buttons
    private armView: ArmView;
    private ch = new Float32Array([0, 0, -1, 0, -1, -1, 0, 0]);
    private out = new Float32Array(8);
    lastSampleAt = -1e9;
    private lastTick = 0;
    source: 'hid' | 'gamepad' | 'touch' | 'keyboard' | 'sim' | null = null;
    private session: FlightSession;
    block: ArmBlock = 'noProfile';
    /** A switch range of an action was entered (Profile.switches): app/builtin/switches.ts runs the action. */
    onSwitchAction: ((a: SwitchAction) => void) | null = null;
    private actions = new SwitchActionWatch();
    /** The device in use reads itself once more before each frame steps the physics (a gamepad's pollNow); set by app/input.ts, null for any other input. */
    private pollHook: (() => void) | null = null;
    /** The meter of the device in use (HidSource.link / GamepadSource.link), for the HUD's F3 line. */
    private linkOf: ((now: number) => LinkStats) | null = null;

    constructor(session: FlightSession) {
        this.session = session;
        this.armView = { ch: this.ch, armKind: null, armLabel: '', mode: 2, source: null, easy: false, link: null };
    }

    /** A new scene (E.4): the same input, profile and arm gate feed the new session. */
    setSession(session: FlightSession): void {
        this.session = session;
        session.beforeStep = this.pollHook;
    }

    /**
     * The device the pilot flies with, for the two things that need more than its frames: a
     * `poll` run just before each frame steps the physics (null: nothing to read), and the link
     * meter F3 reads. Called by app/input.ts when the input changes.
     */
    useDevice(poll: (() => void) | null, link: ((now: number) => LinkStats) | null): void {
        this.pollHook = poll;
        this.linkOf = link;
        this.session.beforeStep = poll;
    }

    /**
     * Use a profile (or none). A new profile starts disarmed: a fresh gate wants the switch seen
     * OFF and every stick through its centre again, so a switch left ON under the old mapping (or
     * another device) cannot arm the new one.
     */
    setProfile(p: Profile | null): void {
        this.profile = p;
        this.latch.reset();
        this.actions.reset();
        this.gate = new ArmGate({ keepArmedAfterCrash: this.keepArmed });
        this.block = this.gate.block;
    }

    /**
     * The device's frames come back to the flight after a screen borrowed them (Controls: the wizard,
     * the Switches screen, where the pilot flips switches to try them). An action switch flipped
     * meanwhile must not run its action now: the next frame only learns where the action switches
     * are, as at connect. Arm and mode need nothing here: the arm gate wants the switch seen off
     * first anyway, and the mode is read from every frame.
     */
    resumeFrames(): void {
        this.actions.reset();
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

    /** The radio sets the mode (a radio or gamepad whose profile has a mode switch or mode ranges); the pilot's mode is not used then. */
    radioDecides(): boolean {
        const p = this.profile;
        return (this.source === 'hid' || this.source === 'gamepad') && !!p && radioSetsMode(p);
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

    /** A raw device frame through the current profile; then the actions whose switch it just turned on. */
    raw(f: RawFrame): void {
        const p = this.profile;
        if (!p) return;
        mapFrame(p, f, this.ch);
        this.ch[4] = profileArmLevel(p, f, this.latch) ? 1 : -1;
        this.push(f.t);
        for (const a of this.actions.update(p.switches, f)) this.onSwitchAction?.(a);
    }

    /** Space or the on-screen ARM button, for a profile that arms with the key (no switch, no arm range). */
    toggleArm(): void {
        if (this.profile?.arm?.kind !== 'key' || armByRanges(this.profile)) return;
        this.latch.toggle();
        this.ch[4] = this.latch.on ? 1 : -1;
        this.push(performance.now()); // act at once, not at the next radio report
    }

    /** A switch input of the device in use as the pilot reads it (inputLabel, with the profile's channel table): "CH6", or "button 3" on a gamepad. */
    nameOf(input: SwitchInput): string {
        return inputLabel(input, this.source === 'gamepad' ? 'gamepad' : 'hid', this.profile?.channels);
    }

    /** For the HUD; the same object every call (the HUD reads it at 10 Hz). */
    view(): ArmView {
        const v = this.armView;
        const a = this.profile?.arm ?? null;
        const range = armByRanges(this.profile) ? this.profile?.switches?.ranges.find((r) => r.fn === 'arm') ?? null : null;
        if (range) {
            // the channel functions arm: "CH6" ("button 3" on a gamepad), as the Switches screen names it;
            // a two-bit switch is a level switch like a channel
            v.armKind = range.input.kind === 'bits' ? 'axis' : range.input.kind;
            v.armLabel = this.nameOf(range.input);
        } else {
            v.armKind = !a ? null : a.kind === 'button' ? (a.toggle ? 'toggle' : 'button') : a.kind;
            v.armLabel = !a ? '' : a.kind === 'axis' ? t('wizard.armSource.ch', { n: a.index + 1 }) : a.kind === 'button' ? t('wizard.armSource.button', { n: a.bit + 1 }) : t('wizard.armSource.key');
            // a recognised controller's arm by the name printed on it (the DJI: "Start/stop button")
            const known = a && a.kind === 'button' ? knownDevice(this.profile?.known)?.controls.find((c) => c.input.kind === 'button' && c.input.bit === a.bit) : undefined;
            if (known) v.armLabel = t(`controllers.control.${known.label}`);
        }
        v.mode = this.profile?.mode ?? getStickMode();
        v.source = this.source;
        v.easy = this.play === 'easy' && (this.source === 'touch' || this.source === 'keyboard');
        v.link = this.source === 'hid' || this.source === 'gamepad' ? this.linkOf : null;
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
        const latched = !!a && !armByRanges(this.profile) && (a.kind === 'key' || (a.kind === 'button' && !!a.toggle));
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

// The input the pilot flies with: the radio or gamepad from last time (item 5), the Controls screen,
// the keyboard and the touch sticks. The mapping and the arm gate live in controls.ts. A recognised
// controller whose setup is older than its recognition opens the Controls screen once on its known
// setup's offer (devices/known.ts choiceOffer; v0.8 review R1).
import type { Profile, ThrottleStyle } from '@gsfpv/input';
import { KeyboardSource } from '../devices/keyboard';
import { findSavedHid, findSavedGamepad } from '../devices/reconnect';
import { choiceOffer } from '../devices/known';
import { TouchSticks } from '../devices/touch';
import { EasyPilot } from '../play/easy';
import { GAME_SPEED_IDS } from '../play/game';
import type { GameSpeed } from '../play/game';
import { GamePilot } from '../play/game-pilot';
import { LessonPilot, lessonMode, rayClearance, rayClearanceUp } from '../play/lesson-pilot';
import { CentrePilot } from '../play/centre-pilot';
import { openFeedback } from './builtin/feedback';
import { groundClearance } from '../play/ground';
import type { PlayProfile } from '../play/keys';
import type { LessonAssists } from '@shramko/sonic-fpv';
import { loadLastInput, saveLastInput, loadProfiles, profileFor, saveProfile } from '../controls';
import type { LastInput } from '../controls';
import { RadioScreen } from '../ui/radio';
import type { RadioChoice } from '../ui/radio';
import { h } from '../ui/dom';
import { t } from '../i18n';
import { beacon, hasHid, isTouch, q } from './env';
import type { FlightContext } from './context';

// ------------------------------------------------------------ before the scan is in: the input from last time
/**
 * A saved setup that may fly without being shown first: the one flown last time, or one made by
 * this wizard (it was checked on its check screen before it was saved). A setup from the first
 * wizard is shown for checking once, on the Controls screen, like a radio connected by hand.
 */
function trusted(key: string, last: LastInput | null): Profile | null {
    const p = profileFor(key);
    return p && (p.wizard === 2 || key === last?.key) ? p : null;
}

/** Will the input from last time most likely come back by itself (no Controls screen after loading)? */
export function expectResume(): boolean {
    const last = loadLastInput();
    if (last?.kind === 'touch' || last?.kind === 'keyboard') return true;
    return Object.keys(loadProfiles()).some((k) => trusted(k, last));
}

/** The touch sticks or keyboard flown last time, or a granted radio / connected gamepad with a trusted setup. */
export async function resumeInput(): Promise<RadioChoice | null> {
    const last = loadLastInput();
    if (last?.kind === 'touch' || last?.kind === 'keyboard') return { kind: last.kind, profile: null };
    const keys = Object.keys(loadProfiles()).filter((k) => trusted(k, last));
    const look = (k: string): Profile | null => trusted(k, last);
    const hid = (): Promise<RadioChoice | null> => (keys.some((k) => k.startsWith('hid:')) ? findSavedHid(look, last?.kind === 'hid' ? last.key ?? null : null) : Promise.resolve(null));
    const pad = (): Promise<RadioChoice | null> => (keys.some((k) => k.startsWith('gp:')) ? findSavedGamepad(look) : Promise.resolve(null));
    for (const find of last?.kind === 'gamepad' ? [pad, hid] : [hid, pad]) {
        const c = await find();
        if (c) return c;
    }
    return null;
}

/** A device found for a scan that then failed to load: let it go. */
export function release(c: RadioChoice | null): void {
    if (c?.hid) { c.hid.onFrame = null; c.hid.close(); }
    if (c?.gamepad) { c.gamepad.onFrame = null; c.gamepad.stop(); }
}

/** No test mode and no forced input: the input from last time is looked for while the scan loads. */
export function ownInput(): boolean {
    return !q.get('simradio') && q.get('lat') !== '1' && q.get('input') !== 'touch' && !(isTouch && !hasHid);
}

// ------------------------------------------------------------ in flight
export class InputHost {
    /** passive until the keyboard is the chosen input; Space then arms a radio without an arm switch */
    readonly keyboard: KeyboardSource;
    touch: TouchSticks | null = null;
    /**
     * Easy play (v0.8, play/easy.ts): the auto-arm and the altitude help of the touch sticks when prefs
     * input.play is 'easy'. A radio or gamepad never goes through it.
     */
    readonly easy: EasyPilot;
    /**
     * The game scheme (v0.9, play/game-pilot.ts): the keyboard and the mouse when prefs input.play is
     * 'easy'. Auto-arm, velocity and height hold, mouse look. A radio or gamepad never goes through it.
     */
    readonly game: GamePilot;
    /**
     * Fly by Sound's lesson pilot (v0.12, play/lesson-pilot.ts) while a lesson runs, else null: installed for every
     * source by setLesson().
     */
    private lesson: LessonPilot | null = null;
    /**
     * The centred throttle style (lane center-throttle, play/centre-pilot.ts): installed in Controls.assist for a radio,
     * gamepad or HID controller whose throttle style is 'centred' while no lesson runs. Built on first use.
     */
    private centre: CentrePilot | null = null;
    private centreFn: ((ch: Float32Array, out: Float32Array, t: number) => void) | null = null;
    /** the throttle style flying now, and the one asked for (app/builtin/throttle-style.ts); a change waits for the motors to stop */
    private style: ThrottleStyle = 'zero';
    private wantStyle: ThrottleStyle = 'zero';
    /** How touch and keyboard fly now (prefs input.play, set by app/builtin/play.ts through setPlay). */
    private play: PlayProfile = 'pilot';
    private lastChoice: RadioChoice | null = null;
    private noteTimer = 0;
    private ctx: FlightContext;

    constructor(ctx: FlightContext) {
        this.ctx = ctx;
        this.keyboard = new KeyboardSource(ctx.controls);
        this.keyboard.onArm = () => ctx.controls.toggleArm();
        this.easy = new EasyPilot(ctx.controls, { session: () => ctx.session, altitudeHelp: () => ctx.prefs.get('input.altitudeHelp') !== false });
        const speed = (): GameSpeed => {
            const v = ctx.prefs.get('input.gameSpeed');
            return GAME_SPEED_IDS.find((id) => id === v) ?? 'normal';
        };
        this.game = new GamePilot(ctx.controls, { session: () => ctx.session, speed });
        this.keyboard.game = {
            pilot: this.game,
            sensitivity: () => {
                const v = ctx.prefs.get('input.mouseSensitivity');
                return typeof v === 'number' && v > 0 ? v : 1;
            },
            invertY: () => ctx.prefs.get('input.mouseInvertY') === true
        };
    }

    /**
     * How touch and keyboard fly (prefs input.play). The keyboard switches at once; touch sticks on
     * screen are built again for the other profile (the ARM button, the left stick's job).
     */
    setPlay(p: PlayProfile): void {
        if (p === this.play) return;
        this.play = p;
        this.ctx.controls.play = p;
        this.keyboard.setProfile(p);
        this.game.reset();
        if (this.touch) {
            this.touch.dispose();
            this.easy.reset();
            this.touch = this.makeTouch();
        }
    }

    /**
     * A Fly by Sound lesson's assists (v0.12 plan 2.3), or null when no lesson runs. With assists the lesson pilot
     * reads every source's channels as intents and flies them before the arm gate (Controls.assist), the mode the
     * lesson's control needs is forced (Controls.forcedMode), and the keyboard's and the touch sticks' own pilots
     * pass their input on as intents. null takes all of it out: every source flies as before.
     */
    setLesson(assists: LessonAssists | null): void {
        const c = this.ctx.controls;
        if (!assists) {
            this.lesson = null;
            c.assist = null;
            c.forcedMode = null;
            this.game.intents = false;
            this.easy.intents = false;
            // the controller's own throttle style flies again (the centred pilot from the ground: motors off)
            this.centre?.reset();
            this.installStyle();
            // the arm channel changes hands (review B1): a switch left on must be flipped again; a craft still flying keeps its gate
            if (!c.gate.armed) c.restartGate();
            return;
        }
        let pilot = this.lesson;
        if (pilot) pilot.setAssists(assists);
        else {
            const ctx = this.ctx;
            pilot = new LessonPilot({
                sim: () => ctx.session.sim ?? null,
                paused: () => ctx.session.paused,
                ground: (sim) => rayClearance(ctx.session.collision, sim),
                above: (sim) => rayClearanceUp(ctx.session.collision, sim)
            }, assists);
            this.lesson = pilot;
        }
        const p = pilot;
        c.assist = (ch, out, t) => p.apply(ch, out, t);
        c.forcedMode = lessonMode(assists);
        this.game.intents = true;
        this.easy.intents = true;
    }

    /**
     * The throttle style to fly with the radio, gamepad or HID controller in use (app/builtin/throttle-style.ts resolves
     * it: the pilot's choice, else where the throttle rests). On the ground it applies at once; with the motors running
     * it waits until they stop (a landing, a crash, a respawn, the arm switch), so a flip never drops the drone.
     */
    setThrottleStyle(s: ThrottleStyle): void {
        this.wantStyle = s;
        this.settleStyle();
    }

    /** The style flying now and the one waiting for the motors to stop (null: none waits). */
    get throttleStyle(): { now: ThrottleStyle; pending: ThrottleStyle | null } {
        return { now: this.style, pending: this.wantStyle !== this.style ? this.wantStyle : null };
    }

    /** The centred pilot while it flies the controller in use, else null. */
    get centrePilot(): CentrePilot | null {
        return this.centreFn && this.ctx.controls.assist === this.centreFn ? this.centre : null;
    }

    /** A style waiting for the motors to stop takes over once they have (called every frame by app/builtin/throttle-style.ts). */
    settleStyle(): void {
        if (this.wantStyle === this.style) return;
        if (this.ctx.controls.gate.armed) return;
        this.style = this.wantStyle;
        this.centre?.reset();
        this.installStyle();
        // the arm channel changes hands (review B1): from the centred pilot's AutoArm to the switch, or back; the
        // switch must be seen off again and a crash hold of the old owner is dropped
        this.ctx.controls.restartGate();
    }

    /**
     * Controls.assist for the style and the input in use: the centred pilot for a radio, gamepad or HID controller in
     * the centred style, else none (the 'zero' style is the path as it always was). A lesson's pilot is left alone.
     */
    private installStyle(): void {
        if (this.lesson) return;
        const c = this.ctx.controls;
        const radio = c.source === 'hid' || c.source === 'gamepad';
        if (this.style === 'centred' && radio) {
            const pilot = this.centre ?? this.makeCentre();
            if (!this.centreFn) this.centreFn = (ch, out, t) => pilot.apply(ch, out, t);
            c.assist = this.centreFn;
        } else if (this.centreFn && c.assist === this.centreFn) c.assist = null;
    }

    private makeCentre(): CentrePilot {
        const ctx = this.ctx;
        const speed = (): GameSpeed => {
            const v = ctx.prefs.get('input.gameSpeed');
            return GAME_SPEED_IDS.find((id) => id === v) ?? 'normal';
        };
        this.centre = new CentrePilot({
            sim: () => ctx.session.sim ?? null,
            paused: () => ctx.session.paused,
            // the game scheme's ground below (play/ground.ts, the scan's own walls), looked at every 33 ms by the pilot
            ground: (sim) => groundClearance(sim.contactWorld, sim.s, sim.p),
            mode: () => ctx.controls.flyingMode(),
            speed,
            // every latched arm input is a press (review M3): a toggle button, and Space / the on-screen DISARM of a key arm
            toggleArm: () => {
                const a = ctx.controls.profile?.arm;
                return !!a && (a.kind === 'key' || (a.kind === 'button' && !!a.toggle));
            }
        });
        return this.centre;
    }

    /** The lesson pilot while a lesson runs (its AutoArm, its assist), else null. */
    get lessonPilot(): LessonPilot | null {
        return this.lesson;
    }

    /** Touch sticks for the profile in use. */
    private makeTouch(): TouchSticks {
        const ts = new TouchSticks(this.ctx.ui, this.ctx.controls, this.play === 'easy' ? this.easy : null);
        this.ctx.hook.touch = ts;
        return ts;
    }

    /**
     * The pilot's own input once the scan is in: forced by the device or the URL, else the one from last time.
     * `standIn`: what flies when nothing was found and the Controls screen is not shown (Fly by Sound: that screen is a
     * sight-first wizard, and a radio is set up once by a helper). It is flown but NOT remembered, as the keyboard that
     * Controls' Close falls back to is not (openRadio onClose): remembered, it would replace the radio of last time, which
     * would then never be looked for again, here or in the plain simulator.
     */
    async start(resumed: Promise<RadioChoice | null>, standIn: RadioChoice | null = null): Promise<void> {
        if (isTouch && !hasHid) {
            this.use({ kind: 'touch', profile: null }, false);
        } else if (q.get('input') === 'touch') {
            this.use({ kind: 'touch', profile: null }, false);
        } else {
            // item 5: the same radio (or keyboard, touch) as last time flies at once; a note on the
            // Controls button says so. Nothing found: the Controls screen as before. A recognised
            // controller whose setup came back from before it was recognised (choiceOffer: the DJI's
            // wizard setup, its flight-mode switch on one bit): it is the radio in use and the Controls
            // screen opens on its offer (Use the known setup / Keep my setup); Fly there flies on with
            // nothing changed, and the offer comes again next time until the pilot picks one
            const c = await resumed;
            if (c) {
                this.use(c);
                if (choiceOffer(c)) this.openRadio(true);
                else this.note(c);
            } else if (standIn) {
                this.use(standIn, false);
                this.note(standIn);
            } else this.openRadio(true);
        }
    }

    /**
     * The Controls screen; the input in use is offered first (Fly, Recalibrate, Reverse channels,
     * Switches). `view` 'switches' opens the radio in use on its Switches view (Settings' link).
     */
    openRadio(firstOpen = false, view?: 'switches'): void {
        const ctx = this.ctx;
        if (document.querySelector('.screen.radio')) return;
        ctx.pause('controls');
        // opened from the pause menu (its item or the top button): Controls takes the menu's place,
        // so closing Controls flies on, whichever way it was opened
        if (ctx.menu.isOpen) ctx.menu.close();
        const r = new RadioScreen(ctx.ui, this.lastChoice, { firstOpen, view, report: (text) => { r.close(); openFeedback(ctx, 'bug', { message: text }); } });
        ctx.hook.radio = r;
        r.onDone = (c) => { r.remove(); ctx.resume('controls'); this.use(c); };
        // Close / Esc: nothing changes (remove() gives the radio in use its frames back). Closed
        // before anything was chosen: the input from last time or the keyboard, never a dead screen
        r.onClose = () => {
            r.remove();
            // the radio in use has its frames back (remove()): switches flipped on the screen run nothing
            ctx.controls.resumeFrames();
            ctx.resume('controls');
            if (this.lastChoice) return;
            const c: RadioChoice = { kind: loadLastInput()?.kind === 'touch' ? 'touch' : 'keyboard', profile: null };
            this.use(c, false); // a stand-in, not a choice: the radio from last time is still looked for next time
            this.note(c);
        };
    }

    /** Fly with this input. `remember`: offer it by itself next time (not for URL-forced test inputs). */
    use(c: RadioChoice, remember = true): void {
        const ctx = this.ctx;
        const prev = this.lastChoice;
        // a device that is no longer the input stops listening, or it would feed the flight too
        if (prev?.hid && prev.hid !== c.hid) { prev.hid.onFrame = null; prev.hid.close(); }
        if (prev?.gamepad && prev.gamepad !== c.gamepad) { prev.gamepad.onFrame = null; prev.gamepad.stop(); }
        this.touch?.dispose();
        this.touch = null;
        // the same input kept (Fly on the radio in use) stays armed; anything new starts disarmed
        if (c.profile !== ctx.controls.profile || c.kind !== ctx.controls.source) ctx.controls.setProfile(c.profile);
        // the device's frames go (back) to the flight: an action switch flipped while a screen had
        // them (Controls, Switches) runs nothing on the first frame
        else ctx.controls.resumeFrames();
        ctx.controls.source = c.kind;
        if (c.kind === 'hid' && c.hid) c.hid.onFrame = (f) => ctx.controls.raw(f);
        if (c.kind === 'gamepad' && c.gamepad) c.gamepad.onFrame = (f) => ctx.controls.raw(f);
        // a gamepad reads itself once more just before each frame steps the physics; F3 reads the
        // device's link meter (v0.9 lane E)
        const pad = c.kind === 'gamepad' ? c.gamepad : undefined;
        const meter = c.kind === 'hid' ? c.hid?.link : c.kind === 'gamepad' ? c.gamepad?.link : undefined;
        ctx.controls.useDevice(pad ? () => pad.pollNow() : null, meter ? (now) => meter.stats(now) : null);
        // a new input starts easy play from the ground: motors off until its first flying input
        if (c.kind !== prev?.kind) { this.easy.reset(); this.game.reset(); this.lesson?.reset(); }
        // the centred style starts every new controller from the ground; its style comes from app/builtin/throttle-style.ts
        if (c.kind !== prev?.kind || c.profile !== prev?.profile) this.centre?.reset();
        this.installStyle();
        if (c.kind === 'touch') this.touch = this.makeTouch();
        this.keyboard.setActive(c.kind === 'keyboard');
        this.lastChoice = c;
        if (remember) saveLastInput({ kind: c.kind, key: c.profile?.deviceKey });
        beacon('input_connected', { kind: c.kind });
    }

    /** The radio or gamepad in use, with its profile; null for touch, keyboard, or none. */
    radioInUse(): RadioChoice | null {
        const c = this.lastChoice;
        return c && (c.kind === 'hid' || c.kind === 'gamepad') && c.profile ? c : null;
    }

    /**
     * The radio in use with a changed setup (its switches from a Betaflight import): saved for that
     * device and flown at once (a new arm gate: the switch must be seen off again). False when the
     * profile is not the one of the radio in use.
     */
    replaceProfile(p: Profile): boolean {
        const c = this.radioInUse();
        if (!c || c.profile?.deviceKey !== p.deviceKey) return false;
        saveProfile(p);
        this.use({ ...c, profile: p });
        return true;
    }

    /** "Connected: TX16S · Controls" on the Controls button for a while: what flies, and where to change it. */
    note(c: RadioChoice): void {
        const ui = this.ctx.ui;
        const btn = ui.querySelector<HTMLButtonElement>('[data-action="open-controls"]');
        if (!btn) return;
        const name = c.profile ? c.profile.deviceName : '';
        const what = c.profile ? t('radio.connected', { name: name.length > 24 ? `${name.slice(0, 23)}…` : name }) : t(c.kind === 'touch' ? 'radio.touch' : 'radio.keyboard');
        btn.querySelector('.input-note')?.remove();
        ui.querySelector('.input-note-sr')?.remove();
        btn.prepend(h('span', { class: 'input-note', 'data-testid': 'input-note' }, `${what} · `));
        const sr = h('span', { class: 'visually-hidden input-note-sr', role: 'status' });
        ui.append(sr);
        // a live region is announced when its text changes, not when it arrives with the text
        setTimeout(() => { sr.textContent = `${c.profile ? t('radio.connected', { name }) : what}. ${t('top.controls')}`; }, 100);
        clearTimeout(this.noteTimer);
        this.noteTimer = window.setTimeout(() => { btn.querySelector('.input-note')?.remove(); sr.remove(); }, 8000);
    }
}

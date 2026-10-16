// The input the pilot flies with: the radio or gamepad from last time (item 5), the Controls screen,
// the keyboard and the touch sticks. The mapping and the arm gate live in controls.ts. A recognised
// controller whose setup is older than its recognition opens the Controls screen once on its known
// setup's offer (devices/known.ts choiceOffer; v0.8 review R1).
import type { Profile } from '@gsfpv/input';
import { KeyboardSource } from '../devices/keyboard';
import { findSavedHid, findSavedGamepad } from '../devices/reconnect';
import { choiceOffer } from '../devices/known';
import { TouchSticks } from '../devices/touch';
import { EasyPilot } from '../play/easy';
import type { PlayProfile } from '../play/keys';
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
     * Easy play (v0.8, play/easy.ts): the auto-arm and the altitude help shared by the keyboard and
     * the touch sticks when prefs input.play is 'easy'. A radio or gamepad never goes through it.
     */
    readonly easy: EasyPilot;
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
        this.keyboard.easy = { pilot: this.easy, params: () => ctx.session.sim.p, mode: () => ctx.controls.flyingMode() };
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
        if (this.touch) {
            this.touch.dispose();
            this.easy.reset();
            this.touch = this.makeTouch();
        }
    }

    /** Touch sticks for the profile in use. */
    private makeTouch(): TouchSticks {
        const ts = new TouchSticks(this.ctx.ui, this.ctx.controls, this.play === 'easy' ? this.easy : null);
        this.ctx.hook.touch = ts;
        return ts;
    }

    /** The pilot's own input once the scan is in: forced by the device or the URL, else the one from last time. */
    async start(resumed: Promise<RadioChoice | null>): Promise<void> {
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
        const r = new RadioScreen(ctx.ui, this.lastChoice, { firstOpen, view });
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
        // a new input starts easy play from the ground: motors off until its first flying input
        if (c.kind !== prev?.kind) this.easy.reset();
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

// Easy play on the page (v0.8 lane A; docs/wip/v08-a.md; the owner's message 21, items 1, 2, 6):
//  - prefs input.play goes to the input host (the keyboard's layout, the touch sticks' ARM button and
//    left stick) and to Controls (the HUD's "take off" line). ?lat=1 (the latency harness) always
//    flies the pilot profile: it measures the radio-like path, one numbered key at a time.
//  - K shows or hides the keyboard's key card (keymap help.keys); it shows by itself on the ground.
//  - A new life or a new scene: the altitude help and the game scheme start again from the craft's new state.
//  - v0.9 lane B (docs/wip/v09-b.md; the owner's message 22 items 1 and 6): the game scheme's page half.
//    A click on the flight view captures the mouse (pointer lock, play/mouse-look.ts) and the keyboard
//    source turns its movement into the aim and the camera gimbal; a lost lock (Esc is the browser's own
//    gesture) pauses into the menu, and a click on the paused view or Continue resumes and captures again.
//    The camera of a game-scheme flight is the stabilised gimbal (session.cameraAim, play/gimbal.ts).
//    F toggles full screen (keymap fullscreen.toggle; the top-bar button is app/builtin/top.ts). The
//    mouse is let go while a screen needs the cursor (the menu, a panel, Controls, the crash panel).
//  - input.haptics: a short vibration on a crash with the touch sticks (navigator.vibrate; Android
//    Chrome has it, iOS Safari does not, and then nothing happens).
//  - The pilot school (play/school.ts): a chip under the mode chip with the step and the seconds
//    flown toward its goal; it opens the four steps; a reached goal offers the next step. Shown only
//    while easy play flies (touch or keyboard); a radio pilot is a pilot.
import { isFlightMode } from '@gsfpv/input';
import type { FlightMode } from '@gsfpv/sim-core';
import { GOAL_S, SCHOOL_STEPS, SchoolProgress, settingsOf, stepOf } from '../../play/school';
import type { SchoolStep } from '../../play/school';
import type { PlayProfile } from '../../play/keys';
import { headingDeg } from '../../play/game';
import type { CameraAim } from '../../play/gimbal';
import { MouseLook } from '../../play/mouse-look';
import { isFullscreen, toggleFullscreen } from '../../play/fullscreen';
import { dialogOpen } from '../../devices/keyboard';
import type { FlightSession } from '../../session';
import { h } from '../../ui/dom';
import { gutterTop } from '../../ui/top-row';
import { t } from '../../i18n';
import { q } from '../env';
import type { Feature, FlightContext } from '../context';
import '../../play/play.css';

// window.__gsfpv.play: easy play's state, for the acceptance (tools/bench/src/accept-v08-play.ts)
declare module '../test-hook' {
    interface TestHook {
        play?: () => {
            profile: PlayProfile; arm: string; want: boolean; helpActive: boolean; throttle: number; target: number; step: SchoolStep; school: { seconds: number; goal: number } | null;
            /** the game scheme (v0.9): null when something else flies */
            game: { arm: string; want: boolean; locked: boolean; lockSupported: boolean; aimYawDeg: number | null; gimbalDeg: number; headingDeg: number; speed: string; goalForward: number; goalRight: number; tiltPitchDeg: number; tiltRollDeg: number; landed: boolean; throttle: number; fullscreen: boolean; hintShown: boolean } | null;
        };
    }
}

/** How touch and keyboard fly now: the setting, except under the latency harness. */
export function playProfile(ctx: Pick<FlightContext, 'prefs'>, lat = q.get('lat') === '1'): PlayProfile {
    if (lat) return 'pilot';
    return ctx.prefs.get('input.play') === 'pilot' ? 'pilot' : 'easy';
}

/** The school step the settings fly now. */
function schoolStep(ctx: FlightContext): SchoolStep {
    const m = ctx.prefs.get('flight.mode');
    const mode: FlightMode = isFlightMode(m) ? m : 'angle';
    return stepOf(mode, ctx.prefs.get('input.altitudeHelp') !== false);
}

/** Fly a school step: its mode and its altitude help, stored as the pilot's own choice. */
function goToStep(ctx: FlightContext, step: SchoolStep): void {
    const o = settingsOf(step);
    ctx.prefs.set('input.altitudeHelp', o.altitudeHelp);
    ctx.prefs.set('flight.mode', o.mode);
    ctx.prefs.clearSession('flight.mode'); // over any ?set.flight.mode= of this load, as the mode chip does
}

export const play: Feature = {
    id: 'play',
    install(ctx) {
        const prefs = ctx.prefs;
        ctx.input.setPlay(playProfile(ctx));
        const gamePilot = ctx.input.game;

        // ------------------------------------------------------------ the game scheme: the mouse, the camera, full screen
        /** The game scheme flies: the keyboard is the input and prefs input.play is easy (Controls.gameKeys). */
        const gameOn = (): boolean => ctx.controls.gameKeys();
        const hint = h('div', { class: 'game-hint', role: 'status', 'data-testid': 'game-hint', hidden: true }, t('play.game.clickHint'));
        ctx.ui.append(hint);
        const mouse = new MouseLook({
            target: ctx.canvas,
            onMove: (dx, dy) => ctx.input.keyboard.mouse(dx, dy),
            // Esc (the browser's own release), alt-tab, leaving full screen: the flight pauses into the menu
            onLost: () => { if (gameOn() && !ctx.session.paused) ctx.menu.open(); syncHint(); }
        });
        ctx.hud.mouseLocked = () => mouse.locked;
        /** A screen that needs the cursor is up (the pause menu counts: it is a panel). */
        const needsCursor = (): boolean => ctx.menu.isOpen || dialogOpen() || ctx.ui.querySelector('.crash-overlay') !== null;
        function syncHint(): void {
            const show = gameOn() && mouse.supported && !mouse.locked && !ctx.session.paused && !needsCursor();
            if (hint.hidden === show) hint.hidden = !show;
        }
        document.addEventListener('pointerlockchange', syncHint);
        /** Things a click on must keep doing what they do: buttons, links, panels, the cards on the view. */
        const KEEPS_CLICK = 'button, a, input, select, textarea, label, summary, .panel, .screen, .attribution, .top-actions, .mode-chip, .school-chip, .school-pop, .school-offer, .crash-overlay, .touch-pad, [role="dialog"]';
        /**
         * Click to fly: a click on the flight view captures the mouse (it is the user activation the browser
         * wants). On the paused view, Continue or a click on the view around the menu resumes and captures.
         */
        const onClick = (e: MouseEvent): void => {
            if (e.button !== 0 || !gameOn() || mouse.locked || !mouse.supported) return;
            const el = e.target instanceof Element ? e.target : null;
            if (ctx.menu.isOpen) {
                const onContinue = el?.closest('[data-action="pause.continue"]') != null;
                const onView = el !== null && !el.closest(KEEPS_CLICK);
                if (!onContinue && !onView) return;
                if (onView) ctx.menu.close();
                void mouse.lock().then(syncHint);
                return;
            }
            if (needsCursor() || (el && el.closest(KEEPS_CLICK))) return;
            void mouse.lock().then(syncHint);
        };
        addEventListener('click', onClick, { capture: true });
        // the camera: the stabilised gimbal along the pilot's aim; the drone's own camera for anything else
        const aim = (): CameraAim | null => {
            if (!gameOn()) return null;
            const g = gamePilot.game;
            return { yawDeg: g.aimYawDeg ?? headingDeg(ctx.session.sim.s), pitchDeg: g.gimbalDeg };
        };
        const attachAim = (s: FlightSession): void => { s.cameraAim = aim; };
        attachAim(ctx.session);
        const offAim = ctx.events.on('session', attachAim);
        // F: full screen (a key press is the user activation it needs)
        const offFs = ctx.keys.on('fullscreen.toggle', (e) => {
            if (e.repeat) return;
            e.preventDefault();
            void toggleFullscreen();
        });
        // the cursor is let go for screens that need it; back when they are gone, if the browser lets us
        const offMousePause = ctx.events.on('pause', ({ on, reasons }) => {
            if (on) { if (reasons.some((r) => r === 'menu' || r === 'panel' || r === 'controls' || r === 'export')) mouse.unlock(); }
            else if (gameOn()) void mouse.lock().then(syncHint);
            syncHint();
        });

        const offPrefs = prefs.onChange((c) => {
            if (c.id === 'input.play') {
                ctx.input.setPlay(playProfile(ctx));
                if (!gameOn()) mouse.unlock();
            } else if (c.id === 'flight.mode' && gameOn() && prefs.get('flight.mode') !== 'angle') {
                ctx.hud.flash(t('play.game.angleOnly'), 4000);
            }
        });

        // K: the key card on demand (the keyboard's; a note for anything else)
        const offKey = ctx.keys.on('help.keys', (e) => {
            if (e.repeat) return;
            ctx.hud.toggleKeys();
        });

        const offLife = ctx.events.on('life', () => { ctx.input.easy.resetHelp(); gamePilot.resetFlight(); });
        const offSession = ctx.events.on('session', () => { ctx.input.easy.resetHelp(); gamePilot.resetFlight(); });

        // a crash with the touch sticks: a short buzz where the browser can
        const offSim = ctx.events.on('sim', (e) => {
            if (e.type !== 'crash' || ctx.controls.source !== 'touch' || prefs.get('input.haptics') === false) return;
            const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
            try { nav.vibrate?.([70, 40, 50]); } catch { /* a browser that refuses: nothing to do */ }
        });

        // ------------------------------------------------------------ the pilot school
        const progress = new SchoolProgress();
        let lifeIndex = 0;
        ctx.events.on('life', () => { lifeIndex++; });
        ctx.events.on('session', () => { lifeIndex++; });
        const chip = h('button', { type: 'button', class: 'school-chip', 'data-testid': 'school-chip', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', hidden: true, onclick: () => togglePanel() });
        const panel = h('div', { class: 'school-pop', 'data-testid': 'school-panel', role: 'dialog', 'aria-label': t('play.school.title'), hidden: true });
        const offer = h('div', { class: 'school-offer', 'data-testid': 'school-offer', role: 'status', hidden: true });
        ctx.ui.append(chip, panel, offer);
        let offerTimer = 0;
        let last: { seconds: number; goal: number } | null = null;

        const closePanel = (): void => { panel.hidden = true; chip.setAttribute('aria-expanded', 'false'); };
        const togglePanel = (): void => {
            if (!panel.hidden) { closePanel(); return; }
            const now = schoolStep(ctx);
            const rows = SCHOOL_STEPS.map((s) => h('button', { type: 'button', class: `school-step${s === now ? ' on' : ''}`, 'aria-pressed': String(s === now), 'data-step': String(s), onclick: () => { goToStep(ctx, s); closePanel(); } },
                h('span', { class: 'school-name' }, t('play.school.now', { step: s, name: t(`play.school.step${s}`) })),
                h('span', { class: 'school-about' }, `${t(`play.school.step${s}.about`)} ${t('play.school.goal', { goal: GOAL_S[s] })}`)));
            panel.replaceChildren(h('h3', {}, t('play.school.title')), h('p', { class: 'school-lead' }, t('play.school.about')), ...rows,
                h('button', { type: 'button', class: 'btn', onclick: () => closePanel() }, t('play.school.close')));
            panel.hidden = false;
            chip.setAttribute('aria-expanded', 'true');
        };

        const hideOffer = (): void => { offer.hidden = true; clearTimeout(offerTimer); };
        const showOffer = (step: SchoolStep): void => {
            const next = step < 4 ? ((step + 1) as SchoolStep) : null;
            const parts: (HTMLElement | string)[] = [h('strong', {}, t('play.school.reached', { goal: GOAL_S[step] }))];
            if (next) {
                parts.push(h('span', {}, t('play.school.next', { name: t(`play.school.step${next}`), about: t(`play.school.step${next}.about`) })),
                    h('span', { class: 'school-actions' },
                        h('button', { type: 'button', class: 'btn primary', 'data-action': 'school-next', onclick: () => { goToStep(ctx, next); hideOffer(); } }, t('play.school.go')),
                        h('button', { type: 'button', class: 'btn', 'data-action': 'school-stay', onclick: () => hideOffer() }, t('play.school.stay'))));
            } else {
                parts.push(h('span', {}, t('play.school.finished')),
                    h('span', { class: 'school-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => hideOffer() }, t('play.school.close'))));
            }
            offer.replaceChildren(...parts);
            offer.hidden = false;
            clearTimeout(offerTimer);
            offerTimer = window.setTimeout(hideOffer, 15000);
        };

        /**
         * The chip at the mode chip's left edge, the first free height under it (ui/top-row.ts
         * gutterTop, as the mode chip finds its own place): never over the top buttons or the
         * right-hand OSD line, past the boxes and notes at the top (the credit, the walls box, the
         * touch hint). Its list of steps opens right under it.
         */
        const place = (): void => {
            const mc = ctx.ui.querySelector<HTMLElement>(':scope > .mode-chip');
            if (!mc || mc.hidden || mc.offsetParent === null) { chip.style.visibility = 'hidden'; return; }
            chip.style.visibility = '';
            const rects = (sel: string): DOMRect[] => [...ctx.ui.querySelectorAll<HTMLElement>(sel)].filter((el) => el.offsetParent !== null).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
            const m = mc.getBoundingClientRect();
            const hard = rects('.hud .osd.tr, :scope > .top-actions, :scope > .top-actions > .btn, :scope > .mode-chip');
            const soft = rects(':scope > .bake-box, .touch-hint, :scope > .voxel-legend, :scope > .banner, .attribution');
            const top = gutterTop(m.left, m.bottom + 6, chip.offsetWidth, chip.offsetHeight, hard, soft, innerHeight / 2);
            const left = `${Math.round(m.left)}px`;
            const y = `${Math.round(top)}px`;
            if (chip.style.left !== left) chip.style.left = left;
            if (chip.style.top !== y) chip.style.top = y;
            panel.style.left = left;
            panel.style.top = `${Math.round(top + chip.offsetHeight + 6)}px`;
        };

        let lastAt = 0;
        const offFrame = ctx.events.on('frame', ({ now }) => {
            if (now - lastAt < 250) return;
            lastAt = now;
            // the game scheme's mouse: let go for a screen that needs the cursor, or when something else flies
            if (mouse.locked && (!gameOn() || ctx.ui.querySelector('.crash-overlay'))) mouse.unlock();
            syncHint();
            // the pilot school is for the touch sticks: the game keys have no steps to take away
            const view = ctx.controls.view();
            const on = view.easy && !view.game;
            if (chip.hidden === on) chip.hidden = !on;
            if (!on) { if (!panel.hidden) closePanel(); last = null; return; }
            const step = schoolStep(ctx);
            const life = ctx.session.stats.life();
            const p = progress.update(step, { index: lifeIndex, airtimeS: life.airtimeS, crashes: life.crashes });
            last = { seconds: p.seconds, goal: p.goal };
            const done = progress.reachedSteps().includes(step);
            const text = done ? t('play.school.chipDone', { step }) : t('play.school.chip', { step, s: Math.floor(Math.min(p.seconds, p.goal)), goal: p.goal });
            if (chip.textContent !== text) chip.textContent = text;
            chip.title = `${t('play.school.title')}: ${t('play.school.now', { step, name: t(`play.school.step${step}`) })}`;
            place();
            if (p.reached) showOffer(step);
        });
        // a pause (the menu, a panel, Controls) closes the school's list: nothing of it stays over a screen
        const offPause = ctx.events.on('pause', ({ on }) => { if (on) closePanel(); });
        const outside = (e: PointerEvent): void => {
            if (panel.hidden) return;
            const el = e.target as Node | null;
            if (el && (panel.contains(el) || chip.contains(el))) return;
            closePanel();
        };
        addEventListener('pointerdown', outside, { capture: true });

        ctx.hook.play = () => {
            const ez = ctx.input.easy;
            const gp = gamePilot;
            const g = gp.game;
            return {
                profile: playProfile(ctx), arm: ez.arm.state, want: ez.arm.want, helpActive: ez.helpActive(), throttle: ez.throttleSent, target: ez.help.target, step: schoolStep(ctx), school: last,
                game: gameOn() ? {
                    arm: gp.arm.state, want: gp.arm.want, locked: mouse.locked, lockSupported: mouse.supported, aimYawDeg: g.aimYawDeg, gimbalDeg: g.gimbalDeg, headingDeg: headingDeg(ctx.session.sim.s),
                    speed: g.speed, goalForward: g.goal.forward, goalRight: g.goal.right, tiltPitchDeg: g.tilt.pitch, tiltRollDeg: g.tilt.roll, landed: g.landed, throttle: gp.throttleSent,
                    fullscreen: isFullscreen(), hintShown: !hint.hidden
                } : null
            };
        };

        return () => {
            offPrefs(); offKey(); offLife(); offSession(); offSim(); offFrame(); offPause(); offAim(); offFs(); offMousePause();
            removeEventListener('pointerdown', outside, { capture: true });
            removeEventListener('click', onClick, { capture: true });
            document.removeEventListener('pointerlockchange', syncHint);
            clearTimeout(offerTimer);
            ctx.session.cameraAim = null;
            mouse.dispose();
            chip.remove(); panel.remove(); offer.remove(); hint.remove();
        };
    }
};

// Easy play on the page (v0.8 lane A; docs/wip/v08-a.md; the owner's message 21, items 1, 2, 6):
//  - prefs input.play goes to the input host (the keyboard's layout, the touch sticks' ARM button and
//    left stick) and to Controls (the HUD's "take off" line). ?lat=1 (the latency harness) always
//    flies the pilot profile: it measures the radio-like path, one numbered key at a time.
//  - K shows or hides the keyboard's key card (keymap help.keys); it shows by itself on the ground.
//  - A new life or a new scene: the altitude help starts again from the craft's new state.
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
import { h } from '../../ui/dom';
import { gutterTop } from '../../ui/top-row';
import { t } from '../../i18n';
import { q } from '../env';
import type { Feature, FlightContext } from '../context';
import '../../play/play.css';

// window.__gsfpv.play: easy play's state, for the acceptance (tools/bench/src/accept-v08-play.ts)
declare module '../test-hook' {
    interface TestHook {
        play?: () => { profile: PlayProfile; arm: string; want: boolean; helpActive: boolean; throttle: number; target: number; step: SchoolStep; school: { seconds: number; goal: number } | null };
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
        ctx.hud.altitudeHelp = () => prefs.get('input.altitudeHelp') !== false;
        const offPrefs = prefs.onChange((c) => {
            if (c.id === 'input.play') ctx.input.setPlay(playProfile(ctx));
        });

        // K: the key card on demand (the keyboard's; a note for anything else)
        const offKey = ctx.keys.on('help.keys', (e) => {
            if (e.repeat) return;
            ctx.hud.toggleKeys();
        });

        const offLife = ctx.events.on('life', () => ctx.input.easy.resetHelp());
        const offSession = ctx.events.on('session', () => ctx.input.easy.resetHelp());

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
            const on = ctx.controls.view().easy;
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
            return { profile: playProfile(ctx), arm: ez.arm.state, want: ez.arm.want, helpActive: ez.helpActive(), throttle: ez.throttleSent, target: ez.help.target, step: schoolStep(ctx), school: last };
        };

        return () => {
            offPrefs(); offKey(); offLife(); offSession(); offSim(); offFrame(); offPause();
            removeEventListener('pointerdown', outside, { capture: true });
            clearTimeout(offerTimer);
            chip.remove(); panel.remove(); offer.remove();
        };
    }
};

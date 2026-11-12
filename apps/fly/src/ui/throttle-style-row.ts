// The left stick's style as a two-way choice (lane center-throttle, docs/wip/center-throttle.md 2 (b) and (e)): the
// Controls screen's panel of the controller in use and the calibration's last screen (the check screen, also the only
// screen of a recognised controller's setup). One line says what is in use and why (the pilot's choice, or where the
// stick was seen resting), then the two styles with one line of explanation each, the one in use pressed. A press saves
// the choice into the controller's profile; app/builtin/throttle-style.ts reads the profile every frame, so the flight,
// the setting and the HUD chip follow it.
//
// `seen()` on the check screen: where the throttle rests while the screen is open (RestWatch over the wizard's mapped
// throttle). A profile with no measured rest gets that one saved (the known setup never had a centre step); a rest the
// wizard measured is kept.
import { RestWatch, profileStyle } from '@gsfpv/input';
import type { Profile, ResolvedStyle, ThrottleRest } from '@gsfpv/input';
import { saveProfile } from '../controls';
import { h } from './dom';
import { t } from '../i18n';

const STYLES = ['centred', 'zero'] as const;

/**
 * Where each controller's throttle was seen resting on its present connection (app/builtin/throttle-style.ts writes it), so
 * the Controls screen says the same as the flight.
 */
export const seenRests = new WeakMap<Profile, ThrottleRest>();

/** The line under the title: the pilot's choice, or why automatic chose it. */
export function styleWhy(r: ResolvedStyle, rest: ThrottleRest | null): string {
    if (r.why === 'choice') return t('throttle.why.choice');
    if ((r.why === 'seen' || r.why === 'wizard') && rest) return t(`throttle.why.${rest}`);
    if (r.why === 'table') return t('throttle.why.table');
    return t('throttle.why.default');
}

export interface StyleRowOptions {
    /** save the profile on a press (the Controls screen); the check screen saves on Fly (false) */
    save?: boolean;
    /** the mapped throttle now (-1 bottom .. 1 top), to watch where it rests; absent: no watch */
    throttle?: () => number;
    /** called after a press */
    changed?: () => void;
}

/** The row and its per-frame update. */
export function throttleStyleRow(p: Profile, o: StyleRowOptions = {}): { el: HTMLElement; live: () => void } {
    const watch = new RestWatch();
    const title = h('p', { class: 'ts-title', 'data-testid': 'throttle-style-title' });
    const items = STYLES.map((s) => {
        const b = h('button', {
            type: 'button', class: 'btn ts-opt', role: 'radio', 'aria-checked': 'false', 'data-action': `throttle-style-${s}`,
            onclick: () => {
                p.throttleStyle = s;
                if (o.save !== false) saveProfile(p);
                show();
                o.changed?.();
            }
        }, h('span', { class: 'ts-name' }, t(`set.input.throttleStyle.opt.${s}`)), h('span', { class: 'ts-about muted small' }, t(`throttle.about.${s}`)));
        return { s, b };
    });
    const el = h('div', { class: 'throttle-style', 'data-testid': 'throttle-style-row' },
        h('h3', { class: 'ts-head' }, t('set.input.throttleStyle')),
        title,
        h('div', { class: 'ts-choice', role: 'radiogroup', 'aria-label': t('set.input.throttleStyle') }, ...items.map((i) => i.b)));
    let shown = '';
    const show = (): void => {
        const seen = watch.rest ?? seenRests.get(p) ?? null;
        const r = profileStyle(p, seen);
        const rest = r.why === 'seen' ? seen : p.throttleRest ?? null;
        const text = t('throttle.detected', { style: t(`set.input.throttleStyle.opt.${r.style}`), why: styleWhy(r, rest) });
        const key = `${r.style}|${text}`;
        if (key === shown) return;
        shown = key;
        title.textContent = text;
        el.dataset.style = r.style;
        el.dataset.why = r.why;
        for (const i of items) {
            i.b.setAttribute('aria-checked', String(i.s === r.style));
            i.b.classList.toggle('primary', i.s === r.style);
        }
    };
    show();
    const live = (): void => {
        if (o.throttle && watch.rest === null) {
            const v = o.throttle();
            if (Number.isFinite(v)) watch.update(v, performance.now());
            // a setup with no measured rest keeps the one seen here (saved with the profile on Fly)
            if (watch.rest !== null && !p.throttleRest) p.throttleRest = watch.rest;
        }
        show();
    };
    return { el, live };
}

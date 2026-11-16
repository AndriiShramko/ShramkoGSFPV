// The courses' feature as the page installs it (train 1 integration): the feature itself (builtin/course.ts) reaches the sound
// package and the mode's shapes (course/run.ts trackToObjects, course/view.ts shapePrims), which the main chunk must not hold
// (tools/bench/test/sonic-int-lazy.test.ts). So the flight installs this stub, which loads the feature as its own chunk once
// and installs it into the same flight; a flight that ends before the chunk is there installs nothing.
//
// Integration E, live (2026-11-16): the chunk arrived 1.3 s after the Controls screen closed, and Shift+G pressed in that time
// did nothing and said nothing. The owner's rule: no key that does nothing. So the stub takes the course's keys until the
// chunk is there, says one short line, and hands the last press to the feature the moment it is installed.
import type { Feature } from '../context';
import { t } from '../../i18n';
import { EARLY_ACTIONS, EARLY_KEEP_MS, earlyPress } from './course-early';

export const course: Feature = {
    id: 'course',
    install(ctx) {
        let gone = false;
        let off: (() => void) | void;
        const early = earlyPress(EARLY_KEEP_MS);
        const offs = EARLY_ACTIONS.map((a) => ctx.keys.on(a, (e) => {
            if (e.repeat) return;
            early.note(a, performance.now());
            ctx.hud.flash(t('course.early'), 4000);
        }));
        void import('./course').then((m) => {
            for (const o of offs) o();
            if (gone) return;
            off = m.course.install(ctx);
            const a = early.take(performance.now());
            if (a) ctx.keys.trigger(a);
        });
        return () => {
            gone = true;
            for (const o of offs) o();
            if (typeof off === 'function') off();
        };
    }
};

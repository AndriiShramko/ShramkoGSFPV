// The courses' feature as the page installs it (train 1 integration): the feature itself (builtin/course.ts) reaches the sound
// package and the mode's shapes (course/run.ts trackToObjects, course/view.ts shapePrims), which the main chunk must not hold
// (tools/bench/test/sonic-int-lazy.test.ts). So the flight installs this stub, which loads the feature as its own chunk once
// and installs it into the same flight; a flight that ends before the chunk is there installs nothing.
import type { Feature } from '../context';

export const course: Feature = {
    id: 'course',
    install(ctx) {
        let gone = false;
        let off: (() => void) | void;
        void import('./course').then((m) => {
            if (!gone) off = m.course.install(ctx);
        });
        return () => {
            gone = true;
            if (typeof off === 'function') off();
        };
    }
};

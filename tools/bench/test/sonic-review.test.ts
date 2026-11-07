// Review of lane v12-flight (docs/wip/v12-flight-review.md): regression tests for the defects the review found, each with the
// controls that must keep passing. D2 and D2b (the speech of a lesson left behind) are in sonic-bridge.test.ts and
// sonic-lessons.test.ts beside the code they hold. The app modules read location, document and matchMedia when they load, so
// those are stubbed before the imports (as app-switches.test.ts).
//  - D4  dialogOpen() knows the Fly by Sound start screen over a flight (the page run is tools/bench/src/sonic-review-keys.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('review D4: the start screen over a running flight is a dialog for the keyboard source', () => {
    interface Fake {
        classes: string[];
        hidden: boolean;
    }
    /** document.querySelector for the selectors dialogOpen asks: alternatives of the form `.a.b` and `.a:not([hidden])`. */
    const matches = (sel: string, e: Fake): boolean =>
        sel.split(',').map((s) => s.trim()).some((alt) => {
            const notHidden = alt.endsWith(':not([hidden])');
            const classes = alt.replace(':not([hidden])', '').split('.').filter(Boolean);
            return classes.length > 0 && classes.every((c) => e.classes.includes(c)) && (!notHidden || !e.hidden);
        });
    let dom: Fake[] = [];
    const page = async (): Promise<() => boolean> => {
        vi.stubGlobal('document', { querySelector: (sel: string) => dom.find((e) => matches(sel, e)) ?? null });
        return (await import('../../../apps/fly/src/devices/keyboard')).dialogOpen;
    };

    it('shown: Space and the arrows belong to its buttons, sliders and radios (the keyboard source stands aside); hidden: the flight\'s again', async () => {
        const dialogOpen = await page();
        dom = [];
        expect(dialogOpen()).toBe(false);
        dom = [{ classes: ['sonic-start'], hidden: false }];
        expect(dialogOpen()).toBe(true);
        dom = [{ classes: ['sonic-start'], hidden: true }];
        expect(dialogOpen()).toBe(false);
    });

    it('control: the dialogs it knew still count, and a screen that is none does not', async () => {
        const dialogOpen = await page();
        for (const classes of [['screen', 'radio'], ['panel'], ['screen', 'drones'], ['screen', 'scenes']]) {
            dom = [{ classes, hidden: false }];
            expect(dialogOpen()).toBe(true);
        }
        dom = [{ classes: ['screen', 'loading'], hidden: false }, { classes: ['sonic-captions'], hidden: false }];
        expect(dialogOpen()).toBe(false);
    });
});

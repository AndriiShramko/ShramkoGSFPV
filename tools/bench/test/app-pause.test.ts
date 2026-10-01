// The flight page's pause stack (apps/fly/src/app/pause-stack.ts, docs/architecture-v03.md 1.1): the
// flight runs again only when every reason is released. Also on the real SimClock
// (apps/fly/src/simclock.ts): no sim time passes while any reason is held.
//
// What this is NOT: a fix of a v0.2 bug. v0.2 (main) already kept a Set of holders in FlightSession
// (`PauseHolder = 'menu' | 'controls' | 'bake'`): its Controls screen held its own 'controls'
// (main.ts `session.pause(true, 'controls')`), and a panel opened from the pause menu (Settings,
// Drones, Replays...) took the menu's 'menu' hold over without releasing it. So in v0.2 the Controls
// screen over Settings kept the flight paused, and the menu never closed "under" Settings. The stack
// is a faithful refactor: the same behaviour, with one explicit reason per screen.
//   - parity: every pause sequence v0.2 could produce gives the same paused / flying answer from the
//     stack as from a model of v0.2's holders (V02Holders, below);
//   - negative control: a PLANTED regression, one boolean shared by every screen (OneBoolean). No
//     release of the simulator ever worked like that; it is the defect the stack must never become.
import { describe, expect, it } from 'vitest';
import { PauseStack } from '../../../apps/fly/src/app/pause-stack';
import type { PauseReason } from '../../../apps/fly/src/app/context';
import { SimClock } from '../../../apps/fly/src/simclock';

interface Pauser { hold(r: PauseReason): void; release(r: PauseReason): void; readonly paused: boolean }

/** The planted regression (never shipped): one boolean for every screen; the first release resumes. */
class OneBoolean implements Pauser {
    paused = false;
    constructor(private apply: (on: boolean) => void = () => undefined) {}
    hold(): void { this.paused = true; this.apply(true); }
    release(): void { this.paused = false; this.apply(false); }
}

type V02Holder = 'menu' | 'controls' | 'bake';
/** v0.2 as main shipped it: FlightSession.pause(on, who) over a Set of holders. */
class V02Holders {
    private holds = new Set<V02Holder>();
    pause(on: boolean, who: V02Holder = 'menu'): void {
        if (on) this.holds.add(who);
        else this.holds.delete(who);
    }
    get paused(): boolean { return this.holds.size > 0; }
}

/** One user action: what the v0.3 shell does to the stack, and what v0.2's main.ts did to its holders. */
interface Step { what: string; stack: (s: PauseStack<PauseReason>) => void; v02: (h: V02Holders) => void }
const S = {
    openMenu: { what: 'Esc: the pause menu', stack: (s) => s.hold('menu'), v02: (h) => h.pause(true) },
    menuContinue: { what: 'Continue', stack: (s) => s.release('menu'), v02: (h) => h.pause(false) },
    // v0.2: settings: () => { closePause = null; settingsPanel(...) } - the menu's 'menu' hold carries on
    menuToSettings: { what: 'menu > Settings', stack: (s) => { s.hold('panel'); s.release('menu'); }, v02: () => undefined },
    closeSettings: { what: 'Settings closed', stack: (s) => s.release('panel'), v02: (h) => h.pause(false) },
    // v0.2 openRadio(): session.pause(true, 'controls'); if the menu is up it closes and releases 'menu'
    controlsFromMenu: { what: 'menu > Controls', stack: (s) => { s.hold('controls'); s.release('menu'); }, v02: (h) => { h.pause(true, 'controls'); h.pause(false); } },
    controlsOverPanel: { what: 'the top Controls button over Settings', stack: (s) => s.hold('controls'), v02: (h) => h.pause(true, 'controls') },
    closeControls: { what: 'Controls closed', stack: (s) => s.release('controls'), v02: (h) => h.pause(false, 'controls') }
} satisfies Record<string, Step>;

/** v0.2's sequences: the pause after every step, from the stack and from v0.2's holders. */
const SEQUENCES: readonly (readonly Step[])[] = [
    [S.openMenu, S.menuContinue],
    [S.openMenu, S.menuToSettings, S.closeSettings],
    [S.openMenu, S.menuToSettings, S.controlsOverPanel, S.closeControls, S.closeSettings],
    [S.openMenu, S.menuToSettings, S.controlsOverPanel, S.closeSettings, S.closeControls],
    [S.openMenu, S.controlsFromMenu, S.closeControls]
];

function trace(steps: readonly Step[]): { stack: boolean[]; v02: boolean[] } {
    const s = new PauseStack<PauseReason>(() => undefined);
    const h = new V02Holders();
    const out = { stack: [] as boolean[], v02: [] as boolean[] };
    for (const st of steps) {
        st.stack(s);
        st.v02(h);
        out.stack.push(s.paused);
        out.v02.push(h.paused);
    }
    return out;
}

/** The menu opens settings, the Controls screen opens over it and closes: is the flight still paused? */
function controlsOverSettings(p: Pauser): boolean {
    p.hold('panel');
    p.hold('controls');
    p.release('controls');
    return p.paused;
}

describe('pause stack', () => {
    it('two reasons: releasing one keeps the flight paused, releasing both resumes it', () => {
        const calls: [boolean, readonly PauseReason[]][] = [];
        const s = new PauseStack<PauseReason>((on, reasons) => calls.push([on, reasons]));
        s.hold('menu');
        s.hold('panel');
        s.release('menu');
        expect(s.paused).toBe(true);
        expect(s.reasons).toEqual(['panel']);
        s.release('panel');
        expect(s.paused).toBe(false);
        expect(calls).toEqual([[true, ['menu']], [true, ['menu', 'panel']], [true, ['panel']], [false, []]]);
    });

    it('a repeat hold and a release of a reason not held change nothing and report nothing', () => {
        let n = 0;
        const s = new PauseStack<PauseReason>(() => { n++; });
        s.hold('menu');
        s.hold('menu');
        s.release('panel');
        expect(n).toBe(1);
        s.release('menu');
        expect(s.paused).toBe(false);
        expect(n).toBe(2);
    });

    it('keeps v0.2\'s behaviour: every sequence v0.2 could produce pauses and resumes at the same steps', () => {
        for (const seq of SEQUENCES) {
            const t = trace(seq);
            expect(t.stack, seq.map((x) => x.what).join(' > ')).toEqual(t.v02);
            expect(t.stack[t.stack.length - 1]).toBe(false); // every sequence ends flying
        }
        // the comparison can fail: a stack whose Controls screen shared the panel's reason resumes too early
        const shared = trace([S.openMenu, S.menuToSettings, { ...S.controlsOverPanel, stack: (s) => s.hold('panel') }, { ...S.closeControls, stack: (s) => s.release('panel') }]);
        expect(shared.stack).not.toEqual(shared.v02);
    });

    it('the Controls screen over settings stays paused (as in v0.2); control: a planted one-boolean regression resumes under settings', () => {
        expect(controlsOverSettings(new PauseStack<PauseReason>(() => undefined))).toBe(true);
        const v02 = new V02Holders();
        v02.pause(true); // settings, holding the menu's 'menu'
        v02.pause(true, 'controls');
        v02.pause(false, 'controls');
        expect(v02.paused).toBe(true); // v0.2 did not have this defect
        expect(controlsOverSettings(new OneBoolean())).toBe(false); // the control fires: the planted defect is visible
    });

    it('on the SimClock: no sim time passes while any reason is held (control: the planted one-boolean regression lets 1 s run under a panel)', () => {
        const run = (make: (apply: (on: boolean) => void) => Pauser): number => {
            const clock = new SimClock();
            let now = 0;
            clock.restart(now);
            const p = make((on) => clock.pause(on, now));
            now = 1000; p.hold('menu');     // the pause menu
            now = 1500; p.hold('panel');    // settings opened from it
            now = 2000; p.release('menu');  // the v0.3 shell lets the menu go once settings holds the pause
            now = 3000; p.release('panel'); // settings closed: fly on
            return clock.toSimUs(3000) / 1000; // sim ms flown by the page's 3000 ms
        };
        expect(run((apply) => new PauseStack<PauseReason>((on) => apply(on)))).toBe(1000);
        expect(run((apply) => new OneBoolean(apply))).toBe(2000);
    });
});

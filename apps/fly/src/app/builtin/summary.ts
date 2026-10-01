// End-of-flight stats (docs/architecture-v03.md D.2, item 7). After a disarm with the switch (not a
// crash) and at least 3 s in the air, the goggles-style card shows the flight (ui/osd-stats.ts); it
// goes on arm (or the arm switch flipped on), on a throttle push above 25 %, on any key, after 30 s,
// with a new life; Enter, Esc or its button open
// the full panel. Esc / P open the summary panel (the pause menu, app/menu.ts + ui/pause.ts): the
// stats of this flight, the session and the drone's lifetime beside every menu item with its key,
// and every keyboard shortcut. The lifetime totals per drone (flights, air time, distance, crashes)
// live in the prefs collection 'stats' and are written as they are flown (summary-stats.ts).
// window.__gsfpv.stats() gives the benches the same numbers.
import { KEYMAP } from '@gsfpv/prefs';
import type { DroneTotals } from '@gsfpv/prefs';
import { modeFromChannel } from '@gsfpv/sim-core';
import type { StatsBlock } from '@gsfpv/sim-core';
import { dialogOpen } from '../../devices/keyboard';
import { PRESETS } from '../../presets';
import { StatsCard } from '../../ui/osd-stats';
import type { SummaryData, SummaryShortcut } from '../../ui/summary';
import { PauseMenu } from '../menu';
import { StatsLedger, cardOnDisarm, throttleDismisses, CARD_TIMEOUT_MS, COMMIT_EVERY_MS } from './summary-stats';
import type { Units } from './summary-stats';
import type { Feature, FlightContext } from '../context';

/** What __gsfpv.stats() returns (D.4): the numbers the card and the panel show. */
export interface StatsHook {
    life: StatsBlock;
    session: StatsBlock;
    lifetime: DroneTotals;
    drone: string;
}

// window.__gsfpv.stats (test-hook.ts is the shell's; this feature adds its part, like the others)
declare module '../test-hook' {
    interface TestHook {
        /** D.4: this flight (life), this visit (session) and the drone's lifetime totals, as the card and the summary panel show them */
        stats?: () => StatsHook;
    }
}

/** Keys that leave the card alone: modifiers by themselves, and the latency harness's F13-F24. */
const IGNORED = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$|^F(1[3-9]|2[0-4])$/;

/** Every shipped binding of the keymap, as the panel lists it (with the router's key-caps). */
function shortcuts(ctx: FlightContext): SummaryShortcut[] {
    return KEYMAP.filter((b) => b.status === 'shipped').map((b) => ({ action: b.action, labelKey: b.labelKey, keys: ctx.keys.caps(b.action), flying: !!b.flying }));
}

export const summary: Feature = {
    id: 'summary',
    install(ctx) {
        const ledger = new StatsLedger(ctx.prefs);
        // the session's stats object is replaced with the flight model (and the session with the scene)
        const sync = (): void => { if (ctx.session.stats) ledger.track(ctx.session.stats, ctx.session.presetId); };
        sync();
        const units = (): Units => (ctx.prefs.get('display.units') === 'imperial' ? 'imperial' : 'metric');
        const enabled = (): boolean => ctx.prefs.get('stats.onDisarm') !== false;
        // the mode the flight model flies now (sim-core modeFromChannel on the mode channel): what the
        // HUD and the mode chip show, whichever input or setting put it there
        const mode = (): string | null => (ctx.session.sim ? modeFromChannel(ctx.session.sim.ch[5]) : null);
        const throttle = (): number => (ctx.session.sim ? (ctx.session.sim.ch[2] + 1) * 0.5 : 0);
        // the arm switch as the pilot set it, before the arm gate (which holds it low while arming is refused)
        const armSwitchOn = (): boolean => ctx.controls.source !== 'sim' && ctx.controls.view().ch[4] > 0.5;

        const data = (): SummaryData => {
            sync();
            const id = ctx.session.presetId;
            return { mode: mode(), life: ledger.life(), session: ledger.session(), lifetime: ledger.lifetime(), drone: PRESETS[id]?.name ?? id, units: units(), shortcuts: shortcuts(ctx) };
        };
        // the menu must open whatever happens here: without the data it is the menu alone
        if (ctx.menu instanceof PauseMenu) ctx.menu.setSummary(() => { try { return data(); } catch (e) { console.error('summary panel data', e); return null; } });

        // ---- the card
        let card: StatsCard | null = null;
        let cardAt = 0;
        /** the life's air time on the card: a new life (a respawn, a new flight model) has less, and the card goes */
        let cardAir = 0;
        let thrAtCard = 0;
        let offKeys: (() => void) | null = null;
        const closeCard = (): void => {
            card?.remove();
            card = null;
            offKeys?.();
            offKeys = null;
        };
        const openPanel = (): void => {
            closeCard();
            ctx.menu.open();
        };
        const showCard = (): void => {
            closeCard();
            const life = ledger.life();
            card = new StatsCard(ctx.ui, life, units(), openPanel);
            cardAt = performance.now();
            cardAir = life.airtimeS;
            thrAtCard = throttle();
            const onKey = (e: KeyboardEvent): void => {
                if (IGNORED.test(e.code) || dialogOpen()) return;
                if (e.code === 'Enter' || e.code === 'NumpadEnter') {
                    // no keypress after this, so the focused first menu item is not pressed as well
                    e.preventDefault();
                    openPanel();
                    return;
                }
                // Esc and P open the panel through the router (pause.toggle); the pause takes the card away
                if (e.code === 'Escape' || e.code === 'KeyP') return;
                closeCard();
            };
            addEventListener('keydown', onKey, { capture: true });
            offKeys = () => removeEventListener('keydown', onKey, { capture: true });
        };

        ctx.events.on('sim', (e) => {
            sync();
            if (e.type === 'arm' || e.type === 'respawn') closeCard();
            else if (e.type === 'crash') { closeCard(); ledger.commit(); }
            else if (e.type === 'disarm') {
                ledger.commit();
                if (cardOnDisarm(e, ledger.life(), enabled())) showCard();
            }
        });
        let lastCommit = performance.now();
        ctx.events.on('frame', ({ now }) => {
            sync();
            // a respawn between ticks emits no runner event (sim-core runner.ts emits only what a step
            // produced), so a new life is seen here: its air time starts again from zero
            // the arm switch flipped on closes it too, also when the gate refuses to arm (the "how to arm" card it covers comes back)
            if (card && (now - cardAt > CARD_TIMEOUT_MS || throttleDismisses(thrAtCard, throttle()) || armSwitchOn() || ledger.life().airtimeS + 1e-9 < cardAir)) closeCard();
            if (now - lastCommit > COMMIT_EVERY_MS) {
                lastCommit = now;
                ledger.commit();
            }
        });
        ctx.events.on('life', () => closeCard());
        ctx.events.on('pause', ({ on }) => {
            if (!on) return;
            closeCard();
            sync();
            ledger.commit();
        });
        // leaving the page: the totals flown so far go into the store and the store to disk now (its
        // own pagehide flush ran before this listener)
        const leave = (): void => {
            sync();
            ledger.commit();
            ctx.prefs.flush();
        };
        addEventListener('pagehide', leave);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });

        ctx.hook.stats = () => {
            sync();
            return { life: ledger.life(), session: ledger.session(), lifetime: ledger.lifetime(), drone: ledger.currentDrone };
        };
    }
};

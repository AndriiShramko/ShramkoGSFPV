// The "How to fly" card on the page (v0.10 lane K; docs/wip/v10-k.md; the owner's message 23, item 1: a gamer on the keyboard found
// no word that Space flies up and Shift flies down).
//  - It opens by itself once per visit, when the scan is ready, an input is chosen and nothing else is up for a moment (no Controls
//    screen, no panel, no pause menu, no picker, no crash panel): so it follows the choice made on the Controls screen and is
//    never on top of that screen or of the motion notice (which comes before the scan loads). Not on test pages (?nowarn,
//    ?simradio, ?lat) and not after "Do not show again" (prefs input.howToFly).
//  - K and the pause menu's "How to fly" open it any time; K closes it again. It replaces the old K, which pinned the keyboard's
//    ground card (its game rows live in this card now; the pilot keyboard's ground card stays, ui/hud.ts).
//  - It holds the flight paused (the 'panel' reason) while it is up. Start flying closes it and, for the game scheme, the pause's
//    release asks for the mouse inside that click (app/builtin/play.ts: every resume of a game-scheme flight does), which is the
//    user activation pointer lock needs. x and Esc close it and change nothing else.
//  - A scene switch closes it (the card belongs to the scene flown; the pause goes with it).
//  window.__gsfpv.howToFly: its state, for tools/bench/src/accept-v10-keys.ts.
import { dialogOpen } from '../../devices/keyboard';
import { SETTLE_MS, Settle, cardKind, cardModel, shouldOpen } from '../../ui/controls-card-logic';
import type { CardEnv, CardKind } from '../../ui/controls-card-logic';
import { buildHowToFlyCard } from '../../ui/controls-card';
import type { HowToFlyCard } from '../../ui/controls-card';
import { t } from '../../i18n';
import { q } from '../env';
import type { Feature } from '../context';

declare module '../test-hook' {
    interface TestHook {
        howToFly?: () => {
            /** the card is on the screen */
            open: boolean;
            kind: CardKind | null;
            /** it has opened in this visit (by itself or by K / the menu) */
            shown: boolean;
            /** how many times it opened in this visit, and how each opened */
            opened: string[];
            /** the setting: false after "Do not show again" */
            enabled: boolean;
            /** a test page: it never opens by itself */
            testPage: boolean;
        };
    }
}

/** The page is a test page: its first-visit notices are off, and so is this card's opening by itself. */
function isTestPage(): boolean {
    return q.get('nowarn') === '1' || !!q.get('simradio') || q.get('lat') === '1';
}

export const howToFly: Feature = {
    id: 'how-to-fly',
    install(ctx) {
        const prefs = ctx.prefs;
        const testPage = isTestPage();
        const settle = new Settle(SETTLE_MS);
        let card: { ui: HowToFlyCard; kind: CardKind; from: Element | null } | null = null;
        let shown = false;
        const opened: string[] = [];

        const enabled = (): boolean => prefs.get('input.howToFly') !== false;
        const env = (): CardEnv => {
            const v = ctx.controls.view();
            return {
                t,
                caps: (action) => ctx.keys.caps(action).map((k) => k.cap),
                // the left touch stick climbs and sinks only under easy play with the altitude help on
                altitudeHelp: ctx.controls.play === 'easy' && prefs.get('input.altitudeHelp') !== false,
                armKind: v.armKind,
                armLabel: v.armLabel
            };
        };
        /** Something else is on the screen that the card must not stand on or over. */
        const busy = (): boolean => dialogOpen() || ctx.menu.isOpen || ctx.session.paused || ctx.scenes.busy
            || ctx.ui.querySelector('.crash-overlay, .loading') !== null;

        function open(how: 'auto' | 'key' | 'menu'): void {
            if (card) return;
            // before an input is chosen the card is the game's (a K press with nothing chosen yet)
            const kind = cardKind(ctx.controls.source, ctx.controls.play) ?? 'game';
            const from = document.activeElement;
            shown = true; // whatever happens next, it does not try again in this visit by itself
            let ui: HowToFlyCard;
            try {
                ui = buildHowToFlyCard(cardModel(kind, env()), {
                    hideChecked: !enabled(),
                    onStart: () => close('start'),
                    onClose: () => close('close'),
                    // written at once: x, Esc and K keep the choice too
                    onHide: (hidden) => { prefs.set('input.howToFly', !hidden); }
                });
            } catch (e) {
                // a card that cannot be drawn must not hold the flight: nothing was paused yet
                console.error('how to fly: the card could not be built', e);
                return;
            }
            ctx.pause('panel');
            ctx.ui.append(ui.root);
            ui.focusStart();
            card = { ui, kind, from };
            opened.push(how);
        }

        function close(how: 'start' | 'close' | 'key' | 'scene'): void {
            if (!card) return;
            const c = card;
            card = null;
            c.ui.root.remove();
            // the release comes after the card is gone: a game-scheme flight asks for the mouse in that release (app/builtin/play.ts),
            // inside the click that pressed Start, which is the user activation pointer lock needs
            ctx.resume('panel');
            // Start flies; anything else hands the focus back to where it was (if that is still on the page)
            if (how !== 'start' && c.from instanceof HTMLElement && c.from.isConnected) c.from.focus({ preventScroll: true });
        }

        // K: the card, and K again closes it. Over another screen, nothing (the Controls screen and the panels own their keys)
        const offKey = ctx.keys.on('help.keys', (e) => {
            if (e.repeat) return;
            if (card) { close('key'); return; }
            if (dialogOpen() || ctx.ui.querySelector('.crash-overlay') !== null) return;
            open('key');
        });
        // the pause menu's item; with the menu up K runs it as well (app/menu.ts: a key shown beside an item is that item)
        const offItem = ctx.menu.add({ id: 'pause.howtofly', action: 'help.keys', labelKey: 'pause.howToFly', order: 55, section: 'setup', run: () => open('menu') });

        // by itself: when the scan is ready, an input is chosen and the page has been free of other screens for a moment
        let lastAt = 0;
        const offFrame = ctx.events.on('frame', ({ now }) => {
            if (now - lastAt < 100) return;
            lastAt = now;
            if (shown || card) return;
            const free = settle.free(now, !busy());
            if (free && shouldOpen({ enabled: enabled(), testPage, shown, source: ctx.controls.source, play: ctx.controls.play, blocked: false, hidden: document.hidden })) open('auto');
        });
        // a new scene: the card (and its pause) go with the scene it was opened over
        const offSession = ctx.events.on('session', () => close('scene'));

        ctx.hook.howToFly = () => ({
            open: card !== null,
            kind: card?.kind ?? null,
            shown,
            opened: [...opened],
            enabled: enabled(),
            testPage
        });

        return () => {
            offKey(); offItem(); offFrame(); offSession();
            if (card) close('scene');
        };
    }
};


// Sharing in a flight (the owner's message 18, item 6: "the share button is not hidden in a menu: a
// pilot can share the scene they fly or flew at any moment"; docs/wip/v07-d1.md section 1). Every
// place opens the one share panel (share/panel.ts) with its own entry point (share/links.ts):
//   top    a button always on the top bar: icon and "Share" on a computer, the icon on a phone
//   key    L ("link"), in flight and over the crash
//   pause  the pause menu (the summary panel), and its "Nice flight" row after 30 s in the air
//   card   the stats card after a disarm (ui/osd-stats.ts, builtin/summary.ts)
//   crash  the crash panel (builtin/crash.ts)
//   video  after a recording stops: "Share your flight" on the recording bar (builtin/cinema.ts)
// In a flight the link is the picture page /s/<id> of the view as it is (share/picture.ts); the
// picker's cards share the scene's page (ui/scenes.ts, share/links.ts).
// The scene goes out with the settings it is flown with that differ from its defaults (v0.9 item 15,
// share/shared.ts) and drawn as it is flown (lane R: SuperSplat's ?budget= and ?stochastic, the link it
// was opened with over the catalogue's render), taken from ctx.scene when the share starts, so after
// an in-page scene switch it is the new scene's: the plain link is its fly deep link (flyDeepLink) and
// POST /api/share sends it as `render`, so /s/<id> opens the same deep link (share/links.ts).
import { DT } from '@gsfpv/sim-core';
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { dialogOpen } from '../../devices/keyboard';
import { PauseMenu } from '../menu';
import { openSharePanel, shareState } from '../../share/panel';
import type { ShareRequest, ShareState } from '../../share/panel';
import { flightDrawing } from '../../share/links';
import type { ShareEntry } from '../../share/links';
import { drawingPick, sharedOf } from '../../share/shared';
import { sharePicture } from '../../share/picture';
import { shareIcon } from '../../share/icon';
import { creditText } from '../../scene-facts';
import { sceneCredit } from './scene';
import type { Feature, FlightContext } from '../context';

/** a flight this long (armed, seconds) earns the summary panel's "Nice flight" row */
const NICE_S = 30;

// window.__gsfpv.share: the last share panel (entry, link, words), for the acceptance
declare module '../test-hook' {
    interface TestHook {
        share?: { state: () => ShareState | null; open: (entry: ShareEntry) => void };
    }
}

/** What a share from this flight sends: the scene flown now and how it is drawn, the picture of the view, and the place's extras. */
export function flightShareRequest(ctx: FlightContext, entry: ShareEntry, extra: Pick<ShareRequest, 'speed' | 'video'> = {}): ShareRequest {
    const scene = sceneCredit(ctx);
    return {
        entry,
        scene,
        drawing: flightDrawing(ctx.scene, drawingPick(ctx.prefs)),
        // what he flies this scene with that the scene does not (v0.9): Scene size, walls, cleanup, wind, ceiling, drone
        shared: sharedOf(ctx.prefs, ctx.scene.id, { meta: ctx.scene.meta, hasWalls: !!ctx.session.baseCollision }),
        ...extra,
        picture: () => sharePicture(ctx.renderer, ctx.canvas, {
            hook: t('share.hook'),
            tagline: t('share.tagline'),
            cta: `${t('share.cta')} →`,
            credit: t('share.scanBy', { credit: creditText(scene) })
        })
    };
}

/** Opens the share panel over the flight (paused while it is up); nothing when another dialog is up. */
export function openFlightShare(ctx: FlightContext, entry: ShareEntry, extra: Pick<ShareRequest, 'speed' | 'video'> = {}): void {
    // over another dialog (settings, the picker) a second one would stack; the pause menu gives way
    if (dialogOpen() && !ctx.menu.isOpen) return;
    if (ctx.menu.isOpen) ctx.menu.close();
    openSharePanel({ parent: ctx.ui, onOpen: () => ctx.pause('panel'), onClose: () => ctx.resume('panel') }, flightShareRequest(ctx, entry, extra));
}

function mmss(s: number): string {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Sharing in a flight: the top bar's Share, L, the pause menu's item and its "Nice flight" row. */
export const share: Feature = {
    id: 'share',
    install(ctx) {
        // the top bar (builtin/top.ts): first of its buttons, after the recording dot
        const caps = ctx.keys.caps('share.open');
        const name = `${t('share.menu')}${caps.length ? ` (${caps.map((c) => c.cap).join(', ')})` : ''}`;
        const btn = h('button', { type: 'button', class: 'btn share-top', 'data-action': 'share-top', 'aria-label': name, title: name, 'aria-keyshortcuts': caps.map((c) => c.aria).join(' ') || undefined, onclick: () => openFlightShare(ctx, 'top') },
            h('span', { class: 'share-top-label' }, t('share.button')));
        btn.prepend(shareIcon());
        const top = ctx.ui.querySelector('.top-actions');
        const gear = top?.querySelector('.gear');
        if (gear) gear.before(btn);
        else top?.prepend(btn);

        // the crash on screen now (its speed), so L over a crash shares it with the crash's words
        let crashSpeed: number | null = null;
        ctx.keys.on('share.open', (e) => {
            if (e.repeat || dialogOpen()) return;
            e.preventDefault();
            if (crashSpeed !== null && ctx.crash.active) openFlightShare(ctx, 'crash', { speed: crashSpeed });
            else openFlightShare(ctx, 'key');
        });
        ctx.menu.add({ id: 'pause.share', action: 'share.open', labelKey: 'share.menu', order: 35, section: 'scene', run: () => openFlightShare(ctx, 'pause') });

        // the armed time of this flight and of the last one (sim ticks): what makes a flight "nice"
        let armedAt: number | null = null;
        let last = 0;
        ctx.events.on('sim', (e) => {
            if (e.type === 'crash') crashSpeed = e.speed;
            else if (e.type === 'arm' || e.type === 'respawn') crashSpeed = null;
            if (e.type === 'arm') armedAt = e.tick;
            else if ((e.type === 'crash' || e.type === 'disarm' || e.type === 'respawn') && armedAt !== null) {
                last = (e.tick - armedAt) * DT;
                armedAt = null;
            }
        });
        ctx.events.on('crashCleared', () => { crashSpeed = null; });
        ctx.events.on('session', () => { armedAt = null; last = 0; crashSpeed = null; });
        if (ctx.menu instanceof PauseMenu) {
            ctx.menu.addRow(() => {
                const now = armedAt !== null ? (ctx.session.sim.tick - armedAt) * DT : 0;
                const best = Math.max(now, last);
                if (best < NICE_S) return null;
                return h('div', { class: 'share-nice', 'data-testid': 'share-nice' },
                    h('span', {}, t('share.nice', { time: mmss(best) })),
                    h('button', { type: 'button', class: 'btn primary', 'data-action': 'share-open', onclick: () => openFlightShare(ctx, 'pause') }, t('share.menu')));
            });
        }
        ctx.hook.share = { state: shareState, open: (entry) => openFlightShare(ctx, entry) };
    }
};

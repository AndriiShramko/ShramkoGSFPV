// Respawns (docs/architecture-v03.md C.4-C.8, C.10; items 16, 18, 23, 3). The flight model decides
// them itself (session.director): after a crash, when stuck, R and Y. This feature hands it the
// pilot's rules from the settings, sends every new life to the page (events 'life'), takes the
// crash away when the craft is back, and shows "-5 s" after a rewind.
// - R: back to the start, on the platform, armed if the switch is on; with the menu up it is the
//   menu's Restart (a fresh flight model at the spawn).
// - Y: back rewindS along the path now (from the crash when crashed); also a menu item.
// - crash.enabled (item 3) is a 'life' setting: it applies when the flight runs again (A.7).
import { V02_PAUSE_ITEMS } from '@gsfpv/prefs';
import type { PrefsStore } from '@gsfpv/prefs';
import type { Life, RespawnPolicy } from '@gsfpv/sim-core';
import { rewindLabel } from '../../ui/crash-overlay';
import { t } from '../../i18n';
import type { FlightSession } from '../../session';
import type { Feature, FlightContext } from '../context';

/** The settings the respawn rules are made of (A.8, the crash group). */
export const POLICY_IDS: readonly string[] = ['respawn.auto', 'respawn.delayS', 'respawn.target', 'respawn.rewindS', 'respawn.platform', 'respawn.keepArmed', 'respawn.unstuck', 'battery.refill'];

/** The respawn rules from the settings. scenes.autoSwitch (next scene after a crash) arrives with wave 3 (E.5). */
export function policyFrom(prefs: PrefsStore): RespawnPolicy {
    const n = (id: string): number => Number(prefs.get(id));
    return {
        auto: prefs.get<boolean>('respawn.auto') === true,
        delayTicks: Math.round(n('respawn.delayS') * 1000),
        rewindTicks: Math.round(n('respawn.rewindS') * 1000),
        target: prefs.get<string>('respawn.target') === 'start' ? 'start' : 'rewind',
        onCrash: 'respawn',
        platform: prefs.get<boolean>('respawn.platform') === true,
        keepArmed: prefs.get<boolean>('respawn.keepArmed') === true,
        unstuck: prefs.get<boolean>('respawn.unstuck') === true,
        refill: ((v) => (v === 'respawn' || v === 'never' ? v : 'start'))(prefs.get<string>('battery.refill'))
    };
}

/** The life's start as the page reports it (AppEvents 'life'). */
function lifeEvent(life: Life): { index: number; reason: Life['header']['life']['reason'] } {
    return { index: life.header.life.index, reason: life.header.life.reason };
}

export const respawn: Feature = {
    id: 'respawn',
    install(ctx) {
        const prefs = ctx.prefs;
        const attach = (s: FlightSession): void => {
            s.setRespawnPolicy(policyFrom(prefs));
            s.onLife = (life) => ctx.events.emit('life', lifeEvent(life));
            // the first flight model was built before the settings were read: when its start (the
            // platform, item 16) or its crash rule (item 3) differ from them, a fresh one at the spawn
            const crashOn = prefs.get<boolean>('crash.enabled') !== false;
            const changed = s.setCrashOn(crashOn);
            if (changed || (s.startOpts.platform === true) !== s.policy.platform) s.rebuildSim(s.presetId, s.overrides);
        };
        attach(ctx.session);
        ctx.events.on('session', attach); // a new scene (E.4, wave 3)

        // a 'life' setting changed while a panel was up applies when the flight runs again (A.7)
        let lifePending = false;
        const flushLife = (): void => {
            const s = ctx.session;
            if (!lifePending || s.paused) return;
            lifePending = false;
            s.applyLifeSettings(s.presetId, s.overrides);
        };
        prefs.onChange((c) => {
            if (POLICY_IDS.includes(c.id)) ctx.session.setRespawnPolicy(policyFrom(prefs));
            if (c.id === 'crash.enabled' && ctx.session.setCrashOn(prefs.get<boolean>('crash.enabled') !== false)) {
                lifePending = true;
                flushLife();
            }
        });
        ctx.events.on('pause', (p) => { if (!p.on) flushLife(); });

        ctx.events.on('life', (l) => onLife(ctx, l.reason));

        ctx.menu.add({
            id: 'pause.restart', action: V02_PAUSE_ITEMS.restart, labelKey: 'pause.restart', order: 20, section: 'flight',
            run: () => {
                ctx.clearCrash();
                ctx.session.rebuildSim(ctx.session.presetId, ctx.session.overrides);
            }
        });
        ctx.menu.add({ id: 'pause.rewind', action: 'respawn.rewind', labelKey: 'respawn.menuRewind', order: 21, section: 'flight', run: () => ctx.session.rewind() });
        ctx.keys.on('respawn.start', () => ctx.session.respawnStart());
        ctx.keys.on('respawn.rewind', () => ctx.session.rewind());
    }
};

let dropLabel: (() => void) | null = null;

/** A new life: the crash goes, a rewind says how far back it went; touch sticks keep their arm state when the switch is kept (C.3). */
function onLife(ctx: FlightContext, reason: Life['header']['life']['reason']): void {
    const s = ctx.session;
    if (ctx.crash.active || s.cameraOverride || s.replaying) ctx.clearCrash();
    dropLabel?.();
    dropLabel = null;
    const d = s.director?.last;
    if (d && d.kind === 'rewind' && d.tick === s.sim.tick && d.pathAgeTicks !== null && reason !== 'settings' && reason !== 'start') {
        const back = Math.round(d.pathAgeTicks / 1000);
        const stuck = reason === 'stuck-flipped' || reason === 'stuck-wedged';
        dropLabel = rewindLabel(ctx.ui, t(stuck ? 'respawn.stuckMinus' : 'respawn.minus', { s: String(back) }));
    }
    if (reason !== 'settings' && !s.policy.keepArmed) ctx.input.touch?.setArmed(false);
}

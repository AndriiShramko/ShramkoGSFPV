// The pause menu's Settings (v0.2 panel, ui/panels.ts): camera, HUD, quality and physics. Apply
// builds a new flight model with the values; the prefs-driven panel of wave 2 replaces this.
import type { ParamOverrides } from '@gsfpv/sim-core';
import { settingsPanel } from '../../ui/panels';
import type { SettingsValues } from '../../ui/panels';
import type { FlightSession } from '../../session';
import { newLife } from '../lives';
import type { Feature } from '../context';

function settingsFrom(s: FlightSession): SettingsValues {
    const o = s.overrides;
    return {
        fov: o.fovDeg ?? s.params.cameraFovDeg,
        uptilt: o.uptiltDeg ?? s.params.cameraUptiltDeg,
        hud: true,
        units: 'metric',
        quality: 0.7,
        gravity: o.gravity ?? 9.81,
        gravityMode: o.gravityMode ?? 'honest',
        vCrash: o.vCrash ?? s.params.vCrash,
        tauMs: o.tauMs ?? s.params.tau * 1000,
        cdaScale: o.cdaScale ?? 1,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        pid: { roll: [...s.params.pid.roll], pitch: [...s.params.pid.pitch], yaw: [...s.params.pid.yaw] }
    };
}

export const settings: Feature = {
    id: 'settings',
    install(ctx) {
        ctx.menu.add({
            id: 'pause.settings', action: null, labelKey: 'pause.settings', order: 60, section: 'setup',
            run: () => {
                ctx.pause('panel');
                const s = ctx.session;
                settingsPanel(ctx.ui, settingsFrom(s), s.params.twr, (v) => {
                    ctx.hud.visible = v.hud;
                    ctx.crash.reducedMotion = v.reducedMotion;
                    ctx.events.emit('quality', { value: v.quality });
                    const o: ParamOverrides = { ...ctx.session.overrides, fovDeg: v.fov, uptiltDeg: v.uptilt, gravity: v.gravity, gravityMode: v.gravityMode, vCrash: v.vCrash, tauMs: v.tauMs, cdaScale: v.cdaScale, pid: v.pid };
                    newLife(ctx, 'settings', () => ctx.session.rebuildSim(ctx.session.presetId, o));
                    ctx.resume('panel');
                }, () => ctx.resume('panel'));
            }
        });
    }
};

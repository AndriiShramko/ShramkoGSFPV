// The menu's "Settings" (ui/panels.ts settingsPanel): camera, HUD, quality and the physics overrides
// wait for Apply (a new flight model); the walls switch and the voxel grid apply at once. Wave 2
// (W2-1) replaces this with the settings generated from the preferences schema.
import type { ParamOverrides } from '@gsfpv/sim-core';
import { settingsPanel } from '../../ui/panels';
import type { SettingsValues } from '../../ui/panels';
import { wallsVoxelsControls } from '../../ui/voxels';
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import type { FlightSession } from '../../session';
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
                const session = ctx.session;
                ctx.pause('panel');
                const wallsVoxels = h('section', { class: 'set-section', 'data-testid': 'settings-walls-voxels' }, h('h3', {}, t('settings.wallsVoxels')), wallsVoxelsControls(ctx.voxels, ctx.walls, 'set'));
                settingsPanel(ctx.ui, settingsFrom(session), session.params.twr, (v) => {
                    ctx.hud.visible = v.hud;
                    ctx.crash.reducedMotion = v.reducedMotion;
                    ctx.quality.setUser(v.quality);
                    const o: ParamOverrides = { ...session.overrides, fovDeg: v.fov, uptiltDeg: v.uptilt, gravity: v.gravity, gravityMode: v.gravityMode, vCrash: v.vCrash, tauMs: v.tauMs, cdaScale: v.cdaScale, pid: v.pid };
                    ctx.clearCrash();
                    session.rebuildSim(session.presetId, o);
                    ctx.resume('panel');
                }, () => ctx.resume('panel'), [wallsVoxels]);
            }
        });
    }
};

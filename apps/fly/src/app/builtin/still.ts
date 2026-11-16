// More detail while the craft is still (lane loadq, the owner's message 59, decision G6, docs/wip/loadq.md): while the
// craft's speed, turn rate and sticks are near rest, or the flight is paused, the splat budget rises step by step as
// long as the frames stay under the still picture's bound and the device's memory allows; a stick move or the end of a
// pause sets the base back in the same frame. The rule: app/detail-rule.ts StillRise. Settings, Display: "More detail
// at rest" (display.stillDetail) switches it off.
// loadq2: the rise stops at 4 times the flight's budget (2 on a phone or tablet) and at the memory cap (R3); a lost
// graphics device or an out-of-memory error while the still budget stands puts the flight's budget back, switches the
// setting off on this device and the detail line says so once (R3); the view turning or moving is a move, also in a
// pause (R5: the camera is read, whatever turns it).
import { S } from '@gsfpv/sim-core';
import type { Feature } from '../context';
import { StillRise, stillCapM, STILL_OFF_SHOW_MS } from '../detail-rule';

const RAD_TO_DEG = 180 / Math.PI;

interface V3 { x: number; y: number; z: number }

/** The angle between two unit vectors, degrees. */
function angleDeg(a: V3, b: V3): number {
    const d = a.x * b.x + a.y * b.y + a.z * b.z;
    return Math.acos(Math.max(-1, Math.min(1, d))) * RAD_TO_DEG;
}

export const still: Feature = {
    id: 'still',
    install(ctx) {
        const rule = new StillRise();
        const capM = stillCapM((navigator as Navigator & { deviceMemory?: number }).deviceMemory);
        let paused = false;
        let last = 0;
        let fwd0: V3 | null = null, up0: V3 | null = null, pos0: V3 | null = null;
        let viewTurnDegS = 0, viewSpeed = 0;
        let trouble: { kind: string; at: number; boostM: number } | null = null;
        const enabled = (): boolean => ctx.prefs.get<boolean>('display.stillDetail') !== false;
        const offPause = ctx.events.on('pause', ({ on }) => { paused = on; });
        // R3: the device lost or out of memory while the still budget stands: the flight's budget, the setting off, said once
        const offTrouble = ctx.renderer.onGpuTrouble((kind) => {
            const boostM = ctx.quality.stillBudgetMillions;
            if (boostM <= 0) return;
            trouble = { kind, at: performance.now(), boostM };
            rule.boostM = 0;
            ctx.quality.setStillBudget(0);
            ctx.prefs.set('display.stillDetail', false);
            ctx.quality.stillOffUntil = performance.now() + STILL_OFF_SHOW_MS;
        });
        const offFrame = ctx.events.on('frame', ({ now }) => {
            const sim = ctx.session.runner.sim;
            const s = sim.s;
            const ch = sim.ch;
            const speed = Math.sqrt(s[S.vx] * s[S.vx] + s[S.vy] * s[S.vy] + s[S.vz] * s[S.vz]);
            const turn = Math.max(Math.abs(s[S.wx]), Math.abs(s[S.wy]), Math.abs(s[S.wz])) * RAD_TO_DEG;
            const frameMs = last > 0 ? now - last : 0;
            last = now;
            // R5: the view's own turn and move since the last frame (the camera, whatever moved it)
            const cam = ctx.renderer.camera;
            const f = cam.forward, u = cam.up, p = cam.getPosition();
            const fwd = { x: f.x, y: f.y, z: f.z }, up = { x: u.x, y: u.y, z: u.z }, pos = { x: p.x, y: p.y, z: p.z };
            if (fwd0 && up0 && pos0 && frameMs > 0) {
                viewTurnDegS = Math.max(angleDeg(fwd0, fwd), angleDeg(up0, up)) * 1000 / frameMs;
                const dx = pos.x - pos0.x, dy = pos.y - pos0.y, dz = pos.z - pos0.z;
                viewSpeed = Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000 / frameMs;
            }
            fwd0 = fwd; up0 = up; pos0 = pos;
            const sample = { now, paused, speed, turnDegS: turn, roll: ch[0], pitch: ch[1], yaw: ch[3], throttle: ch[2], frameMs, viewTurnDegS, viewSpeed };
            if (rule.frame(sample, ctx.quality.baseBudgetMillions, capM, enabled() && !ctx.quality.cinema, ctx.quality.keeperCalm, ctx.quality.touchDevice)) {
                ctx.quality.setStillBudget(rule.boostM);
            }
        });
        ctx.hook.still = () => ({ boostM: rule.boostM, baseM: ctx.quality.baseBudgetMillions, capM, paused, enabled: enabled(), touch: ctx.quality.touchDevice, viewTurnDegS, viewSpeed, trouble });
        return () => { offPause(); offFrame(); offTrouble(); ctx.quality.setStillBudget(0); };
    }
};

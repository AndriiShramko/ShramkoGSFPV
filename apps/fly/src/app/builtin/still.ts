// More detail while the craft is still (lane loadq, the owner's message 59, decision G6, docs/wip/loadq.md): while the
// craft's speed, turn rate and sticks are near rest, or the flight is paused, the splat budget rises step by step as
// long as the frames stay under the still picture's bound and the device's memory allows; a stick move or the end of a
// pause sets the base back in the same frame. The rule: app/detail-rule.ts StillRise. Settings, Display: "More detail
// at rest" (display.stillDetail) switches it off.
import { S } from '@gsfpv/sim-core';
import type { Feature } from '../context';
import { StillRise, stillCapM } from '../detail-rule';

const RAD_TO_DEG = 180 / Math.PI;

export const still: Feature = {
    id: 'still',
    install(ctx) {
        const rule = new StillRise();
        const capM = stillCapM((navigator as Navigator & { deviceMemory?: number }).deviceMemory);
        let paused = false;
        let last = 0;
        const enabled = (): boolean => ctx.prefs.get<boolean>('display.stillDetail') !== false;
        const offPause = ctx.events.on('pause', ({ on }) => { paused = on; });
        const offFrame = ctx.events.on('frame', ({ now }) => {
            const sim = ctx.session.runner.sim;
            const s = sim.s;
            const ch = sim.ch;
            const speed = Math.sqrt(s[S.vx] * s[S.vx] + s[S.vy] * s[S.vy] + s[S.vz] * s[S.vz]);
            const turn = Math.max(Math.abs(s[S.wx]), Math.abs(s[S.wy]), Math.abs(s[S.wz])) * RAD_TO_DEG;
            const frameMs = last > 0 ? now - last : 0;
            last = now;
            const sample = { now, paused, speed, turnDegS: turn, roll: ch[0], pitch: ch[1], yaw: ch[3], throttle: ch[2], frameMs };
            if (rule.frame(sample, ctx.quality.baseBudgetMillions, capM, enabled() && !ctx.quality.cinema)) {
                ctx.quality.setStillBudget(rule.boostM);
            }
        });
        ctx.hook.still = () => ({ boostM: rule.boostM, baseM: ctx.quality.baseBudgetMillions, capM, paused, enabled: enabled() });
        return () => { offPause(); offFrame(); ctx.quality.setStillBudget(0); };
    }
};

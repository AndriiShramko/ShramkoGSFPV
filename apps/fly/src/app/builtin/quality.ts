// Render quality: the frame governor holds the display's frame rate under the ceiling the
// settings "quality" sets; cinema mode renders at the ceiling with the full splat budget.
import { FrameGovernor } from '@gsfpv/render-pc';
import { q } from '../env';
import type { Feature } from '../context';

// The v0.2 settings panel and cinema mode reach the governor through these two events until the
// prefs store carries display.quality (wave 2, docs/architecture-v03.md A.7).
declare module '../context' {
    interface AppEvents {
        /** the settings panel's quality slider, 0..1 (0 = stable frame, 1 = detail) */
        quality: { value: number };
        cinema: { on: boolean };
    }
}

export const quality: Feature = {
    id: 'quality',
    install(ctx) {
        const renderer = ctx.renderer;
        const governor = new FrameGovernor();
        governor.enabled = q.get('governor') !== '0';
        ctx.hook.governor = governor;
        let userMaxScale = renderer.renderScale;
        let userBudget = 4;
        let cinemaOn = false;
        let frameDelay = 0; // test only (hook.setFrameDelay): burn CPU in each frame to simulate overload mid-flight
        ctx.hook.setFrameDelay = (ms: number) => { frameDelay = Math.max(0, Math.min(200, ms)); };
        const apply = (): void => {
            if (cinemaOn) {
                renderer.setRenderScale(userMaxScale);
                renderer.setSplatBudgetMillions(16);
                return;
            }
            const st = governor.current;
            renderer.setRenderScale(Math.min(userMaxScale, st.renderScale));
            renderer.setSplatBudgetMillions(Math.min(userBudget, st.splatBudgetMillions));
        };
        ctx.events.on('frame', ({ now }) => {
            if (frameDelay > 0) { const end = now + frameDelay; while (performance.now() < end) { /* simulated overload */ } }
            if (!cinemaOn && governor.onFrame(now)) apply();
        });
        ctx.events.on('quality', ({ value }) => {
            userMaxScale = 0.5 + value * 0.5;
            userBudget = 1 + value * 3;
            apply();
        });
        ctx.events.on('cinema', ({ on }) => {
            cinemaOn = on;
            governor.enabled = !on && q.get('governor') !== '0';
            apply();
        });
    }
};

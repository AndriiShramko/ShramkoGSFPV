// Train 2 integration: the course's lap clock and its lines are not drawn over the pause menu or another full window
// (apps/fly/src/course/cover.ts coveredBy, wired in app/builtin/course.ts on the 'pause' event; the class is hidden by
// course/hud.css). The page check with the pictures is tools/bench/scripts/pause-over-course-probe.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FLY = fileURLToPath(new URL('../../../apps/fly/src/', import.meta.url));
const read = (p: string): string => readFileSync(FLY + p, 'utf8');

describe('course hud: not drawn over the pause menu', () => {
    it('the feature hides the lap block by the pause reasons, and the style sheet hides the class', () => {
        const feature = read('app/builtin/course.ts');
        expect(feature.includes('hud.cover(coveredBy(reasons))')).toBe(true);
        const css = read('course/hud.css');
        expect(/\.course-hud\.course-covered,[\s\S]*?display:\s*none/.test(css)).toBe(true);
        expect(read('course/hud.ts').includes('classList.toggle(COVERED_CLASS, on)')).toBe(true);
    });

    it('the pause menu and every other window cover the block; a hidden tab or a loading scene does not', async () => {
        const mod = await import('../../../apps/fly/src/course/cover');
        expect(typeof mod.coveredBy).toBe('function');
        expect(mod.COVERED_CLASS).toBe('course-covered');
        for (const r of ['menu', 'panel', 'controls', 'export', 'help']) expect(mod.coveredBy([r]), r).toBe(true);
        expect(mod.coveredBy([])).toBe(false);
        expect(mod.coveredBy(['hidden'])).toBe(false);
        expect(mod.coveredBy(['scene'])).toBe(false);
        expect(mod.coveredBy(['hidden', 'menu'])).toBe(true);
        expect(mod.coveredBy(['scene', 'hidden'])).toBe(false);
    });
});

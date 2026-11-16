// Integration F seam d: on a short view (max-height 500px) the course's clock block sits at the bottom right; while
// the REC row shows it must stand above that row (--cinema-top from app/builtin/cinema.ts), not over 'Choose a folder'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../../../apps/fly/src/course/hud.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('course clock block and the REC row on a short view (seam d)', () => {
    it('a short-view rule lifts the block above the REC row while it shows', () => {
        const blocks = [...css.matchAll(/@media \(max-height: 500px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]!);
        const hit = blocks.some((b) => /\.rec-bar:not\(\[hidden\]\)\)[^{]*\.course-hud\s*\{[^}]*bottom:\s*calc\(var\(--cinema-top/.test(b));
        expect(hit).toBe(true);
    });
    it('on a short view the cross hangs from the block bottom upwards, so it stays above the REC row', () => {
        const blocks = [...css.matchAll(/@media \(max-height: 500px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]!);
        const hit = blocks.some((b) => /\.course-hud-x\s*\{[^}]*top:\s*auto;[^}]*bottom:\s*0/.test(b));
        expect(hit).toBe(true);
    });
});

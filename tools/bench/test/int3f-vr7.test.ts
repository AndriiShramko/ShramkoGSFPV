// Integration F, voxview2 VR-7: on a view lower than 500 px the edit view hides the walls menu (decision D7), so the
// caption 'Walls 5 cm' must not stay a control that opens nothing: it takes no click there and loses its button shape.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../../../apps/fly/src/course/editor/editor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('walls caption in the edit view on a short view (VR-7)', () => {
    it('the short-view block makes the caption take no click', () => {
        const blocks = [...css.matchAll(/@media \(max-height: 500px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]!);
        const hit = blocks.some((b) => /\.course-editor:not\(\.ce-flying\)\) \[data-testid='walls-summary'\]\s*\{[^}]*pointer-events:\s*none/.test(b));
        expect(hit).toBe(true);
    });
});

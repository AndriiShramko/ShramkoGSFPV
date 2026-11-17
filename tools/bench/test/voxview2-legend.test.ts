// Lane voxview2 VR-6: in the edit view the course editor's window (top right) lay over the voxel legend chip (picture
// voxview2-edit.png of 2026-11-16: the chip's last lines peeked out under the window). The chip leaves the screen while the
// edit view is open, as the rest of the flight's HUD does (course/editor/editor.css D5), and comes back in the test flight.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../../../apps/fly/src/fly.css'), 'utf8');
const editorCss = readFileSync(join(__dirname, '../../../apps/fly/src/course/editor/editor.css'), 'utf8');

/** every rule of a style sheet as [selector, body], comments dropped */
function rules(text: string): Array<[string, string]> {
    const plain = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: Array<[string, string]> = [];
    for (const m of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push([m[1].trim(), m[2].trim()]);
    return out;
}

describe('voxel legend in the edit view (VR-6)', () => {
    it('a rule hides the legend while the editor window is open and not in the test flight', () => {
        const hit = rules(css).find(([sel, body]) => sel.includes('.course-editor:not(.ce-flying)') && sel.includes('.voxel-legend') && /display:\s*none/.test(body));
        expect(hit).toBeDefined();
    });
    it('the editor window still sits at the top right, where the legend is', () => {
        const win = rules(editorCss).find(([sel]) => sel === '.course-editor');
        expect(win?.[1]).toMatch(/right:/);
        const legend = rules(css).find(([sel]) => sel === '.voxel-legend');
        expect(legend?.[1]).toMatch(/right:\s*16px/);
    });
});

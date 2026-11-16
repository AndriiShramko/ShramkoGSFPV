// Lane editor3 stage G3 (docs/wip/editor3.md): after a test flight that crashed, the edit view keeps the renderer's camera
// (g2/full5: the crash view's chase camera was drawn after a floor add while the edit eye stood still) and the crash's
// stats window goes when the edit view comes back.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

describe('editor3 G3', () => {
    const course = read('apps/fly/src/app/builtin/course.ts');
    const i = course.indexOf('const editFrame = (): void => {');
    const j = course.indexOf('const dragTo = ', i);
    const frame = course.slice(i, j);

    it('the edit view takes the camera back every frame another writer moved it, and counts it', () => {
        expect(i).toBeGreaterThan(0);
        expect(j).toBeGreaterThan(i);
        expect(frame).toMatch(/mode === 'edit' && view && !view\.isSuspended\(\)/);
        expect(frame).toMatch(/ctx\.renderer\.camera\.getPosition\(\)/);
        expect(frame).toMatch(/view\.setCam\(view\.cam\)/);
        expect(frame).toMatch(/camTaken = \{ n: camTaken\.n \+ 1/);
        expect(read('apps/fly/src/course/editor/view-mouse.ts')).toMatch(/isSuspended\(\): boolean \{\s*return this\.suspended;/);
    });

    it('back to editing after a crash clears the crash (its chase camera and its stats window)', () => {
        const k = frame.indexOf("st.change === 'to-edit'");
        expect(k).toBeGreaterThan(0);
        expect(frame.slice(k)).toMatch(/if \(ctx\.crash\.active\) \{ ctx\.clearCrash\(\); crashCleared\+\+; \}/);
    });

    it('the probes read who held the camera from __gsfpvEditView', () => {
        // I2 put the drone's place (drone: [...]) between crashActive and override
        expect(course).toMatch(/camTaken, crashCleared, crashActive: ctx\.crash\.active, (drone: [^\n]*?, )?override: ctx\.session\.cameraOverride/);
    });
});

// Stage F1-no-freeze: walls built in the worker arrive on the page without a second count of their solid
// voxels on its main thread (session.queueCollision -> assertWalls). The worker's count is taken for the very
// arrays it sent; any other bytes are counted as before.
import { describe, expect, it } from 'vitest';
import * as bake from '../../../apps/fly/src/bake';

describe('walls arrival from the worker', () => {
    it('assertWalls takes the worker count for the arrays the worker sent', () => {
        expect(typeof (bake as Record<string, unknown>).markCounted).toBe('function');
        const json = new Uint8Array([123, 125]);
        const bin = new Uint8Array(8);
        // not a walls file: counted on the page it is refused as empty
        expect(() => bake.assertWalls(json, bin)).toThrow();
        bake.markCounted(json, bin, 452738550);
        expect(bake.assertWalls(json, bin)).toBe(452738550);
    });

    it('other bytes are still counted (a copy of the bin, another json)', () => {
        const json = new Uint8Array([123, 125]);
        const bin = new Uint8Array(8);
        bake.markCounted(json, bin, 5);
        expect(() => bake.assertWalls(json, bin.slice())).toThrow();
        expect(() => bake.assertWalls(new Uint8Array([123, 125]), bin)).toThrow();
    });

    it('a zero count is never taken', () => {
        const json = new Uint8Array([123, 125]);
        const bin = new Uint8Array(8);
        bake.markCounted(json, bin, 0);
        expect(() => bake.assertWalls(json, bin)).toThrow();
    });
});

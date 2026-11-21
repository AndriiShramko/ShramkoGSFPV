// Voxel overlay vertex packing (voxel-colors.ts): the interleaved buffer the GPU gets holds exactly
// the chunk's positions, normals and grid UVs; floaters take the floater colour in every style;
// the height style follows y; a recolour touches only the colour bytes. Controls included.
import { describe, expect, it } from 'vitest';
import { AO_SHADE, packChunk, writeColors, voxelColor, heightColor, voxelFog, FOG_NEAR_M, VOXEL_GLOW, VOXEL_STYLES, QUAD_ABOVE_CEILING, QUAD_FLOATER } from '../src/voxel-colors';
import type { VoxelLayout } from '../src/voxel-colors';

// the overlay's VertexFormat order: position, normal, uv0, colour -> 36 bytes
const L: VoxelLayout = { stride: 36, pos: 0, nrm: 12, uv: 24, col: 32 };

function chunk(quads: number, floaterEvery = 3): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array; floater: Uint8Array; quads: number } {
    const nv = quads * 4;
    const positions = new Float32Array(nv * 3).map((_, i) => (i % 3 === 1 ? Math.floor(i / 12) * 0.25 : i * 0.001));
    const normals = new Float32Array(nv * 3).map((_, i) => (i % 3 === 1 ? 1 : 0));
    const uvs = new Float32Array(nv * 2).map((_, i) => i % 7);
    const indices = new Uint32Array(quads * 6).map((_, i) => Math.floor(i / 6) * 4 + [0, 1, 2, 0, 2, 3][i % 6]);
    const floater = new Uint8Array(quads).map((_, k) => (k % floaterEvery === 0 ? 1 : 0));
    return { positions, normals, uvs, indices, floater, quads };
}

describe('packChunk', () => {
    it('round trip: every vertex attribute is where the layout says, colours match voxelColor', () => {
        const c = chunk(50);
        for (const style of VOXEL_STYLES) {
            const p = packChunk(c, L, style, 0, 10);
            const f = new Float32Array(p.vertices), u8 = new Uint8Array(p.vertices);
            let bad = 0;
            for (let v = 0; v < 200; v++) {
                const o = v * 9;
                for (let a = 0; a < 3; a++) {
                    if (f[o + a] !== c.positions[v * 3 + a]) bad++;
                    if (f[o + 3 + a] !== c.normals[v * 3 + a]) bad++;
                }
                if (f[o + 6] !== c.uvs[v * 2] || f[o + 7] !== c.uvs[v * 2 + 1]) bad++;
                const want = voxelColor(style, c.positions[v * 3 + 1], c.floater[v >> 2] === 1, 0, 10).map((x) => Math.round(x * 255));
                if (u8[v * 36 + 32] !== want[0] || u8[v * 36 + 33] !== want[1] || u8[v * 36 + 34] !== want[2] || u8[v * 36 + 35] !== 255) bad++;
            }
            expect(bad).toBe(0);
            expect(p.indices).toBeInstanceOf(Uint16Array);
            expect(Array.from(p.indices)).toEqual(Array.from(c.indices));
            expect(p.aabb[1]).toBe(0);
            expect(p.aabb[4]).toBeCloseTo(49 * 0.25, 6);
        }
    });

    it('floaters stand out in every style; height colours climb the ramp; control: a non-floater keeps the style colour', () => {
        for (const s of VOXEL_STYLES) {
            expect(voxelColor(s, 1, true, 0, 4)).not.toEqual(voxelColor(s, 1, false, 0, 4));
        }
        expect(voxelColor('solid', 0, false, 0, 4)).toEqual(voxelColor('solid', 3, false, 0, 4));
        expect(voxelColor('height', 0, false, 0, 4)).not.toEqual(voxelColor('height', 3, false, 0, 4));
        expect(heightColor(-1)).toEqual(heightColor(0));
        expect(heightColor(2)).toEqual(heightColor(1));
    });

    it('a recolour rewrites only colour bytes', () => {
        const c = chunk(20);
        const p = packChunk(c, L, 'wire', 0, 5);
        const before = new Uint8Array(p.vertices.slice(0));
        writeColors(p.vertices, L, 80, 'height', c.floater, 0, 5);
        const after = new Uint8Array(p.vertices);
        let colourChanged = 0, otherChanged = 0;
        for (let i = 0; i < after.length; i++) {
            if (after[i] === before[i]) continue;
            if (i % 36 >= 32) colourChanged++; else otherChanged++;
        }
        expect(otherChanged).toBe(0);
        expect(colourChanged).toBeGreaterThan(0);
    });

    it('quads above the collision ceiling (class 2) take their own colour in every style, apart from walls and floaters; control: class 0 keeps the wall colour', () => {
        const c = chunk(30);
        c.floater.fill(0);
        for (let k = 0; k < 30; k += 2) c.floater[k] = QUAD_ABOVE_CEILING;
        c.floater[1] = QUAD_FLOATER;
        for (const style of VOXEL_STYLES) {
            const u8 = new Uint8Array(packChunk(c, L, style, 0, 10).vertices);
            const rgb = (q: number) => [u8[q * 4 * 36 + 32], u8[q * 4 * 36 + 33], u8[q * 4 * 36 + 34]];
            const above = rgb(0), floater = rgb(1), wall = rgb(3);
            expect(above).toEqual(voxelColor(style, 0, QUAD_ABOVE_CEILING, 0, 10).map((x) => Math.round(x * 255)));
            expect(above).not.toEqual(floater);
            expect(above).not.toEqual(wall);
            expect(wall).toEqual(voxelColor(style, c.positions[3 * 4 * 3 + 1], false, 0, 10).map((x) => Math.round(x * 255)));
        }
    });

    it('large chunks keep 32-bit indices; control: an unaligned layout is refused', () => {
        const big = chunk(16384 + 1);
        expect(packChunk(big, L, 'solid', 0, 1).indices).toBeInstanceOf(Uint32Array);
        expect(() => packChunk(chunk(2), { ...L, nrm: 13 }, 'solid', 0, 1)).toThrow(/aligned/);
    });
});

describe('the voxels-only look (voxux4 V3): low glow, fog to the plan\'s reach', () => {
    it('alone, the lit styles glow less than over the scan, so the lights shade the faces apart', () => {
        for (const s of ['solid', 'floaters', 'height'] as const) expect(VOXEL_GLOW.alone[s]).toBeLessThan(VOXEL_GLOW.over[s]);
        expect(VOXEL_GLOW.alone.solid).toBeLessThanOrEqual(0.05);
    });
    it('the fog starts at 30 m and ends at the reach; a short reach starts it halfway; a bad reach falls back', () => {
        expect(voxelFog(400)).toEqual({ start: FOG_NEAR_M, end: 400 });
        expect(voxelFog(40)).toEqual({ start: 20, end: 40 });
        expect(voxelFog(Number.NaN)).toEqual({ start: FOG_NEAR_M, end: 200 });
        expect(voxelFog(0).end).toBeGreaterThan(voxelFog(0).start);
    });
});

describe('ambient occlusion (voxux4 V-2b): the corner levels darken the colour bytes and survive a recolour', () => {
    it('level k scales RGB by AO_SHADE[k]; level 0 and no array leave the colour; a wrong length is refused', () => {
        const c = chunk(4, 1000);
        const ao = new Uint8Array(16).map((_, v) => v % 4);
        const plain = new Uint8Array(packChunk(c, L, 'solid', 0, 10).vertices);
        const p = packChunk(c, L, 'solid', 0, 10, ao);
        expect(p.ao).toBe(ao);
        const u8 = new Uint8Array(p.vertices);
        for (let v = 0; v < 16; v++) for (let ch = 0; ch < 3; ch++) expect(u8[v * 36 + 32 + ch]).toBe(Math.round(plain[v * 36 + 32 + ch] * AO_SHADE[ao[v]]));
        expect(AO_SHADE[0]).toBe(1);
        expect(AO_SHADE[3]).toBeLessThan(AO_SHADE[1]);
        expect(u8[3 * 36 + 32]).toBeLessThan(plain[3 * 36 + 32]);
        // a style change rewrites the colours with the same shading
        writeColors(p.vertices, L, 16, 'height', p.floater, 0, 10, p.ao);
        const h = new Uint8Array(packChunk(c, L, 'height', 0, 10).vertices);
        for (let v = 0; v < 16; v++) expect(u8[v * 36 + 32]).toBe(Math.round(h[v * 36 + 32] * AO_SHADE[ao[v]]));
        expect(() => packChunk(c, L, 'solid', 0, 10, new Uint8Array(3))).toThrow(/ambient occlusion/);
    });
});

// The size of a compressed-PLY scan (lane n-scan S2): the walls bake and the load read its splat count from
// the PLY's own header, built here from the headers recorded read-only in
// packages/scenes/test/fixtures/superspl-kinds.json (a5d25fb4, c67edb74). No network.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { plyVertexCount, sceneSize } from '../../../apps/fly/src/bake';

interface PlyKind { id: string; ply?: { comment: string; chunks: number; vertices: number; sh: number } }
const KINDS = (JSON.parse(readFileSync(new URL('../../../packages/scenes/test/fixtures/superspl-kinds.json', import.meta.url), 'utf8')) as { kinds: PlyKind[] }).kinds;
const PLYS = KINDS.filter((k) => k.ply);

/** A compressed PLY as SuperSplat writes it: the header of the recording, then binary rows (left out). */
function plyBytes(p: NonNullable<PlyKind['ply']>): Uint8Array {
    const chunkProps = ['min_x', 'min_y', 'min_z', 'max_x', 'max_y', 'max_z', 'min_scale_x', 'min_scale_y', 'min_scale_z', 'max_scale_x', 'max_scale_y', 'max_scale_z', 'min_r', 'min_g', 'min_b', 'max_r', 'max_g', 'max_b'];
    const lines = ['ply', 'format binary_little_endian 1.0', `comment ${p.comment}`, `element chunk ${p.chunks}`, ...chunkProps.map((n) => `property float ${n}`),
        `element vertex ${p.vertices}`, ...['packed_position', 'packed_rotation', 'packed_scale', 'packed_color'].map((n) => `property uint ${n}`)];
    if (p.sh) lines.push(`element sh ${p.vertices}`, ...Array.from({ length: p.sh }, (_, i) => `property uchar f_rest_${i}`));
    lines.push('end_header');
    const head = new TextEncoder().encode(`${lines.join('\n')}\n`);
    const out = new Uint8Array(head.length + 4096);
    out.set(head);
    return out;
}

/** The body in small pieces, as a network stream arrives; counts how much of it was pulled. */
function streamed(bytes: Uint8Array, piece = 300): { r: Response; pulled: () => number } {
    let at = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(ctl) {
            if (at >= bytes.length) return ctl.close();
            ctl.enqueue(bytes.slice(at, at + piece));
            at += piece;
        }
    });
    return { r: new Response(body, { status: 200, headers: { etag: '"x"' } }), pulled: () => at };
}

describe('the splat count of a compressed PLY scan', () => {
    it('the recording holds both PLY scans', () => {
        expect(PLYS.map((k) => k.id)).toEqual(['a5d25fb4', 'c67edb74']);
    });

    it.each(PLYS.map((k) => [k.id, k.ply!] as const))('%s: sceneSize(ply) reads the vertex count from the header', async (_id, p) => {
        const s = streamed(plyBytes(p));
        const size = await sceneSize('https://cdn.example/x/v1/scene.compressed.ply', 'ply', async () => s.r);
        expect(size).toEqual({ kind: 'ply', gaussians: p.vertices, lodLevels: 1, from: 'count', etag: '"x"' });
    });

    it('reads the header only, not the body', async () => {
        const bytes = plyBytes(PLYS[1].ply!);
        const s = streamed(bytes);
        expect(await plyVertexCount(s.r)).toBe(PLYS[1].ply!.vertices);
        expect(s.pulled()).toBeLessThan(bytes.length);
    });

    it('a body that is not a PLY gives no count (control)', async () => {
        expect(await plyVertexCount(new Response('{"version":3}'))).toBeNull();
    });
});

// Phantom walls (docs/architecture-v03.md G.3, the owner's item 24): a noisy scan has floating
// splats, and the voxelizer turns them into small solid pieces the drone crashes into although
// nothing is there. prefs scene.dropFloaters (Settings -> Voxels, per scan, 0 = off) drops every
// connected piece of the walls smaller than N blocks (4x4x4 voxels). The admin's default per scan
// is showcase.json's "dropFloaters"; the pilot's own value for a scan wins over it. The session
// applies it with the scene size (session.setDropFloaters: the walls change, the log gets a world
// record and a new life whose header names the filtered walls' hash). The voxel grid then shows
// the filtered walls (it draws session.collision) and its status line says what was dropped.
import type { PrefsStore } from '@gsfpv/prefs';
import { componentsOf, validMinBlocks } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { t } from '../../i18n';
import type { Feature } from '../context';

// window.__gsfpv.floaters (test-hook.ts is the shell's; this feature adds its part, like the others)
declare module '../test-hook' {
    interface TestHook {
        /** G.3: the floater filter now (what it dropped, the filtered walls' hash) and the same change Settings makes */
        floaters?: {
            state(): { minBlocks: number; pieces: number; blocks: number; components: number; sha256: string | null; stored: number };
            set(n: number): void;
            /**
             * Pieces of the scan's own walls by size: for each, its size in blocks and one solid voxel
             * whose upper neighbour is empty (index space, the same in the flown walls), the largest first
             */
            pieces(): { size: number; voxel: [number, number, number] }[];
        };
    }
}

/** A solid voxel with an empty one above it in block (bx, by, bz), or null. */
function topVoxel(col: VoxelCollision, bx: number, by: number, bz: number): [number, number, number] | null {
    for (let y = 3; y >= 0; y--) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
        const ix = bx * 4 + x, iy = by * 4 + y, iz = bz * 4 + z;
        if (col.isVoxelSolid(ix, iy, iz) && !col.isVoxelSolid(ix, iy + 1, iz)) return [ix, iy, iz];
    }
    return null;
}

/** The filter a scene starts with: the pilot's for this scan, else the admin's (showcase.json), else 0. */
export function storedDropFloaters(prefs: PrefsStore, scene: string): number {
    try {
        const n = prefs.get<number>('scene.dropFloaters', { scene });
        return validMinBlocks(n) ? n : 0;
    } catch {
        return 0;
    }
}

export const floaters: Feature = {
    id: 'floaters',
    install(ctx) {
        const sceneCtx = () => ({ scene: ctx.scene.id });

        /** The walls with pieces under n blocks dropped, now (a new life when in flight). */
        const apply = (n: number): void => {
            const ses = ctx.session;
            if (!ses?.renderer || ses.disposed || !validMinBlocks(n)) return;
            if (!ses.setDropFloaters(n)) return;
            ctx.renderer.renderOnce();
            const f = ses.floaterFilter;
            if (!f) return;
            ctx.hud.flash(n === 0 ? t('voxels.dropFloaters.off') : t('voxels.dropFloaters.on', { pieces: f.pieces, n }), 3500);
        };

        // the Settings row, its reset, an import, another tab: the store says, the flight follows
        const offPrefs = ctx.prefs.onChange((c) => {
            if (c.id !== 'scene.dropFloaters') return;
            apply(storedDropFloaters(ctx.prefs, ctx.scene.id));
        });

        ctx.hook.floaters = {
            state: () => {
                const ses = ctx.session;
                const f = ses.floaterFilter;
                return {
                    minBlocks: ses.floaterMinBlocks,
                    pieces: f?.pieces ?? 0,
                    blocks: f?.blocks ?? 0,
                    components: f?.components ?? 0,
                    sha256: ses.floaterSha256,
                    stored: storedDropFloaters(ctx.prefs, ctx.scene.id)
                };
            },
            set: (n) => { ctx.prefs.set('scene.dropFloaters', n, sceneCtx()); },
            pieces: () => {
                const base = ctx.session.baseCollision;
                if (!base) return [];
                const c = componentsOf(base);
                const [nbx, nby] = c.dims;
                const out: { size: number; voxel: [number, number, number] }[] = [];
                const seen = new Uint8Array(c.count);
                for (let i = 0; i < c.keys.length; i++) {
                    const id = c.blockIds[i];
                    if (seen[id]) continue;
                    const k = c.keys[i];
                    const bx = k % nbx, rest = (k - bx) / nbx, by = rest % nby, bz = (rest - by) / nby;
                    const v = topVoxel(base, bx, by, bz);
                    if (!v) continue; // its first block has no voxel open to the top: try the next block of the piece
                    seen[id] = 1;
                    out.push({ size: c.sizes[id], voxel: v });
                }
                return out.sort((a, b) => b.size - a.size);
            }
        };
        return () => {
            offPrefs();
            delete ctx.hook.floaters;
        };
    }
};

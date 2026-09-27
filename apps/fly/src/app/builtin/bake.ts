// Phase C: a scene without walls gets a badge, and walls can be built right here from the splats
// (same tool and defaults as SuperSplat). ?bake=1 starts it at once (acceptance).
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { beacon, q } from '../env';
import type { Feature } from '../context';

export const bake: Feature = {
    id: 'bake',
    install(ctx) {
        const session = ctx.session;
        if (session.collision) return;
        const hook = ctx.hook;
        const badge = h('div', { class: 'badge-nowalls', role: 'status', 'data-testid': 'no-collision' }, t('scenes.noCollisionBadge'));
        const status = h('div', { class: 'bake-status', role: 'status', 'aria-live': 'polite', 'data-testid': 'bake-status' });
        const bakeBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'bake', onclick: () => void runBake() }, t('bake.button')) as HTMLButtonElement;
        const box = h('div', { class: 'bake-box interactive' }, badge, bakeBtn, status);
        ctx.ui.append(box);
        const runBake = async (): Promise<void> => {
            bakeBtn.disabled = true;
            ctx.pause('bake');
            try {
                const { bakeCollision, BakeRefusedError, BAKE_MAX_GAUSSIANS } = await import('../../bake');
                try {
                    const r = await bakeCollision(session.scene.contentUrl, session.scene.contentKind, session.renderer.app.graphicsDevice, (st) => { status.textContent = t('bake.working', { stage: t(`bake.stage.${st}`) }); });
                    session.installCollision(r.json, r.bin);
                    hook.bake = { ok: true, gaussians: r.gaussians, solidVoxels: r.solidVoxels, ms: r.ms, peakJsHeapMb: r.peakJsHeapMb, binBytes: r.bin.length, collisionSha256: session.collisionSha256 };
                    hook.bakedBytes = { json: r.json, bin: r.bin };
                    if (hook.info) hook.info.hasCollision = true;
                    badge.remove();
                    bakeBtn.remove();
                    status.textContent = t('bake.done', { voxels: (r.solidVoxels / 1e6).toFixed(1), s: (r.ms.total / 1000).toFixed(0) });
                    beacon('bake_done');
                } catch (e) {
                    if (e instanceof BakeRefusedError) {
                        hook.bake = { ok: false, refused: true, gaussians: e.size.gaussians, limit: BAKE_MAX_GAUSSIANS };
                        status.textContent = t('bake.refused', { n: (e.size.gaussians / 1e6).toFixed(1), max: (BAKE_MAX_GAUSSIANS / 1e6).toFixed(0) });
                        bakeBtn.remove();
                    } else {
                        hook.bake = { ok: false, error: String((e as Error)?.message ?? e) };
                        status.textContent = t('bake.failed', { msg: String((e as Error)?.message ?? e).slice(0, 160) });
                        bakeBtn.disabled = false;
                    }
                }
            } finally {
                ctx.resume('bake');
            }
        };
        hook.runBake = runBake;
        hook.downloadBaked = () => {
            const b = hook.bakedBytes;
            if (!b) return false;
            for (const [name, bytes] of [['baked.voxel.json', b.json], ['baked.voxel.bin', b.bin]] as const) {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
                a.download = `${ctx.scene.id}-${name}`;
                a.click();
            }
            return true;
        };
        if (q.get('bake') === '1') void runBake();
    }
};

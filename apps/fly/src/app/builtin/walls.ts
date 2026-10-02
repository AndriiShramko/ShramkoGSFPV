// The walls: the box at the top middle (phase C build for a scan without walls, the refine to finer
// walls, the walls store; walls.ts), the "Walls 5 cm" line on the credit with the walls switch and
// the voxel controls in its menu, and C: walls (collisions) on / off, one choice for every scan.
import { mountWalls } from '../../walls';
import type { RefineMode } from '../../walls';
import { wallsVoxelsControls } from '../../ui/voxels';
import { t } from '../../i18n';
import { beacon, q } from '../env';
import type { Feature } from '../context';

/** ?refine= wins; the automated modes (bot radio, latency probe) fly the shipped walls, the pilot gets the plan's choice. */
function refineMode(): RefineMode {
    const r = q.get('refine');
    if (r === 'auto' || r === 'offer' || r === 'off') return r;
    return q.get('simradio') || q.get('lat') === '1' ? 'off' : 'auto';
}

export const walls: Feature = {
    id: 'walls',
    install(ctx) {
        const mount = () => mountWalls({
            ui: ctx.ui, session: ctx.session, sceneId: ctx.scene.id, beacon, hook: ctx.hook,
            mode: refineMode(),
            bakeNow: q.get('bake') === '1',
            controls: wallsVoxelsControls(ctx.voxels, ctx.walls, 'wm'),
            switchOn: () => ctx.walls.set(true)
        });
        let w = mount();
        // a scene switched in the page (E.4): the box, the walls line and the store for the new scene
        ctx.events.on('session', () => { w.dispose(); w = mount(); });
        ctx.events.on('walls', ({ on }) => w.switched(on));
        ctx.hook.wallsSwitch = { on: () => ctx.session.wallsOn, set: (on) => ctx.walls.set(on, false), state: () => ctx.session.walls, header: () => ctx.session.log.header };
        ctx.keys.on('walls.toggle', (e) => {
            if (e.repeat) return;
            if (!ctx.session.collision) ctx.hud.flash(t('walls.none'), 3500);
            else ctx.walls.set(!ctx.session.wallsOn);
        });
    }
};

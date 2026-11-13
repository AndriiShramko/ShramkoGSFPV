// Walls first, then the action (walls stage W3, the owner's rule): every feature that needs walls
// calls wallsThen instead of telling the pilot the scan has none. On a scan without walls the build
// starts by itself (its progress line in the walls box) and the action runs when they are in.
import { withWalls } from '../walls-first';
import type { WithWalls } from '../walls-first';
import { t } from '../i18n';
import type { FlightContext } from './context';

export function wallsThen(ctx: FlightContext, then: () => void): Promise<WithWalls> {
    return withWalls({
        has: () => !!ctx.session.collision,
        build: ctx.hook.walls ? () => ctx.hook.walls!.build() : null,
        scene: () => ctx.session.scene.id,
        started: () => ctx.hud.flash(t('walls.building'), 4000)
    }, then);
}

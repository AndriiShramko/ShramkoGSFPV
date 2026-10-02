// Scene rotation in flight (docs/architecture-v03.md E.3-E.5; the owner's item 10): N loads the next
// scene of the rotation (scenes.rotation: curated / favourites / history, scenes.order: random /
// sequential), Shift+N a random curated scene, F the next favourite. The keys work in flight and
// on the crash toast and panel (the panel has the buttons too, app/builtin/crash.ts); the pause
// menu lists them with their keys. scenes.autoSwitch on: after a crash the director asks for the
// next scene instead of a respawn (its rules' onCrash 'next-scene', app/builtin/respawn.ts), and
// the scene host loads it; when there is no other scene the craft respawns as usual. Every switch
// is in-page (app/scene-host.ts): the radio stays connected, the settings stay.
import type { FlightSession } from '../../session';
import type { Feature, FlightContext } from '../context';

type Kind = 'next' | 'random' | 'favourite';
const KEYS: readonly [Kind, 'scene.next' | 'scene.random' | 'scene.favourite', number][] = [['next', 'scene.next', 31], ['random', 'scene.random', 32], ['favourite', 'scene.favourite', 33]];

/** The crash with scenes.autoSwitch: the next scene; nothing to go to, the respawn the rules say. */
function onSceneIntent(ctx: FlightContext, s: FlightSession): void {
    // the director calls this inside the runner's step: the switch starts after it
    setTimeout(() => {
        if (ctx.session !== s || ctx.scenes.busy) return;
        void ctx.scenes.go('auto').then((ok) => {
            if (ok || ctx.session !== s || s.disposed) return;
            if (s.policy.target === 'start') s.respawnStart();
            else s.rewind();
        });
    }, 0);
}

export const rotation: Feature = {
    id: 'rotation',
    install(ctx) {
        const attach = (s: FlightSession): void => { s.onSceneIntent = () => onSceneIntent(ctx, s); };
        attach(ctx.session);
        const offSession = ctx.events.on('session', attach);

        const offs = KEYS.map(([kind, action, order]) => {
            const offKey = ctx.keys.on(action, (e) => {
                // a held key loads one scene; a screen or panel on top (settings, drones) has its own keys
                if (e.repeat || ctx.scenes.busy || document.querySelector('#ui .screen, #ui .panel')) return;
                e.preventDefault();
                void ctx.scenes.go(kind);
            });
            const offItem = ctx.menu.add({ id: `pause.scene.${kind}`, action, labelKey: `keys.${action}`, order, section: 'scene', run: () => void ctx.scenes.go(kind) });
            return () => { offKey(); offItem(); };
        });
        return () => {
            offSession();
            for (const off of offs) off();
        };
    }
};

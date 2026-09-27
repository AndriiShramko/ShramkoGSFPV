// A new life of the flight model: a respawn, or a model rebuilt for a new drone or new settings.
// Everything that starts the flight over goes through newLife, so the features that clean up
// after a crash (the crash view, the crash panel) hear it once, on events.life.
import type { RespawnReason } from '@gsfpv/sim-core';
import type { FlightSession } from '../session';
import type { FlightContext } from './context';

/** Lives started in each session after its first; the first ('start') is the session itself. */
const started = new WeakMap<FlightSession, number>();

export function newLife(ctx: FlightContext, reason: RespawnReason, start: () => void): void {
    start();
    const index = (started.get(ctx.session) ?? 0) + 1;
    started.set(ctx.session, index);
    ctx.events.emit('life', { index, reason });
}

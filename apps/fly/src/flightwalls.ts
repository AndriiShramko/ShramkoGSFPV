// Walls on or off (Andrii, 2026-09-27 message 9; one choice for every scan since message 16): the
// pilot can fly with or without the scan's collision, and the admin sets each showcase scan's
// default in public/showcase.json ("walls": "off" for a noisy scan full of floating splats) for a
// pilot who never switched. Pure: the flight session, the page and the replay test share it.
//
// The input log stays honest: its header says which walls the flight had. Walls off is flown
// with no contact world at all, so the header carries no collision hash then, and a replay takes
// the setting from the header, not from what the pilot has switched on now.
import { sha256Hex } from '@gsfpv/sim-core';
import type { LogHeader, ParamOverrides } from '@gsfpv/sim-core';

/** on / off: the scan has walls and the pilot flies with / without them; none: the scan has no walls. */
export type WallsState = 'on' | 'off' | 'none';

/** An input log header that also records the walls setting. Logs from before it have no field: read as on. */
export interface FlightLogHeader extends LogHeader {
    walls?: WallsState;
}

export function wallsState(hasWalls: boolean, on: boolean): WallsState {
    return !hasWalls ? 'none' : on ? 'on' : 'off';
}

export interface HeaderInput {
    simCore: string;
    preset: string;
    overrides: ParamOverrides;
    /** digest of the scan's walls, null when it has none */
    wallsSha256: string | null;
    wallsOn: boolean;
    spawn: [number, number, number, number];
}

/**
 * The header of a new flight. With walls on it is byte for byte what it was before the switch
 * existed (plus walls: 'on'); with walls off the collision hash is null and the config hash
 * changes, so an off flight can never pass for an on one.
 */
export function flightHeader(i: HeaderInput): FlightLogHeader {
    const walls = wallsState(i.wallsSha256 !== null, i.wallsOn);
    const cfg = walls === 'off' ? { o: i.overrides, p: i.preset, w: 'off' } : { o: i.overrides, p: i.preset };
    return {
        format: 'gsfpv-input-log/1',
        simCore: i.simCore,
        preset: i.preset,
        configHash: sha256Hex(new TextEncoder().encode(JSON.stringify(cfg))),
        collisionSha256: walls === 'on' ? i.wallsSha256 : null,
        spawn: i.spawn,
        seed: 0,
        walls
    };
}

/**
 * The contact world to replay a log with: none when it was flown without walls (switched off, or
 * a scan without any), the scan's walls when the hash matches, undefined when it was flown on
 * other walls (it cannot be replayed here).
 */
export function worldForLog<W>(h: FlightLogHeader, wallsSha256: string | null, world: W | null): W | null | undefined {
    if (h.walls === 'off' || h.collisionSha256 === null) return null;
    return h.collisionSha256 === wallsSha256 && world ? world : undefined;
}

/**
 * Walls on or off for a flight on `sceneId`: the store's scene.walls (one choice for every scan, the
 * owner's message 16). Its order: ?walls= for this load (the session layer), then the pilot's own
 * choice, then the admin's default for this scan (showcase.json), then on. The only reader: a new
 * flight (app/flight.ts, app/scene-host.ts) and the switch (app/walls.ts) both ask here.
 */
export function wallsWanted(store: { get<T = unknown>(id: string, ctx?: { scene?: string }): T }, sceneId: string): boolean {
    return store.get<string>('scene.walls', { scene: sceneId }) !== 'off';
}

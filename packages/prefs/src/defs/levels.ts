// The menu level of every setting (docs/wip/menu-plan.md 1.5; the owner's three kinds of new pilot). One table, so the
// three menus are read and changed in one place; defineSettings refuses a shipped setting without a level.
// first: a pilot who never flew (reading, motion comfort, easy play, sound, drone size); sim: what another
// simulator or a real radio pilot looks for first (mode, rates, camera angle, stick habits, reset habits);
// expert: model numbers, rendering, the collision grid and video detail. A setting added later without a
// row here fails defineSettings, never vanishes.
import type { MenuLevel, SettingDef } from '../schema';

export const LEVEL_TABLE: Readonly<Record<string, MenuLevel>> = {
    // first
    'ui.menuLevel': 'first',
    'ui.language': 'first',
    'display.reducedMotion': 'first',
    'input.play': 'first',
    'input.altitudeHelp': 'first',
    'input.gameSpeed': 'first',
    'input.mouseSensitivity': 'first',
    'input.howToFly': 'first',
    'crash.enabled': 'first',
    'sound.volume': 'first',
    'drone.current': 'first',
    // sim
    'flight.mode': 'sim',
    'tune.rates': 'sim',
    'tune.throttle': 'sim',
    'camera.uptiltDeg': 'sim',
    'camera.fovDeg': 'sim',
    'input.stickMode': 'sim',
    'input.throttleStyle': 'sim',
    'input.haptics': 'sim',
    'input.mouseInvertY': 'sim',
    'respawn.auto': 'sim',
    'respawn.target': 'sim',
    'respawn.keepArmed': 'sim',
    'battery.refill': 'sim',
    'wind.mode': 'sim',
    'wind.speed': 'sim',
    'display.hud': 'sim',
    'crosshair.shape': 'sim',
    'sound.motors': 'sim',
    'scene.walls': 'sim',
    'scene.ceiling': 'sim',
    'scenes.autoSwitch': 'sim',
    'recording.resolution': 'sim',
    'recording.auto': 'sim',
    'stats.onDisarm': 'sim',
    'display.units': 'sim',
    // newer than the plan: the lap time on screen is a course taste (lane course4)
    'course.lapSplash': 'sim',
    // expert
    'level.angleLimitDeg': 'expert',
    'level.strength': 'expert',
    'level.horizonStrength': 'expert',
    'tune.pid': 'expert',
    'physics.twr': 'expert',
    'physics.tauMs': 'expert',
    'physics.dragScale': 'expert',
    'physics.ductDrag': 'expert',
    'physics.propInertia': 'expert',
    'physics.propWash': 'expert',
    'physics.idlePct': 'expert',
    'physics.gravity': 'expert',
    'physics.gravityMode': 'expert',
    'drone.payload': 'expert',
    'physics.vCrash': 'expert',
    'respawn.delayS': 'expert',
    'respawn.rewindS': 'expert',
    'respawn.platform': 'expert',
    'respawn.unstuck': 'expert',
    'wind.fromDeg': 'expert',
    'wind.gust': 'expert',
    'crosshair.size': 'expert',
    'crosshair.color': 'expert',
    'crosshair.opacity': 'expert',
    'display.quality': 'expert',
    'display.drawing': 'expert',
    'display.budget': 'expert',
    'display.deviceClass': 'expert',
    'display.frameStats': 'expert',
    // newer than the plan: more detail at rest is a rendering choice (train 3 lane loadq)
    'display.stillDetail': 'expert',
    'scenes.rotation': 'expert',
    'scenes.order': 'expert',
    'scenes.allowNoWalls': 'expert',
    'scene.transform': 'expert',
    'scene.dropFloaters': 'expert',
    'scene.ceilingM': 'expert',
    'voxels.show': 'expert',
    'voxels.style': 'expert',
    'voxels.opacity': 'expert',
    'voxels.opacityOnly': 'expert',
    'recording.fps': 'expert',
    'recording.splitMin': 'expert',
    'recording.authorNotice': 'expert',
    'respawn.showPad': 'expert',
    'recording.folder': 'expert',
    'display.governor': 'expert',
    'display.latencyGuard': 'expert',
    'voxels.radiusM': 'expert'
};

/** The defs with their menu level from the table; a table row naming no def is an error (a typo or a rename). */
export function withLevels(defs: readonly SettingDef[], table: Readonly<Record<string, MenuLevel>> = LEVEL_TABLE): SettingDef[] {
    const ids = new Set(defs.map((d) => d.id));
    const stray = Object.keys(table).filter((id) => !ids.has(id));
    if (stray.length) throw new Error(`withLevels: no setting ${stray.join(', ')}`);
    return defs.map((d) => (table[d.id] === undefined ? d : { ...d, level: table[d.id] }) as SettingDef);
}

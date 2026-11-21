// Where loadq-probe.mjs holds the camera after the reveal (lane fix-lod, docs/wip/fix-lod.md).
//   - unset: the start place, held as the page placed it;
//   - UP / PITCH: that many metres above the start place, pitch in degrees, the start's heading;
//   - AT=x,y,z with YAW / PITCH (degrees): an absolute place in the scene's world, so a check does not move when the page
//     changes where the craft starts (car 1's placeStart moved Lublin's start and with it "140 m up": the live check
//     pause-rise-lublin then flew over a place that never needs more than the flight budget). AT wins over UP.
/**
 * @param {{ AT?: string, YAW?: string, UP?: string, PITCH?: string }} env
 * @returns {{ kind: 'start' } | { kind: 'up', up: number, pitchDeg: number } | { kind: 'at', pos: number[], yawDeg: number, pitchDeg: number }}
 */
export function holdSpec(env) {
    const pitchDeg = Number(env.PITCH || -35);
    if (env.AT !== undefined && env.AT !== '') {
        const pos = env.AT.split(',').map(Number);
        if (pos.length !== 3 || pos.some((x) => !Number.isFinite(x))) throw new Error(`AT must be x,y,z: ${env.AT}`);
        const yawDeg = Number(env.YAW);
        if (env.YAW === undefined || env.YAW === '' || !Number.isFinite(yawDeg)) throw new Error('AT needs YAW (degrees)');
        return { kind: 'at', pos, yawDeg, pitchDeg };
    }
    if (env.UP !== undefined && env.UP !== '') return { kind: 'up', up: Number(env.UP), pitchDeg };
    return { kind: 'start' };
}

/** The page-side expression that installs the hold (the session's cameraOverride, every engine update). */
export function holdExpr(spec) {
    const deg = (d) => `${d} * Math.PI / 180`;
    const pos = spec.kind === 'at' ? JSON.stringify(spec.pos) : `[p.x, p.y + ${spec.kind === 'up' ? spec.up : 0}, p.z]`;
    const yaw = spec.kind === 'at' ? deg(spec.yawDeg) : 'Math.atan2(f.x, f.z)';
    const pitch = spec.kind === 'start' ? 'Math.asin(Math.max(-1, Math.min(1, f.y)))' : deg(spec.pitchDeg);
    return `(() => {
    const h = window.__gsfpv; const s = h.session; const r = s.renderer; const a = r.app;
    const p = r.camera.getPosition(); const f = r.camera.forward;
    const c = { pos: ${pos}, yaw: ${yaw}, pitch: ${pitch} };
    window.__gsHold = c;
    s.cameraOverride = true;
    a.on('update', (dt) => { const k = window.__gsHold; const fl = window.__gsFly;
        if (fl && performance.now() < fl.until) { k.pos[0] += Math.sin(k.yaw) * fl.v * dt; k.pos[2] += Math.cos(k.yaw) * fl.v * dt; const v = s.runner.sim.s; v[3] = 2; v[4] = 0; v[5] = 0; } r.setCameraLookAt(k.pos[0], k.pos[1], k.pos[2], k.pos[0] + Math.sin(k.yaw) * Math.cos(k.pitch) * 10, k.pos[1] + Math.sin(k.pitch) * 10, k.pos[2] + Math.cos(k.yaw) * Math.cos(k.pitch) * 10); });
    return { pos: c.pos.map((x) => Math.round(x * 10) / 10), yawDeg: Math.round(c.yaw * 1800 / Math.PI) / 10, pitchDeg: Math.round(c.pitch * 1800 / Math.PI) / 10, start: [p.x, p.y, p.z].map((x) => Math.round(x * 10) / 10) };
})()`;
}

// Lab page for the 3D drone models (v0.9 lane D): one preset on a full-window canvas, orbit and turntable as in the
// picker, no flight app. /fly/lab/drones3d.html?drone=<preset id>[&payload=komodo|bmpcc6kpro|gopro13|none][&yaw=&pitch=&dist=][&backend=webgl2]
// Dev server only (not in the production inputs of vite.config.ts). window.__lab is what the screenshot script drives.
import { PRESETS } from '../src/presets';
import { modelForPreset } from '../src/drones3d/model';
import { isPayloadId } from '../src/drones3d/payloads';
import { Orbit } from '../src/drones3d/orbit';
import { Studio } from '../src/drones3d/studio';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const orbit = new Orbit();
orbit.spin = q.get('spin') === '1';
const num = (k: string): number | undefined => (q.has(k) ? Number(q.get(k)) : undefined);
if (num('yaw') !== undefined) orbit.state.yaw = num('yaw')!;
if (num('pitch') !== undefined) orbit.state.pitch = num('pitch')!;
if (num('dist') !== undefined) orbit.state.dist = num('dist')!;

const studio = await Studio.create(canvas, { backend: q.get('backend') === 'webgl2' ? 'webgl2' : 'auto' });
studio.onFrame = (dt) => { orbit.tick(dt); studio.setView(orbit.state); };
let drone = q.get('drone') ?? 'pavo20pro-3s';
const payload = q.get('payload');
function show(id: string, p?: string): void {
    drone = id;
    const { model } = modelForPreset(PRESETS[id], p && isPayloadId(p) ? p : undefined);
    studio.setModel(model);
    studio.setView(orbit.state);
}
show(drone, payload ?? undefined);
canvas.addEventListener('pointerdown', (e) => { orbit.grab(); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => orbit.drag(e.movementX, e.movementY, canvas.clientWidth));
canvas.addEventListener('pointerup', () => orbit.release());
canvas.addEventListener('wheel', (e) => { orbit.zoom(e.deltaY); e.preventDefault(); }, { passive: false });
(window as unknown as { __lab: unknown }).__lab = { studio, orbit, show, tally: () => studio.tally(), ready: true };

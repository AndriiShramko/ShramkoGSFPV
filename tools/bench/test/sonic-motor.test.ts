// v0.13, lane v13-host A4 (W12 of the sound package's merge review; M41-16, the owner's message 41: the motor on by default in
// the mode, mixed under the cues): the simulator's motor feature (apps/fly/src/app/builtin/sound.ts) installed on a page of the
// mode, with fakes for the page (no DOM in Node) and for the audio graph.
//  - the motor's graph is built on the engine's context, and its master goes into the engine's motor bus (SonicEngine.motorInput:
//    the propellers' band, levelled, under the cues, ducked under speech): not into the plain input node, not to the speakers;
//  - with the sound settings as the package gives them (nothing changed by the pilot) the motor plays: on by default;
//  - control: an engine of an older package (no motorInput) gets the motor on its plain input node (auxInput), as in v0.12;
//  - control: with the motor turned off in the mode's settings no graph is made.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultPrefs } from '../../../packages/sonic-fpv/src';
import type { SonicPrefs } from '../../../packages/sonic-fpv/src';
import type { FlightContext } from '../../../apps/fly/src/app/context';
import { setSonicEntry } from '../../../apps/fly/src/sonic/entry-state';
import type { SonicEntry } from '../../../apps/fly/src/sonic/entry';

class FakeParam {
    value = 0;
    setTargetAtTime(v: number): void { this.value = v; }
}
class FakeNode {
    to: unknown[] = [];
    context: unknown = null;
    constructor(readonly kind: string) {}
    connect(n: unknown): void { this.to.push(n); }
    disconnect(): void { this.to = []; }
    start(): void { /* a source */ }
    stop(): void { /* a source */ }
}
/** An AudioContext with what the motor's graph makes (audio/motor-sound.ts). */
class FakeAudio {
    currentTime = 0;
    sampleRate = 8000;
    state = 'running';
    destination = new FakeNode('destination');
    nodes: FakeNode[] = [];
    private add<T extends FakeNode>(n: T): T { this.nodes.push(n); return n; }
    createGain() { return this.add(Object.assign(new FakeNode('gain'), { gain: new FakeParam() })); }
    createOscillator() { return this.add(Object.assign(new FakeNode('osc'), { frequency: new FakeParam(), setPeriodicWave() { /* no wave */ } })); }
    createBiquadFilter() { return this.add(Object.assign(new FakeNode('filter'), { type: '', frequency: new FakeParam(), Q: new FakeParam() })); }
    createBuffer(_c: number, len: number) { const d = new Float32Array(len); return { getChannelData: () => d }; }
    createBufferSource() { return this.add(Object.assign(new FakeNode('noise'), { buffer: null as unknown, loop: false })); }
    createPeriodicWave(real: Float32Array, imag: Float32Array) { return { real, imag }; }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
}

/** An element as ui/dom.ts h() and the speaker button use it. */
const fakeElement = (): Record<string, unknown> => ({ className: '', title: '', setAttribute() {}, addEventListener() {}, append() {}, replaceChildren() {}, classList: { toggle() {} } });

type SoundFeature = typeof import('../../../apps/fly/src/app/builtin/sound')['sound'];
let sound: SoundFeature;

beforeAll(async () => {
    // the feature's module reads the page's language at import (i18n.ts): a page of /en/fly/ that has had a click already
    vi.stubGlobal('location', { pathname: '/en/fly/', search: '' });
    vi.stubGlobal('document', { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible', addEventListener() {}, createElement: fakeElement, createElementNS: fakeElement, createTextNode: (s: string) => ({ s }) });
    vi.stubGlobal('navigator', { languages: ['en'], language: 'en', userActivation: { hasBeenActive: true } });
    vi.stubGlobal('addEventListener', () => undefined);
    ({ sound } = await import('../../../apps/fly/src/app/builtin/sound'));
});
afterEach(() => setSonicEntry(null));

/**
 * A page of the mode whose engine has started on `ac`: its motor bus (unless `motorBus` is false: an older package) and its plain
 * input node, the pilot's sound settings `prefs`. Returns the nodes, the context and the page's frame and hook.
 */
function modePage(prefs: SonicPrefs, motorBus = true): { ac: FakeAudio; bus: FakeNode; aux: FakeNode; frame: () => void; ctx: FlightContext } {
    const ac = new FakeAudio();
    const bus = Object.assign(new FakeNode('engine-motor-bus'), { context: ac });
    const aux = Object.assign(new FakeNode('engine-aux'), { context: ac });
    const frames: (() => void)[] = [];
    const engine = motorBus ? { motorInput: bus, auxInput: aux } : { auxInput: aux };
    const ctx = {
        sonic: { engine, prefs },
        prefs: { get: (id: string) => (id === 'sound.volume' ? 15 : undefined), set: () => undefined, onChange: () => () => undefined },
        session: { presetId: 'pavo20pro-3s', sim: undefined },
        events: { on: (name: string, cb: () => void) => { if (name === 'frame') frames.push(cb); return () => undefined; } },
        menu: { add: () => () => undefined },
        ui: { querySelector: () => null },
        hook: {}
    } as unknown as FlightContext;
    setSonicEntry({ setup: { update: () => undefined } } as unknown as SonicEntry);
    return { ac, bus, aux, frame: () => frames.forEach((f) => f()), ctx };
}

const into = (ac: FakeAudio, node: unknown): boolean => ac.nodes.some((n) => n.to.includes(node));

describe('the mode\'s motor plays into the engine\'s motor bus, on by default (M41-16)', () => {
    it('the sound settings as the package gives them: the motor is on, its graph on the engine\'s context, its master into motorInput only', () => {
        expect(defaultPrefs().motorSound).toBe(true);
        const p = modePage(defaultPrefs());
        sound.install(p.ctx);
        p.frame();
        expect(into(p.ac, p.bus)).toBe(true);
        expect(into(p.ac, p.aux)).toBe(false);
        expect(into(p.ac, p.ac.destination)).toBe(false);
        expect(p.ac.nodes.filter((n) => n.to.includes(p.bus))).toHaveLength(1); // the master, once
        expect((p.ctx.hook as { sound?: () => { context: string | null } }).sound!().context).toBe('running');
    });

    it('control: an engine of an older package (no motor bus) gets the motor on its plain input node, as in v0.12', () => {
        const p = modePage(defaultPrefs(), false);
        sound.install(p.ctx);
        p.frame();
        expect(into(p.ac, p.aux)).toBe(true);
        expect(into(p.ac, p.ac.destination)).toBe(false);
    });

    it('control: the motor turned off in the mode\'s settings makes no graph', () => {
        const p = modePage({ ...defaultPrefs(), motorSound: false });
        sound.install(p.ctx);
        p.frame();
        expect(p.ac.nodes).toHaveLength(0);
        expect((p.ctx.hook as { sound?: () => { context: string | null } }).sound!().context).toBeNull();
    });
});

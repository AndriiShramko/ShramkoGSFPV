// v0.7 lane D1, flight UX (docs/wip/v07-d1.md), in Node on the real modules. Claims, each with a
// negative control that must fire:
//  - sharing: every entry point carries the right link (the picture page /s/<id> from a flight, the
//    scene page from the picker; a catalogue scan's page, else the fly deep link with lane R's drawing
//    parameters) and the right words (control: v0.6's one plain fly link for every place);
//  - recording on every scan: the gate is gone for a scan outside the catalogue (control: D34's rule
//    refuses it), the burned-in credit always names the scan's author or its page and ShramkoGSFPV,
//    the author notice comes once per scan and never after "Don't show again" (control: a notice
//    that forgets it was shown);
//  - the crosshair: settings -> the SVG on the page (control: a builder that ignores the shape);
//    hidden in cinema mode (control: the stylesheet without its rule);
//  - the motor sound: the graph is built, glides and closes on an AudioContext (a fake one here);
//    silence when paused, crashed, disarmed, hidden, off (control: a mix that ignores the pause);
//    the frequencies follow the motors; the flight model is only read;
//  - every text the new code names exists in English (control: a planted unknown key is reported);
//  - L is the share key in flight and over a crash, and no other binding has it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KEYMAP, actionFor, keymapProblems } from '../../../packages/prefs/src';
import { mkStore } from '../../../packages/prefs/test/helpers';
import { REPO } from '../src/evidence';
import { SHARE_ENTRIES, dataUrlBytes, inFlight, instagramCaption, kindOf, scenePageUrl, shareLink, targetHref, wordsKey } from '../../../apps/fly/src/share/links';
import type { ShareEntry } from '../../../apps/fly/src/share/links';
import { authorNotice, creditFacts, creditText, videoCredit } from '../../../apps/fly/src/scene-facts';
import type { SceneCredit } from '../../../apps/fly/src/scene-facts';
import { Recording } from '../../../apps/fly/src/app/builtin/recording';
import { CROSSHAIR_CSS, crosshairSpec, crosshairSvg } from '../../../apps/fly/src/crosshair';
import type { CrosshairSpec } from '../../../apps/fly/src/crosshair';
import { MASTER_MAX, MotorSound, audible, bladesOf, motorMix, rotorHz, voiceHarmonics } from '../../../apps/fly/src/audio/motor-sound';
import type { AudioLike, MixInput, MotorState } from '../../../apps/fly/src/audio/motor-sound';

const FLY = join(REPO, 'apps', 'fly', 'src');
const AT = { origin: 'https://gsfpv.flyreelstudio.eu', locale: 'pl', search: '?scene=ab12cd34&budget=8&stochastic&simradio=1' };
const PIC = 'https://gsfpv.flyreelstudio.eu/s/AbCdEfGhIjK';

// ------------------------------------------------------------------ sharing

/** v0.6's one link (builtin/share.ts before v0.7): the plain fly link from every place, the picture only from the pause menu. */
const v06Link = (o: { entry: ShareEntry; sceneId: string; pictureUrl: string | null }): string =>
    o.entry === 'pause' && o.pictureUrl ? o.pictureUrl : `${AT.origin}/${AT.locale}/fly/?scene=${o.sceneId}`;

describe('share links: the right link from every place a share starts', () => {
    it('in a flight the picture page, else the scene page; from the picker never a picture', () => {
        for (const entry of SHARE_ENTRIES) {
            const withPic = shareLink({ entry, sceneId: 'ab12cd34', inCatalogue: true, at: AT, pictureUrl: PIC });
            const noPic = shareLink({ entry, sceneId: 'ab12cd34', inCatalogue: true, at: AT, pictureUrl: null });
            expect(withPic, entry).toBe(inFlight(entry) ? PIC : `${AT.origin}/pl/scenes/ab12cd34/`);
            expect(noPic, entry).toBe(`${AT.origin}/pl/scenes/ab12cd34/`);
        }
        expect(SHARE_ENTRIES.filter((e) => !inFlight(e))).toEqual(['picker', 'recent']);
    });

    it('a scan outside the catalogue has no page: the fly deep link, with budget and stochastic kept and nothing else', () => {
        expect(scenePageUrl('cafe0001', false, AT)).toBe(`${AT.origin}/pl/fly/?scene=cafe0001&budget=8&stochastic`);
        expect(scenePageUrl('cafe0001', false, { ...AT, search: '?scene=x&budget=8;alert(1)' })).toBe(`${AT.origin}/pl/fly/?scene=cafe0001`);
        expect(shareLink({ entry: 'picker', sceneId: 'cafe0001', inCatalogue: false, at: { origin: AT.origin, locale: 'en' }, pictureUrl: null })).toBe(`${AT.origin}/en/fly/?scene=cafe0001`);
    });

    it('the words follow the place: the crash brags, the video invites, the picker invites to fly', () => {
        const kinds = Object.fromEntries(SHARE_ENTRIES.map((e) => [e, kindOf(e)]));
        expect(kinds).toEqual({ top: 'flight', key: 'flight', pause: 'flight', card: 'flight', crash: 'crash', video: 'video', picker: 'scene', recent: 'scene' });
    });

    it('control: v0.6\'s single link fails the same expectations (the catalogue page from the picker, the picture from the top bar)', () => {
        expect(v06Link({ entry: 'picker', sceneId: 'ab12cd34', pictureUrl: null })).not.toBe(shareLink({ entry: 'picker', sceneId: 'ab12cd34', inCatalogue: true, at: AT, pictureUrl: null }));
        expect(v06Link({ entry: 'top', sceneId: 'ab12cd34', pictureUrl: PIC })).not.toBe(PIC);
    });

    it('share-intent URLs and the Instagram caption carry the link, the words and the credit', () => {
        const targets = (JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'share.json'), 'utf8')) as { targets: { id: string; href: string }[] }).targets;
        expect(targets.map((x) => x.id)).toEqual(['linkedin', 'facebook', 'x', 'telegram', 'whatsapp', 'reddit']);
        for (const x of targets) expect(targetHref(x.href, PIC, 'Fly & win?', 'T'), x.id).toContain(encodeURIComponent(PIC));
        const cap = instagramCaption({ text: 'Fly it', url: PIC, credit: 'Scan: Old Mill — Jane, CC BY', tags: '#fpv' });
        expect(cap.split('\n\n')).toEqual(['Fly it', PIC, 'Scan: Old Mill — Jane, CC BY', '#fpv']);
        expect(instagramCaption({ text: 'Fly it', url: PIC, credit: null, tags: '' })).toBe(`Fly it\n\n${PIC}`);
    });

    it('the picture becomes a file without fetch (the CSP has no data: in connect-src); control: not a data URL', () => {
        const b = dataUrlBytes(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`);
        expect(b?.type).toBe('image/jpeg');
        expect(Array.from(b!.bytes)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
        expect(dataUrlBytes('https://example.com/x.jpg')).toBeNull();
    });
});

// ------------------------------------------------------------------ recording on every scan

const CATALOGUE = { title: 'Wroclaw Market Square', author: 'Owner Scans', license: 'CC BY 4.0' };
const NOT_IN_CATALOGUE: SceneCredit = creditFacts('cafe0001', undefined, { title: 'Old Mill', author: 'Jane Scan', license: 'CC BY-SA' });
const PASTED: SceneCredit = creditFacts('beef0002', undefined, {});

describe('recording works on every scan (the owner\'s item 2, D36)', () => {
    afterEach(() => vi.unstubAllGlobals());

    const recordingFor = (c: SceneCredit) => new Recording({
        prefs: mkStore(), canvas: {} as HTMLCanvasElement, scene: () => ({ id: c.id, credit: videoCredit(c) }), autoRespawn: () => true
    });

    it('a browser that can encode video records a scan outside the catalogue and a pasted one', () => {
        for (const g of ['VideoEncoder', 'VideoFrame', 'OffscreenCanvas']) vi.stubGlobal(g, class {});
        expect(recordingFor(NOT_IN_CATALOGUE).allowed).toBe(true);
        expect(recordingFor(PASTED).allowed).toBe(true);
        // without WebCodecs nothing records, whatever the scan
        vi.unstubAllGlobals();
        expect(recordingFor(NOT_IN_CATALOGUE).allowed).toBe(false);
    });

    it('control: D34\'s rule (catalogue scans only) refuses the same scans', () => {
        const d34 = (c: SceneCredit): boolean => c.inCatalogue;
        expect(d34(NOT_IN_CATALOGUE)).toBe(false);
        expect(d34(PASTED)).toBe(false);
        expect(d34(creditFacts('ab12cd34', CATALOGUE))).toBe(true);
    });

    it('the burned-in credit names the scan, its author and licence, ShramkoGSFPV and the site; a pasted scan its SuperSplat page', () => {
        expect(videoCredit(creditFacts('ab12cd34', CATALOGUE))).toBe('Wroclaw Market Square — Owner Scans, CC BY 4.0 · ShramkoGSFPV · gsfpv.flyreelstudio.eu');
        expect(videoCredit(NOT_IN_CATALOGUE)).toBe('Old Mill — Jane Scan, CC BY-SA · ShramkoGSFPV · gsfpv.flyreelstudio.eu');
        expect(videoCredit(PASTED)).toBe('superspl.at/scene/beef0002 · ShramkoGSFPV · gsfpv.flyreelstudio.eu');
        expect(creditText(creditFacts('beef0003', undefined, { title: 'Barn' }))).toBe('Barn — superspl.at/scene/beef0003');
        // the catalogue's facts win over what a listing showed
        expect(creditFacts('ab12cd34', CATALOGUE, { author: 'someone else' }).author).toBe('Owner Scans');
    });

    it('the author notice: once per scan outside the catalogue, never after "Don\'t show again", never for the catalogue', () => {
        const shown = new Set<string>();
        const first = authorNotice(NOT_IN_CATALOGUE, { enabled: true, shownFor: shown });
        expect(first).toEqual({ key: 'rec.notice', vars: { author: 'Jane Scan', license: 'CC BY-SA' } });
        shown.add(NOT_IN_CATALOGUE.id);
        expect(authorNotice(NOT_IN_CATALOGUE, { enabled: true, shownFor: shown })).toBeNull();
        expect(authorNotice(PASTED, { enabled: true, shownFor: shown })).toEqual({ key: 'rec.notice.unknown', vars: {} });
        expect(authorNotice(creditFacts('x1', undefined, { author: 'A' }), { enabled: true, shownFor: shown })).toEqual({ key: 'rec.notice.author', vars: { author: 'A' } });
        expect(authorNotice(PASTED, { enabled: false, shownFor: new Set() })).toBeNull();
        expect(authorNotice(creditFacts('ab12cd34', CATALOGUE), { enabled: true, shownFor: new Set() })).toBeNull();
        // the setting it reads is a real one, on by default
        expect(mkStore().get('recording.authorNotice')).toBe(true);
    });

    it('control: a notice that ignores what it showed comes back on every recording', () => {
        const forgetful = (c: SceneCredit) => authorNotice(c, { enabled: true, shownFor: new Set() });
        const shown = new Set([NOT_IN_CATALOGUE.id]);
        expect(forgetful(NOT_IN_CATALOGUE)).not.toBeNull();
        expect(authorNotice(NOT_IN_CATALOGUE, { enabled: true, shownFor: shown })).toBeNull();
    });

    it('no showcase-only gate is left in the recording code (the strings that refused it)', () => {
        for (const f of ['app/builtin/recording.ts', 'app/builtin/cinema.ts', 'app/builtin/video-export.ts']) {
            const s = readFileSync(join(FLY, f), 'utf8');
            expect(s, f).not.toMatch(/only for showcase scenes|rec\.onlyShowcase|scene\.meta\)\s*return/);
        }
    });
});

// ------------------------------------------------------------------ crosshair

describe('crosshair: the settings become the mark over the view', () => {
    const svgFor = (set: Record<string, unknown>): string | null => {
        const store = mkStore();
        for (const [k, v] of Object.entries(set)) store.set(k, v);
        return crosshairSvg(crosshairSpec((id) => store.get(id)));
    };
    const count = (s: string | null, tag: string): number => (s ? s.split(`<${tag} `).length - 1 : 0);

    it('off by default: nothing is drawn', () => {
        expect(mkStore().get('crosshair.shape')).toBe('off');
        expect(svgFor({})).toBeNull();
    });

    it('each shape draws its own parts (a halo under each), in the chosen colour and opacity', () => {
        const cross = svgFor({ 'crosshair.shape': 'cross', 'crosshair.color': 'cyan', 'crosshair.opacity': 0.5 });
        expect(cross).toContain('data-shape="cross"');
        expect([count(cross, 'line'), count(cross, 'circle')]).toEqual([8, 0]);
        expect(cross).toContain(`stroke="${CROSSHAIR_CSS.cyan}"`);
        expect(cross).toContain('opacity="0.5"');
        const dot = svgFor({ 'crosshair.shape': 'dot' });
        expect([count(dot, 'line'), count(dot, 'circle')]).toEqual([0, 2]);
        expect(dot).toContain(`fill="${CROSSHAIR_CSS.green}"`);
        expect([count(svgFor({ 'crosshair.shape': 'circle' }), 'circle'), count(svgFor({ 'crosshair.shape': 'ringDot' }), 'circle')]).toEqual([2, 4]);
        // a black mark gets a light halo, every other colour a dark one
        expect(svgFor({ 'crosshair.shape': 'dot', 'crosshair.color': 'black' })).toContain('rgba(255,255,255,0.7)');
    });

    it('the size follows the setting, clamped like the store clamps it', () => {
        const store = mkStore();
        store.set('crosshair.size', 9);
        expect(crosshairSpec((id) => store.get(id)).sizePct).toBe(9);
        expect(crosshairSpec((id) => (id === 'crosshair.size' ? 400 : id === 'crosshair.shape' ? 'dot' : undefined)).sizePct).toBe(20);
        expect(crosshairSpec(() => 'nonsense').shape).toBe('off');
    });

    it('control: a builder that ignores the shape draws the same mark for every shape', () => {
        const broken = (spec: CrosshairSpec) => crosshairSvg({ ...spec, shape: 'dot' });
        const spec = crosshairSpec((id) => (id === 'crosshair.shape' ? 'cross' : undefined));
        expect(broken(spec)).not.toBe(crosshairSvg(spec));
        expect(count(broken(spec), 'line')).toBe(0);
    });

    it('cinema mode and the clean view hide it; control: the stylesheet without that rule', () => {
        const css = readFileSync(join(FLY, 'app', 'builtin', 'crosshair.css'), 'utf8');
        const hides = (s: string) => /body\.cinema \.crosshair[^{]*\{\s*display:\s*none/.test(s);
        expect(hides(css)).toBe(true);
        expect(css).toMatch(/body\.clean \.crosshair/);
        expect(hides(css.replace(/body\.cinema \.crosshair, /, ''))).toBe(false);
    });
});

// ------------------------------------------------------------------ motor sound

/** A fake AudioContext: every node, connection and param target it was asked for. */
class FakeParam {
    value = 0;
    targets: number[] = [];
    setTargetAtTime(v: number): void { this.targets.push(v); }
}
class FakeNode {
    to: FakeNode[] = [];
    started = false;
    stopped = false;
    constructor(readonly kind: string) {}
    connect(n: FakeNode): void { this.to.push(n); }
    disconnect(): void { this.to = []; }
    start(): void { this.started = true; }
    stop(): void { this.stopped = true; }
}
class FakeAudio {
    currentTime = 0;
    sampleRate = 8000;
    state = 'suspended';
    destination = new FakeNode('destination');
    nodes: (FakeNode & Record<string, unknown>)[] = [];
    private add<T extends FakeNode>(n: T): T { this.nodes.push(n as FakeNode & Record<string, unknown>); return n; }
    createGain() { return this.add(Object.assign(new FakeNode('gain'), { gain: new FakeParam() })); }
    createOscillator() { return this.add(Object.assign(new FakeNode('osc'), { frequency: new FakeParam(), wave: null as unknown, setPeriodicWave(w: unknown) { this.wave = w; } })); }
    createBiquadFilter() { return this.add(Object.assign(new FakeNode('filter'), { type: '', frequency: new FakeParam(), Q: new FakeParam() })); }
    createBuffer(_c: number, len: number) { const d = new Float32Array(len); return { getChannelData: () => d }; }
    createBufferSource() { return this.add(Object.assign(new FakeNode('noise'), { buffer: null as unknown, loop: false })); }
    createPeriodicWave(real: Float32Array, imag: Float32Array) { return { real, imag }; }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
}

/** Pavo20 Pro at hover: 7200 KV x 0.75 loaded -> 565.5 rad/s per volt, a 3S pack at 11.4 V. */
const HOVER: MotorState = { motors: [0.45, 0.47, 0.44, 0.46], volt: 11.4, omegaMaxPerVolt: 7200 * 0.75 * 0.10471975511965977, armed: true, crashed: false, speed: 3 };
const FLYING: MixInput = { state: HOVER, paused: false, hidden: false, enabled: true, volume: 40 };

describe('motor sound: from the simulated motors, silent whenever the flight is not', () => {
    it('heard only while armed, flying, shown and on; silence when paused, crashed, disarmed, hidden, off, at volume 0', () => {
        expect(motorMix(FLYING).master).toBeCloseTo(Math.pow(0.4, 1.5) * MASTER_MAX, 9);
        const silent: [string, MixInput][] = [
            ['paused (a menu, a panel)', { ...FLYING, paused: true }],
            ['crashed', { ...FLYING, state: { ...HOVER, crashed: true } }],
            ['disarmed', { ...FLYING, state: { ...HOVER, armed: false } }],
            ['tab hidden', { ...FLYING, hidden: true }],
            ['sound.motors off', { ...FLYING, enabled: false }],
            ['volume 0', { ...FLYING, volume: 0 }],
            ['no flight model yet', { ...FLYING, state: null }]
        ];
        for (const [why, i] of silent) {
            expect(motorMix(i).master, why).toBe(0);
            expect(audible(i), why).toBe(false);
        }
    });

    it('control: a mix that ignores the pause keeps playing in the menu', () => {
        const ignoresPause = (i: MixInput) => motorMix({ ...i, paused: false });
        expect(ignoresPause({ ...FLYING, paused: true }).master).toBeGreaterThan(0);
    });

    it('each voice sits at its rotor\'s turning frequency; faster motor, higher note; the model is only read', () => {
        const m = motorMix(FLYING);
        expect(m.voices.map((v) => Math.round(v.freq))).toEqual(HOVER.motors.map((x) => Math.round(rotorHz(x, HOVER))));
        expect(rotorHz(0.5, HOVER)).toBeCloseTo((0.5 * HOVER.omegaMaxPerVolt * 11.4) / (2 * Math.PI), 9);
        expect(m.voices[1].freq).toBeGreaterThan(m.voices[0].freq);
        expect(m.voices[1].gain).toBeGreaterThan(m.voices[2].gain);
        // more throttle: louder wash, higher band
        const full = motorMix({ ...FLYING, state: { ...HOVER, motors: [1, 1, 1, 1] } });
        expect(full.wash.gain).toBeGreaterThan(m.wash.gain);
        expect(full.wash.freq).toBeGreaterThan(m.wash.freq);
        const frozen = Object.freeze({ ...HOVER, motors: Object.freeze([...HOVER.motors]) });
        expect(() => motorMix({ ...FLYING, state: frozen })).not.toThrow();
        // full throttle at full volume stays under clipping
        const loud = motorMix({ ...FLYING, volume: 100, state: { ...HOVER, motors: [1, 1, 1, 1], speed: 30 } });
        expect(loud.master * (loud.voices.reduce((a, v) => a + v.gain, 0) + loud.wash.gain)).toBeLessThan(1.05);
    });

    it('the prop\'s blades make the strongest harmonic', () => {
        expect([bladesOf('Gemfan 2218, 3-blade'), bladesOf('Gemfan 45 mm 4-blade'), bladesOf('31 mm class'), bladesOf(undefined)]).toEqual([3, 4, 3, 3]);
        const h = voiceHarmonics(3);
        expect(Array.from(h).indexOf(Math.max(...h))).toBe(3);
    });

    it('the graph: four voices and the wash into the master, started silent; it glides to a mix and closes for good', async () => {
        const ac = new FakeAudio();
        const s = new MotorSound(ac as unknown as AudioLike, 3);
        const oscs = ac.nodes.filter((n) => n.kind === 'osc');
        const master = ac.nodes.find((n) => n.to.includes(ac.destination))!;
        expect(oscs).toHaveLength(4);
        expect(oscs.every((o) => o.started && o.wave)).toBe(true);
        expect(ac.nodes.filter((n) => n.kind === 'noise' && n.started)).toHaveLength(1);
        expect((master.gain as FakeParam).value).toBe(0);
        s.apply(motorMix(FLYING));
        expect((master.gain as FakeParam).targets.at(-1)).toBeGreaterThan(0);
        // the pause menu opens: the master goes to 0
        s.apply(motorMix({ ...FLYING, paused: true }));
        expect((master.gain as FakeParam).targets.at(-1)).toBe(0);
        await s.resume();
        expect(ac.state).toBe('running');
        await s.close();
        expect(ac.state).toBe('closed');
        expect(oscs.every((o) => o.stopped)).toBe(true);
        expect(s.closed).toBe(true);
        const n = (master.gain as FakeParam).targets.length;
        s.apply(motorMix(FLYING));
        expect((master.gain as FakeParam).targets.length).toBe(n);
    });

    it('the settings are real: on by default at 40 %', () => {
        const store = mkStore();
        expect([store.get('sound.motors'), store.get('sound.volume')]).toEqual([true, 40]);
    });
});

// ------------------------------------------------------------------ texts and keys

/** The fly dictionary in English as the page merges it (the flat file, then every namespace). */
function enDict(): Record<string, string> {
    const dir = join(REPO, 'packages', 'i18n', 'locales', 'fly');
    const d = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')) as Record<string, string>;
    for (const ns of readdirSync(dir)) if (statSync(join(dir, ns)).isDirectory()) Object.assign(d, JSON.parse(readFileSync(join(dir, ns, 'en.json'), 'utf8')));
    return d;
}

/** Keys named as t('literal') in a source that are not in the dictionary. */
function unknownKeys(src: string, dict: Record<string, string>): string[] {
    return [...src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]).filter((k) => !(k in dict));
}

describe('every text the new code names exists', () => {
    const FILES = ['share/panel.ts', 'app/builtin/share.ts', 'app/builtin/cinema.ts', 'app/builtin/sound.ts', 'app/builtin/crosshair.ts', 'ui/scenes.ts', 'ui/scenes-superspl.ts', 'ui/crash-overlay.ts', 'ui/osd-stats.ts'];

    it('in the English dictionaries, also the keys built at run time (words per kind, the notices)', () => {
        const d = enDict();
        for (const f of FILES) expect(unknownKeys(readFileSync(join(FLY, f), 'utf8'), d), f).toEqual([]);
        for (const e of SHARE_ENTRIES) expect(d[wordsKey(kindOf(e))], e).toContain('{scene}');
        expect(d['share.text.crash']).toContain('{speed}');
        for (const k of ['rec.notice', 'rec.notice.author', 'rec.notice.unknown']) expect(d[k], k).toBeTruthy();
    });

    it('control: a planted unknown key is reported', () => {
        expect(unknownKeys("t('share.button'); t('share.nope')", enDict())).toEqual(['share.nope']);
    });
});

describe('L shares, and nothing else is bound to it', () => {
    it('in flight and over a crash', () => {
        for (const state of ['flight', 'crash'] as const) expect(actionFor({ code: 'KeyL', shiftKey: false }, state)).toBe('share.open');
        expect(keymapProblems(KEYMAP)).toEqual([]);
    });

    it('control: a second action on L is a conflict the keymap check reports', () => {
        const planted = [...KEYMAP, { action: 'test.l', keys: [{ code: 'KeyL', cap: 'L', aria: 'L' }], when: 'flight' as const, labelKey: 'keys.test.l', status: 'shipped' as const }];
        expect(keymapProblems(planted)).toEqual(['KeyL is bound to share.open and test.l (always / flight)']);
    });
});

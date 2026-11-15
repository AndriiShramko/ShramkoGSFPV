// Train 3, lane quiet2 (the lead's N1 and N4): with the narrator off what the pilot asks for with a key (K's key help, I's status) is
// still said, and nothing the page says by itself reaches a voice or a screen reader: the GPU hint's line, sent straight to the
// engine through ctx.sonic (PageRuntime.engine), and the page's live region #ui (live-quiet.ts).
import { afterEach, describe, expect, it } from 'vitest';
import { analyticCollision } from '../../../packages/collision/src';
import { scanFreeLesson } from '../../../packages/sonic-fpv/src';
import type { CueEvent, SpeechLine } from '../../../packages/sonic-fpv/src';
import { PageRuntime } from '../../../apps/fly/src/sonic/runtime';
import { quietLiveRegion } from '../../../apps/fly/src/sonic/live-quiet';
import type { LiveElement } from '../../../apps/fly/src/sonic/live-quiet';
import { Rig } from './sonic-lesson-rig';
import type { RigScan } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
});

type SayOpts = { readonly interrupt?: boolean; readonly quiet?: boolean } | undefined;

describe('N1: a line the pilot asks for is said with the narrator off', () => {
    async function flight(quiet: () => boolean): Promise<{ r: Rig; log: string[] }> {
        const collision = analyticCollision([-40, -1, -80], [40, 14, 80], 0.25, (_x, y) => y < 0);
        const scan: RigScan = { sceneId: '7a475d38', collision, sha256: 'flat-floor', track: null as never, transform: [1, 0, 0, 0], spawn: [0, 2, 0, 0] };
        const free = scanFreeLesson('7a475d38', [1, 0, 0, 0]);
        const r = await Rig.make(free, { scan });
        rig = r;
        r.mode.bridge.quiet = quiet;
        expect(await r.host.openFree(free)).toBe(true);
        const log: string[] = [];
        const eng = (r.mode.bridge as unknown as { engine: { say(line: SpeechLine, o?: SayOpts): Promise<void> } }).engine;
        const own = eng.say.bind(eng);
        eng.say = (line, o) => {
            log.push(`${line.key} ${o?.quiet === true ? 'quiet' : 'voiced'}`);
            return own(line, o);
        };
        return { r, log };
    }

    it('narrator off: K and I (asked) are voiced, the same line not asked stays quiet', async () => {
        const { r, log } = await flight(() => true);
        void r.mode.bridge.say({ key: 'sonic.say.helpNarrator' }, true, { asked: true });
        void r.mode.bridge.say({ key: 'status.none' }, true, { asked: true });
        void r.mode.bridge.say({ key: 'sonic.say.helpNarrator' }, false);
        expect(log).toEqual(['sonic.say.helpNarrator voiced', 'status.none voiced', 'sonic.say.helpNarrator quiet']);
    }, 60000);

    it('narrator on: asked or not, voiced', async () => {
        const { r, log } = await flight(() => false);
        void r.mode.bridge.say({ key: 'status.none' }, true, { asked: true });
        void r.mode.bridge.say({ key: 'status.none' }, false);
        expect(log).toEqual(['status.none voiced', 'status.none voiced']);
    }, 60000);
});

describe('N4: a line sent straight to ctx.sonic.engine (the GPU hint) keeps the narrator setting', () => {
    function page(quiet: boolean): { rt: PageRuntime; said: string[]; cues: CueEvent[]; engine: object } {
        const said: string[] = [];
        const cues: CueEvent[] = [];
        const engine = {
            level: 3,
            say(line: SpeechLine, o?: SayOpts): Promise<void> {
                said.push(`${line.key} ${o?.quiet === true ? 'quiet' : 'voiced'} ${o?.interrupt === true ? 'cut' : 'queued'}`);
                return Promise.resolve();
            },
            cue(e: CueEvent): void {
                cues.push(e);
            },
            own(): number {
                return this.level;
            }
        };
        const rt = new PageRuntime({ audio: { engine } } as never, { bridge: { quiet: () => quiet } } as never);
        return { rt, said, cues, engine };
    }

    it('narrator off in a flight: the line goes quiet with its sound (the walls line: its chime), the rest of the engine is its own', async () => {
        const p = page(true);
        await p.rt.engine.say({ key: 'sonic.say.wallsIn' }, { interrupt: false });
        await p.rt.engine.say({ key: 'gpu.say.long' }, { interrupt: false });
        expect(p.said).toEqual(['sonic.say.wallsIn quiet queued', 'gpu.say.long quiet queued']);
        expect(p.cues.map((c) => c.kind)).toEqual(['checkpoint']);
        expect((p.rt.engine as unknown as { own(): number }).own()).toBe(3);
    });

    it('a line that names its own quiet (say-via, the bridge) is passed on as it is; narrator on: voiced', async () => {
        const off = page(true);
        await off.rt.engine.say({ key: 'x' }, { quiet: false, interrupt: true });
        expect(off.said).toEqual(['x voiced cut']);
        const on = page(false);
        await on.rt.engine.say({ key: 'gpu.say.long' }, { interrupt: false });
        expect(on.said).toEqual(['gpu.say.long voiced queued']);
        expect(on.cues).toEqual([]);
    });
});

describe('N4: the live region #ui is not announced in a quiet flight', () => {
    class El implements LiveElement {
        readonly attrs = new Map<string, string>();
        readonly kids: El[] = [];
        constructor(live: string | null) {
            if (live !== null) this.attrs.set('aria-live', live);
        }
        getAttribute(n: string): string | null {
            return this.attrs.get(n) ?? null;
        }
        setAttribute(n: string, v: string): void {
            this.attrs.set(n, v);
        }
        removeAttribute(n: string): void {
            this.attrs.delete(n);
        }
        querySelectorAll(): ArrayLike<El> {
            return this.kids.filter((k) => k.attrs.has('aria-live') || k.attrs.has('data-sonic-live'));
        }
    }

    it('off: #ui and the walls box go off; on again: their own values come back', () => {
        const ui = new El('polite');
        const walls = new El('polite');
        const plain = new El(null);
        ui.kids.push(walls, plain);
        let quiet = true;
        const s = quietLiveRegion(ui, () => quiet);
        s.sync();
        expect([ui.getAttribute('aria-live'), walls.getAttribute('aria-live'), plain.getAttribute('aria-live')]).toEqual(['off', 'off', null]);
        s.sync();
        quiet = false;
        s.sync();
        expect([ui.getAttribute('aria-live'), walls.getAttribute('aria-live'), ui.getAttribute('data-sonic-live')]).toEqual(['polite', 'polite', null]);
    });

    it('narrator on: nothing changes; restore gives everything back', () => {
        const ui = new El('polite');
        const s = quietLiveRegion(ui, () => false);
        s.sync();
        expect(ui.getAttribute('aria-live')).toBe('polite');
        const q = quietLiveRegion(ui, () => true);
        q.sync();
        q.restore();
        expect(ui.getAttribute('aria-live')).toBe('polite');
        expect(quietLiveRegion(null, () => true).sync()).toBeUndefined();
    });
});

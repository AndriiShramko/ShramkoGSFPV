// Lane tutor-say S2 (b)-(d) (the outside pilot's point 1, decisions 1 and 9): between two steps of a lesson only the instruction is
// announced. The cause measured on the base (evidence/2026-11-20/tutor-say/ax-base.json): #ui, the page's one aria-live region,
// announced the HUD's text 37 to 40 times in every 3 s of a step, and the progress panel showed counters.
//   - (b) live-quiet.ts LessonHold: while a lesson runs (and the flight is not paused) #ui and every live region in it are "off"
//     even with the narrator on; let go, their own values come back.
//   - (c) live-quiet.ts relayHeldNews (wired by captions.ts): the HUD's news told while held (a crash, a problem) reaches the captions once; not held, none.
//   - (d) progress-panel.ts: one line, the step's instruction as said, no counter; the same text is not written again.
import { afterEach, describe, expect, it } from 'vitest';
import { createTranslator, getLesson } from '../../../packages/sonic-fpv/src';
import type { SpeechLine } from '../../../packages/sonic-fpv/src';
import { engineDicts } from '../../../apps/fly/src/sonic/host-lines';
import { LessonHold, quietLiveRegion, relayHeldNews } from '../../../apps/fly/src/sonic/live-quiet';
import type { LiveElement, PageNews } from '../../../apps/fly/src/sonic/live-quiet';
import { ProgressPanel, followProgress, progressNow, stepInstructions } from '../../../apps/fly/src/sonic/progress-panel';
import type { LoggedMessage } from '../../../apps/fly/src/messages-logic';
import { FakeDocument } from './sonic-fake-dom';
import { Rig } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
});

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

describe('(b) #ui is quiet while a lesson runs, the narrator on', () => {
    it('held: #ui and the message stack go off; let go: polite comes back', () => {
        const ui = new El('polite');
        const stack = new El('polite');
        ui.kids.push(stack);
        const hold = new LessonHold();
        const live = quietLiveRegion(ui as unknown as LiveElement, () => false, hold);
        live.sync();
        expect([ui.getAttribute('aria-live'), stack.getAttribute('aria-live')]).toEqual(['polite', 'polite']);
        hold.set(true);
        live.tick();
        expect([ui.getAttribute('aria-live'), stack.getAttribute('aria-live')]).toEqual(['off', 'off']);
        hold.set(false);
        live.tick();
        expect([ui.getAttribute('aria-live'), stack.getAttribute('aria-live')]).toEqual(['polite', 'polite']);
    });
});

describe('(c) the HUD news told while held reaches the captions', () => {
    function news(): { src: PageNews; tell(id: number, text: string, at: number, kind?: LoggedMessage['kind'], fix?: string): void } {
        const lines: LoggedMessage[] = [];
        const fns = new Set<() => void>();
        return {
            src: { watch: (fn) => { fns.add(fn); return () => fns.delete(fn); }, shown: () => lines },
            tell(id, text, at, kind = 'info', fix) {
                const old = lines.findIndex((l) => l.id === id);
                const e = { id, at, kind, text, ...(fix ? { fix } : {}), until: Infinity, pausedLeft: null, gone: false, unread: false } as LoggedMessage;
                if (old >= 0) lines[old] = e;
                else lines.push(e);
                for (const f of fns) f();
            }
        };
    }

    it('held and read by a screen reader: each new line once (a problem with its fix); not held: none', () => {
        const n = news();
        const added: string[] = [];
        const hold = new LessonHold();
        relayHeldNews({ add: (t) => added.push(t), current: { visible: false, live: true } }, n.src, hold);
        n.tell(1, 'Armed.', 10);
        expect(added).toEqual([]);
        hold.set(true);
        n.tell(2, 'Crashed.', 20, 'problem', 'Press key R.');
        n.tell(2, 'Crashed.', 20, 'problem', 'Press key R.');
        expect(added).toEqual(['Crashed. Press key R.']);
        n.tell(1, 'Disarmed.', 30);
        expect(added).toEqual(['Crashed. Press key R.', 'Disarmed.']);
    });

    it('control: captions not read by a screen reader: nothing is added', () => {
        const n = news();
        const added: string[] = [];
        const hold = new LessonHold();
        hold.set(true);
        relayHeldNews({ add: (t) => added.push(t), current: { visible: true, live: false } }, n.src, hold);
        n.tell(1, 'Crashed.', 10, 'problem');
        expect(added).toEqual([]);
    });
});

describe('(d) the panel: one line, the step\'s instruction, no counter', () => {
    it('rings-first: the line is the instruction said (not the title, no "n of m"), held while flying, let go when paused or stopped', async () => {
        const r = await Rig.make(getLesson('rings-first'));
        rig = r;
        const said: SpeechLine[] = [];
        const eng = (r.mode.bridge as unknown as { engine: { say(line: SpeechLine, o?: object): Promise<void> } }).engine;
        const own = eng.say.bind(eng);
        eng.say = (line, o) => {
            said.push(line);
            return own(line, o);
        };
        expect(await r.host.open('rings-first')).toBe(true);
        const doc = new FakeDocument();
        const tr = createTranslator('en', engineDicts());
        const panel = new ProgressPanel({ parent: doc.body as unknown as HTMLElement, text: (key) => key });
        const hold = new LessonHold();
        const off = followProgress(panel, (cb) => r.events.on('sonicEvent', cb), () => progressNow(r.mode, r.host.runner, (l) => tr.text(l)), hold);
        await r.run(3000, null);
        const runner = r.host.runner!;
        const instruction = stepInstructions.get(runner, runner.view().step);
        expect(instruction).not.toBeNull();
        expect(instruction!.key).not.toBe(getLesson('rings-first').title.key);
        expect(said.map((l) => l.key)).toContain(instruction!.key);
        expect(panel.text).toBe(tr.text(instruction!));
        expect(panel.text).not.toMatch(/\d+ of \d+|\n/);
        expect((panel.root as unknown as { children: unknown[] }).children.length).toBe(1);
        expect(hold.held).toBe(true);
        r.session.pause(true, 'menu');
        await r.run(200, null);
        expect(hold.held).toBe(false);
        r.session.pause(false, 'menu');
        await r.run(200, null);
        expect(hold.held).toBe(true);
        off();
        expect(hold.held).toBe(false);
    }, 300000);

    it('the same text is not written again; the node stays', () => {
        const doc = new FakeDocument();
        const panel = new ProgressPanel({ parent: doc.body as unknown as HTMLElement, text: (key) => key });
        panel.update('Fly up to the ring.');
        const node = (panel.root as unknown as { children: { textContent: string }[] }).children[0]!;
        let writes = 0;
        let text = node.textContent;
        Object.defineProperty(node, 'textContent', { get: () => text, set: (v: string) => { writes++; text = v; } });
        panel.update('Fly up to the ring.');
        panel.update('Fly up to the ring.');
        expect(writes).toBe(0);
        panel.update('Turn left.');
        expect(writes).toBe(1);
        expect((panel.root as unknown as { children: unknown[] }).children[0]).toBe(node);
    });
});

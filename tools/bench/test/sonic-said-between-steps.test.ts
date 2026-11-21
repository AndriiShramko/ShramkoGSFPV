// Lane tutor-say (train 4; the first outside feedback, 2026-11-20: "the menu buttons must not be read out at every step"; plan
// Part A1, decision 1 "say only what is new"). What the narrator speaks between step N and step N+1 of a lesson is that step's own
// lines and nothing else: no line of the host's (the line of keys "Next, key N. Back, key B ...", a menu, a counter). The line of
// keys is said at most once a session, when keys first matter. Both paths a pilot hears: the voice (speechSynthesis, one queue)
// and the captions a screen reader announces ("my screen reader speaks": the engine hands every line over at once, FakeEngine
// parallel; entry.ts onCaption adds each to the live captions region, so the lines handed over are the lines announced).
import { afterEach, describe, expect, it } from 'vitest';
import { getLesson } from '../../../packages/sonic-fpv/src';
import { Rig } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
});

/** A line of the host's own (the page's dictionary, host-lines.ts: every key starts with 'sonic.'), not a line of the lesson. */
const hostLine = (key: string): boolean => key.startsWith('sonic.');
const isKeysLine = (key: string): boolean => key === 'sonic.say.lessonKeys' || key === 'sonic.say.lessonKeysFree';

/** Every line handed to the engine, with the step it was said in ("step/steps" of the lesson open then). */
interface Said { readonly key: string; readonly text: string; readonly lesson: string; readonly step: string; readonly live: boolean }

function record(r: Rig): Said[] {
    const out: Said[] = [];
    r.engine.onSpeech = (line, text) => {
        const run = r.host.runner;
        const v = run?.view();
        out.push({ key: line.key, text, lesson: r.host.lesson?.id ?? '', step: v ? `${v.step}/${v.steps}` : '', live: true });
    };
    return out;
}

/** The lesson's steps walked with N; the lines said from each step change to the next. */
async function walk(r: Rig, said: Said[], changes: number): Promise<{ from: string; to: string; lines: Said[] }[]> {
    const out: { from: string; to: string; lines: Said[] }[] = [];
    for (let i = 0; i < changes; i++) {
        const v0 = r.host.runner!.view();
        const from = `${v0.step}/${v0.steps}`;
        const mark = said.length;
        expect(r.press('scene.next')).toBe(true);
        await r.run(2500, null);
        const v1 = r.host.runner!.view();
        out.push({ from, to: `${v1.step}/${v1.steps}`, lines: said.slice(mark) });
    }
    return out;
}

for (const path of ['voice', 'captions'] as const) {
    describe(`decision 1, ${path}: between step N and N+1 only the step's own lines are said`, () => {
        it('a flying lesson (walls-hall): no host line at any step change; the line of keys at most once', async () => {
            rig = await Rig.make(getLesson('walls-hall'));
            rig.engine.parallel = path === 'captions';
            const said = record(rig);
            expect(await rig.host.open('walls-hall')).toBe(true);
            await rig.run(4000, null);
            const changes = await walk(rig, said, 3);
            const moved = changes.filter((c) => c.from !== c.to);
            expect(moved.length, JSON.stringify(changes.map((c) => [c.from, c.to]))).toBeGreaterThanOrEqual(2);
            for (const c of moved) {
                expect(c.lines.length, `${c.from} -> ${c.to}: something said`).toBeGreaterThan(0);
                expect(c.lines.filter((l) => hostLine(l.key)).map((l) => `${l.key}: ${l.text}`), `${c.from} -> ${c.to}`).toEqual([]);
            }
            expect(said.filter((l) => isKeysLine(l.key)).length).toBeLessThanOrEqual(1);
        }, 120000);

        it('a listening lesson (ears-headphones), then a flying one in the same session: the line of keys once in the session', async () => {
            rig = await Rig.make(getLesson('ears-headphones'));
            rig.engine.parallel = path === 'captions';
            const said = record(rig);
            expect(await rig.host.open('ears-headphones')).toBe(true);
            await rig.run(6000, null);
            const changes = await walk(rig, said, 3);
            for (const c of changes.filter((x) => x.from !== x.to).slice(1)) {
                expect(c.lines.filter((l) => hostLine(l.key)).map((l) => `${l.key}: ${l.text}`), `${c.from} -> ${c.to}`).toEqual([]);
            }
            // the next lesson of the same session (the page's host is one for the whole visit): the keys are not named again
            expect(await rig.host.open('walls-hall')).toBe(true);
            await rig.run(4000, null);
            await walk(rig, said, 2);
            expect(said.filter((l) => isKeysLine(l.key)).map((l) => `${l.lesson} ${l.step}`)).toHaveLength(1);
        }, 180000);
    });
}

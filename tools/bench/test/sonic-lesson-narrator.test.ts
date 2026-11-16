// Lane quiet (train 3, Q5): a lesson of the lesson list needs its words. Opened with the narrator off, it keeps them (entry.ts
// quietFlight) and says so once, right after its title; with the narrator on nothing is added. The saved setting is never changed
// by a lesson, so the pilot's "off" is there again after it (nothing to give back).
import { afterEach, describe, expect, it } from 'vitest';
import { getLesson } from '../../../packages/sonic-fpv/src';
import { Rig } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
});

async function open(id: string, narratorOff: boolean, keyHints = true): Promise<Rig> {
    rig = await Rig.make(getLesson(id));
    rig.narratorOff = narratorOff;
    rig.keyHints = keyHints;
    expect(await rig.host.open(id)).toBe(true);
    return rig;
}

const keys = (r: Rig): string[] => r.engine.said.map((s) => s.line.key);

describe('Q5: a lesson opened with the narrator off says that the narrator is on for it', () => {
    it('the narrator off: the line once, right after the lesson title', async () => {
        const r = await open('rings-first', true);
        const k = keys(r);
        expect(k.filter((x) => x === 'sonic.say.lessonNarrator')).toHaveLength(1);
        expect(k[k.indexOf('sonic.say.lessonNarrator') - 1]).toBe('lesson.rings-first.title');
        // not quiet: the lesson is voiced
        expect(r.engine.said.find((s) => s.line.key === 'sonic.say.lessonNarrator')?.quiet).not.toBe(true);
    });

    it('also with the key hints off', async () => {
        const r = await open('rings-first', true, false);
        expect(keys(r).filter((x) => x === 'sonic.say.lessonNarrator')).toHaveLength(1);
    });

    it('the narrator on: no such line', async () => {
        const r = await open('rings-first', false);
        expect(keys(r)).not.toContain('sonic.say.lessonNarrator');
    });
});

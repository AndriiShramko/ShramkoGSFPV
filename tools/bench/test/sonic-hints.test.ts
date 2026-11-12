// Lane sonic-hints (the owner's complaint of 2026-11-10: "which key do I press to go to the next lesson or the next step"; docs/wip/
// sonic-hints.md). H1: a short line of keys at the start of every step, once a step, with a setting brief or off. H2: the lesson menu
// names each item's key. H3: X leaves a lesson for the main menu in one press and says where the pilot is. H4: the sound lost in a
// lesson (the context stopped, the tab hidden) is said on the return, with the key that repeats the task.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranslator, getLesson } from '../../../packages/sonic-fpv/src';
import { KEYMAP } from '../../../packages/prefs/src/keymap';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { engineDicts } from '../../../apps/fly/src/sonic/host-lines';
import { keyHintsChoice, keyHintsOn, setKeyHints } from '../../../apps/fly/src/sonic/key-hints';
import { KeyNames } from '../../../apps/fly/src/sonic/key-names';
import { mkStore } from '../../../packages/prefs/test/helpers';
import { Rig } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
    vi.restoreAllMocks();
});

async function open(id: string, before?: (r: Rig) => void): Promise<Rig> {
    rig = await Rig.make(getLesson(id));
    before?.(rig);
    expect(await rig.host.open(id)).toBe(true);
    return rig;
}

function pageNames(): KeyNames {
    const router = new KeyRouter({ map: KEYMAP, sonic: () => true });
    return new KeyNames((a) => router.caps(a), (code) => (code === 'Escape' ? 'Escape' : null));
}

const keyLines = (r: Rig) => r.engine.said.filter((s) => s.line.key === 'sonic.say.lessonKeys');

describe('H1: the keys of the moment at the start of every step, once a step; the setting brief or off', () => {
    it('the line names next, back, repeat, the lesson menu and the main menu by the pilot\'s names, after the title, not cutting', async () => {
        const names = pageNames();
        names.setLayout(new Map([['KeyZ', 'y'], ['KeyN', 'n'], ['KeyB', 'b'], ['KeyX', 'x']]));
        const r = await open('rings-first', (rr) => { rr.lessonKeys = names.lessonStart(); });
        const first = r.engine.said.slice(0, 2);
        expect(first[0]).toMatchObject({ line: getLesson('rings-first').title });
        expect(first[1]).toMatchObject({ line: { key: 'sonic.say.lessonKeys', params: { next: 'N', previous: 'B', repeat: 'Y', menu: 'Escape', home: 'X' } }, interrupt: false });
        expect(first[1]!.text).toBe('Keys: N next, B back, Y repeat, Escape menu, X main menu.');
        // one short phrase: one sentence, at most 16 words, in every language
        const dicts = engineDicts();
        for (const l of ['en', 'es', 'pl', 'ru'] as const) {
            const text = dicts[l]['sonic.say.lessonKeys']!;
            for (const k of ['{next}', '{previous}', '{repeat}', '{menu}', '{home}']) expect(text, `${l} ${k}`).toContain(k);
            expect(text.split(/\s+/).length, l).toBeLessThanOrEqual(16);
            expect(text.replace(/\.$/, ''), l).not.toMatch(/[.!?]/);
        }
    }, 120000);

    it('a new step says it again (N, then B back to the task); inside a step it is not said again (Z, the lines after the first)', async () => {
        const r = await open('rings-first');
        expect(keyLines(r)).toHaveLength(1);
        await r.run(1500, null);
        // Z in the task: the same step, its lines again, the keys not
        expect(r.press('sonic.repeat')).toBe(true);
        await r.run(1500, null);
        expect(r.host.runner!.view().step).toBe(1);
        expect(keyLines(r)).toHaveLength(1);
        // N: the flight, step 2: its first line, then the keys
        expect(r.press('scene.next')).toBe(true);
        await r.run(1500, null);
        expect(r.host.runner!.view().step).toBe(2);
        expect(keyLines(r)).toHaveLength(2);
        // B: back to the task, step 1 again
        expect(r.press('feedback.open')).toBe(true);
        await r.run(1500, null);
        expect(r.host.runner!.view().step).toBe(1);
        expect(keyLines(r)).toHaveLength(3);
        // each follows a line of its step and no two of them are said one after the other
        const said = r.engine.said.map((s) => s.line.key);
        said.forEach((k, i) => { if (k === 'sonic.say.lessonKeys') expect(said[i - 1]).not.toBe('sonic.say.lessonKeys'); });
    }, 120000);

    it('in a lesson of many steps (the glossary) every step that speaks names the keys once', async () => {
        const r = await open('ears-glossary');
        const steps = new Set<number>();
        for (let i = 0; i < 4; i++) {
            await r.run(800, null);
            steps.add(r.host.runner!.view().step);
            expect(r.press('scene.next')).toBe(true);
        }
        await r.run(800, null);
        steps.add(r.host.runner!.view().step);
        expect(steps.size).toBeGreaterThan(2);
        expect(keyLines(r).length).toBeGreaterThanOrEqual(steps.size - 1);
        expect(keyLines(r).length).toBeLessThanOrEqual(steps.size);
    }, 120000);

    it('off: no line of keys at all; the choice is kept in the prefs collection (absent is brief)', async () => {
        const r = await open('rings-first', (rr) => { rr.keyHints = false; });
        expect(r.press('scene.next')).toBe(true);
        await r.run(1500, null);
        expect(keyLines(r)).toHaveLength(0);
        const store = mkStore();
        expect(keyHintsOn(store)).toBe(true);
        expect(keyHintsChoice(store)).toBe('brief');
        setKeyHints(store, 'off');
        expect(keyHintsChoice(store)).toBe('off');
        expect(store.collection('sonic').keyHints).toBe(false);
        setKeyHints(store, 'brief');
        expect(keyHintsOn(store)).toBe(true);
        const tr = createTranslator('ru', engineDicts());
        expect(tr.text({ key: 'sonic.say.lessonKeys', params: { next: 'N', previous: 'B', repeat: 'Z', menu: 'Escape', home: 'X' } })).toContain('B назад');
    }, 120000);
});

// Lane sonic-hints (the owner's complaint of 2026-11-10: "which key do I press to go to the next lesson or the next step"; docs/wip/
// sonic-hints.md). H1: a short line of keys at the start of every step, once a step, with a setting brief or off. H2: the lesson menu
// names each item's key. H3: X leaves a lesson for the main menu in one press and says where the pilot is. H4: the sound lost in a
// lesson (the context stopped, the tab hidden) is said on the return, with the key that repeats the task.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranslator, getLesson } from '../../../packages/sonic-fpv/src';
import type { SpeechLine } from '../../../packages/sonic-fpv/src';
import { KEYMAP, actionFor, keymapProblems } from '../../../packages/prefs/src/keymap';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { engineDicts } from '../../../apps/fly/src/sonic/host-lines';
import { keyHintsChoice, keyHintsOn, setKeyHints } from '../../../apps/fly/src/sonic/key-hints';
import { KeyNames } from '../../../apps/fly/src/sonic/key-names';
import { LESSON_MENU_ITEMS, LessonMenu, homeKey } from '../../../apps/fly/src/sonic/lesson-menu';
import type { HomePage, LessonMenuItem } from '../../../apps/fly/src/sonic/lesson-menu';
import { keyHelpLines } from '../../../apps/fly/src/sonic/mode-keys';
import { SoundGap } from '../../../apps/fly/src/sonic/sound-gap';
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
        expect(tr.text({ key: 'sonic.say.lessonKeys', params: { next: 'N', previous: 'B', repeat: 'Z', menu: 'Escape', home: 'X' } })).toBe(engineDicts().ru['sonic.say.lessonKeys']!.replace('{next}', 'N').replace('{previous}', 'B').replace('{repeat}', 'Z').replace('{menu}', 'Escape').replace('{home}', 'X'));
    }, 120000);
});

const EN = createTranslator('en', engineDicts());

describe('H2: the lesson menu names each item\'s key, and its first line says the same actions have keys without it', () => {
    const KEYS: Partial<Record<LessonMenuItem, string>> = { resume: 'Escape', repeat: 'Z', 'next-step': 'N', 'previous-step': 'B', lessons: 'X' };
    function menu(): { m: LessonMenu; said: SpeechLine[] } {
        const said: SpeechLine[] = [];
        const m = new LessonMenu({ say: async (l) => { said.push(l); }, text: (l) => EN.text(l), hold: () => undefined, readerSpeaks: () => false, keyOf: (i) => KEYS[i] ?? '', run: () => undefined, view: null });
        return { m, said };
    }

    it('every item with a key says it after its name, on the button too (a screen reader reads it); the others as before', () => {
        const { m } = menu();
        expect(m.labels()).toEqual(['Resume, key Escape', 'Repeat the task, key Z', 'Next step, key N', 'Previous step, key B', 'Next lesson', 'Lesson list, key X', 'Sound settings', 'Leave the mode']);
        expect(EN.text(m.itemLine(2))).toBe('Next step, key N. Item 3 of 8.');
    });

    it('opening: the menu\'s line says the actions have keys, then Resume with its key; in four languages', () => {
        const { m, said } = menu();
        m.open();
        expect(EN.text(said[0]!)).toContain('The same actions have keys without the menu: each item says its key.');
        expect(said[1]).toEqual({ key: 'menu.item', params: { label: 'Resume, key Escape', n: 1, total: LESSON_MENU_ITEMS.length } });
        m.step(1);
        expect(EN.text(said.at(-1)!)).toBe('Repeat the task, key Z. Item 2 of 8.');
        const dicts = engineDicts();
        for (const l of ['en', 'es', 'pl', 'ru'] as const) {
            expect(dicts[l]['sonic.say.menuItemKey'], l).toMatch(/\{label\}.*\{key\}/);
            expect(dicts[l]['sonic.say.menuOpen']!.length, l).toBeGreaterThan(dicts.en['sonic.say.menuTitle']!.length + 60);
        }
    });

    it('the page names the items by its key table: Escape, Z, N, B and X as the router routes them on a mode\'s page', () => {
        const names = pageNames();
        expect([names.of('pause.toggle', 'Escape'), names.of('sonic.repeat'), names.of('scene.next'), names.of('feedback.open'), names.of('sonic.home')]).toEqual(['Escape', 'Z', 'N', 'B', 'X']);
    });
});

describe('H3: X leaves a lesson for the main menu in one press, then says where the pilot is', () => {
    it('X: the start screen, then "Main menu ... the lesson is saved" cutting what was said; a held key\'s repeats and X outside a lesson do nothing', () => {
        const events: string[] = [];
        let active = true;
        const page: HomePage = { active: () => active, title: () => 'First rings', showScreen: () => { events.push('screen'); }, say: async (l, i) => { events.push(`${EN.text(l)} | ${i}`); } };
        const press = homeKey(page);
        press({ repeat: false });
        expect(events).toEqual(['screen', 'Main menu of Fly by Sound. The lesson First rings is saved: Continue takes you back to it. | true']);
        press({ repeat: true });
        active = false;
        press({ repeat: false });
        expect(events).toHaveLength(2);
        const ru = createTranslator('ru', engineDicts());
        const ruHome = ru.text({ key: 'sonic.say.homeBack', params: { title: 'T1' } });
        expect(ruHome).toContain('T1');
        expect(ruHome).not.toBe(EN.text({ key: 'sonic.say.homeBack', params: { title: 'T1' } }));
    });

    it('X is the mode\'s key (only on a page entered through ?sonic=), free of every other binding; K names it', () => {
        expect(actionFor({ code: 'KeyX', shiftKey: false }, 'flight', { sonic: true })).toBe('sonic.home');
        expect(actionFor({ code: 'KeyX', shiftKey: false }, 'flight')).toBeNull();
        expect(keymapProblems(KEYMAP)).toEqual([]);
        expect(keyHelpLines((a, aria) => pageNames().of(a, aria))).toContainEqual({ key: 'sonic.say.helpHome', params: { key: 'X' } });
    });
});

describe('H4: the sound lost in a lesson is said on the return, with the key that repeats the task', () => {
    function gap(): { g: SoundGap; said: SpeechLine[]; s: { lesson: boolean; visible: boolean; running: boolean } } {
        const s = { lesson: true, visible: true, running: true };
        const said: SpeechLine[] = [];
        const g = new SoundGap({ lessonActive: () => s.lesson, visible: () => s.visible, audioRunning: () => s.running, repeatKey: () => 'Z', say: (l) => { said.push(l); } });
        return { g, said, s };
    }

    it('the tab hidden in a lesson: on the return one line, "The sound was interrupted. Press Z ..."; checks after it say nothing', () => {
        const { g, said, s } = gap();
        g.check();
        expect(said).toEqual([]);
        s.visible = false;
        g.check();
        g.check();
        expect(g.pending).toBe(true);
        expect(said).toEqual([]);
        s.visible = true;
        g.check();
        g.check();
        expect(said).toEqual([{ key: 'sonic.say.soundBack', params: { key: 'Z' } }]);
        expect(EN.text(said[0]!)).toBe('The sound was interrupted. Press Z to hear this step\'s task again.');
    });

    it('the context stopped while visible: said once it runs again; control: a gap with no lesson open, or a lesson closed meanwhile, says nothing', () => {
        const { g, said, s } = gap();
        s.running = false;
        g.check();
        s.running = true;
        g.check();
        expect(said).toHaveLength(1);
        const b = gap();
        b.s.lesson = false;
        b.s.visible = false;
        b.g.check();
        b.s.visible = true;
        b.g.check();
        expect(b.said).toEqual([]);
        const c = gap();
        c.s.visible = false;
        c.g.check();
        c.s.lesson = false;
        c.s.visible = true;
        c.g.check();
        expect(c.said).toEqual([]);
        for (const l of ['en', 'es', 'pl', 'ru'] as const) expect(engineDicts()[l]['sonic.say.soundBack'], l).toContain('{key}');
    });
});

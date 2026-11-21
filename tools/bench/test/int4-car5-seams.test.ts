// Train 4, integration car 5 (S2): where the tutorial lanes meet the lanes of cars 1 to 3.
//   - tutor-say quiets #ui while a lesson runs; a crash or a problem told through ux4a's real message service (ui/messages.ts,
//     the HUD's flash and every feature's tell) must still reach the captions (captions.ts pageNews -> live-quiet.ts relayHeldNews)
//   - tutor-air's keys of a sound flight (G = What is this sound?, Shift+K = I know this) beside gen4b's Shift+G (the Generate
//     dialog; in a sound flight the asked course) and K (the key help): one action a chord, in the sound mode and outside it
import { describe, expect, it } from 'vitest';
import { KEYMAP, actionFor, keymapProblems } from '../../../packages/prefs/src/keymap';
import { LessonHold, relayHeldNews } from '../../../apps/fly/src/sonic/live-quiet';
import { fakeDocument } from './helpers/fake-dom';

async function realNews() {
    // ui/messages.ts reaches i18n.ts (the page's path on load) and ui/dom.ts, as int4-seams.test.ts's start line
    const g = globalThis as { location?: unknown; document?: unknown };
    g.document ??= fakeDocument();
    g.location ??= { pathname: '/en/', search: '', href: 'http://localhost/en/' };
    const { messages } = await import('../../../apps/fly/src/ui/messages');
    const { pageNews } = await import('../../../apps/fly/src/sonic/captions');
    return { messages, pageNews };
}

describe('int4 car 5: tutor-say\'s quiet #ui x ux4a\'s message service', () => {
    it('held by a lesson and read by a screen reader: a crash line and a problem with its fix reach the captions, each once', async () => {
        const { messages, pageNews } = await realNews();
        const hold = new LessonHold();
        hold.set(true);
        const added: string[] = [];
        const off = relayHeldNews({ add: (t) => added.push(t), current: { live: true } }, pageNews, hold);
        messages.tell({ text: 'car5 crashed into a wall' });
        messages.tell({ kind: 'problem', text: 'car5 the course did not load.', fix: 'car5 press key N.' });
        expect(added).toContain('car5 crashed into a wall');
        expect(added).toContain('car5 the course did not load. car5 press key N.');
        expect(added.filter((x) => x.startsWith('car5 crashed'))).toHaveLength(1);
        off();
    });

    it('control: not held (a pause, a menu, no lesson): #ui speaks for itself and nothing is relayed', async () => {
        const { messages, pageNews } = await realNews();
        const added: string[] = [];
        const off = relayHeldNews({ add: (t) => added.push(t), current: { live: true } }, pageNews, new LessonHold());
        messages.tell({ text: 'car5 not held' });
        expect(added).toEqual([]);
        off();
    });
});

describe('int4 car 5: tutor-air\'s G and Shift+K x gen4b\'s Shift+G x the key help K', () => {
    const press = (code: string, shiftKey: boolean, sonic: boolean) => actionFor({ code, shiftKey }, 'flight', { sonic });

    it('a sound flight: G is What is this sound?, Shift+K I know this, Shift+G the course, K the key help', () => {
        expect(press('KeyG', false, true)).toBe('sonic.whatSound');
        expect(press('KeyK', true, true)).toBe('sonic.know');
        expect(press('KeyG', true, true)).toBe('course.generate');
        expect(press('KeyK', false, true)).toBe('help.keys');
        expect(keymapProblems(KEYMAP)).toEqual([]);
    });

    it('control: outside the sound mode G and Shift+K do nothing; Shift+G is still the Generate dialog', () => {
        expect(press('KeyG', false, false)).toBeNull();
        expect(press('KeyK', true, false)).toBeNull();
        expect(press('KeyG', true, false)).toBe('course.generate');
    });
});

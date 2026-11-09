// v13-int review fixes (docs/wip/v13-int-review.md "Fixes"), in the lesson rig (tools/bench/test/sonic-lesson-rig.ts: the real flight model,
// lesson pilot, mode, bridge, host and the package's runner; a fake engine that speaks like speechSynthesis and records how each line
// ended) and the lesson menu as sonic/feature.ts makes it (the page's pause stack told to the bridge at once, its DOM view on a stand-in):
//  - F1: a host line that cuts the lesson's lines (the lesson menu, I, the start screen) has them said again, whole and in order, once the
//    host is done; the menu's own lines end at "Resume."; a later line of the lesson drops them (the lesson moved on).
//  - F3: B at the first step of the path's first lesson leaves for the start screen; closed without a lesson chosen, the lesson starts
//    again from its beginning and its keys work (the last lesson of the path, N's way out, is sonic-garden.test.ts's: a scan).
//  - F5: the progress panel draws nothing of the live lesson while a replay plays, and is drawn again when the replay starts and ends.
// The start screen's part of F2 and F4 is sonic-start-screen.test.ts's; the page's, tools/bench/src/sonic-v13-page.ts R.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPEECH_END_KEY, createTranslator, getLesson, lessonBefore, lessonPaths } from '../../../packages/sonic-fpv/src';
import type { SessionEvent } from '../../../packages/sonic-fpv/src';
import { PauseStack } from '../../../apps/fly/src/app/pause-stack';
import { engineDicts } from '../../../apps/fly/src/sonic/host-lines';
import { DomLessonMenuView, LESSON_MENU_ITEMS, LessonMenu, pauseKey, runItem } from '../../../apps/fly/src/sonic/lesson-menu';
import type { KeySource } from '../../../apps/fly/src/sonic/lesson-menu';
import { ProgressPanel, followProgress, progressNow } from '../../../apps/fly/src/sonic/progress-panel';
import { PageRuntime } from '../../../apps/fly/src/sonic/runtime';
import { FakeDocument } from './sonic-fake-dom';
import { Rig } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
    vi.restoreAllMocks();
});

async function open(id: string): Promise<Rig> {
    rig = await Rig.make(getLesson(id));
    expect(await rig.host.open(id)).toBe(true);
    return rig;
}

/** The lesson menu in the rig's page as sonic/feature.ts makes it; `hold`: the page's pause stack ('menu', and the start screen's 'panel'). */
function menuPage(r: Rig): { menu: LessonMenu; doc: FakeDocument; stack: PauseStack<'menu' | 'panel'>; screens: string[]; escape(): void } {
    const doc = new FakeDocument();
    const tr = createTranslator('en', engineDicts());
    const stack = new PauseStack<'menu' | 'panel'>((on) => {
        r.session.pause(on, 'menu');
        r.mode.bridge.syncPause();
    });
    const screens: string[] = [];
    const menu = new LessonMenu({
        say: (line, interrupt) => r.mode.bridge.say(line, interrupt),
        text: (line) => tr.text(line),
        hold: (on) => (on ? stack.hold('menu') : stack.release('menu')),
        readerSpeaks: () => false,
        run: runItem({
            mode: r.mode,
            showScreen: (section) => {
                // the start screen holds the flight itself (feature.ts showMenu: the pause 'panel')
                stack.hold('panel');
                screens.push(section ?? 'start');
            },
            leave: () => r.host.close()
        }),
        view: new DomLessonMenuView(doc.body as unknown as HTMLElement, doc.body as unknown as KeySource)
    });
    return { menu, doc, stack, screens, escape: () => pauseKey(menu, () => undefined)({ code: 'Escape', repeat: false }) };
}

const L = (id: string, part: string): string => `lesson.${id}.${part}`;
/** The lines the voice said to their end (not cut), with when it began and ended them. */
const whole = (r: Rig, key: string): { start: number; at: number }[] => r.engine.ends.filter((e) => e.key === key && !e.cut);
const speechEnds = (r: Rig): SessionEvent[] => r.sonic.filter((e) => e.kind === 'speech' && e.key === SPEECH_END_KEY);

// ------------------------------------------------------------------ F1

describe('review F1: lines of the lesson a host line cut are said again, whole and in order, once the host is done', () => {
    it('hover-height, Escape 1.5 s in and Escape again 0.2 s later: the keys line, intro.1 and intro.2 are said whole after the menu, in order, before intro.3; "Resume." ends the menu\'s own lines', async () => {
        const r = await open('hover-height');
        await r.run(1500, null);
        const p = menuPage(r);
        p.escape();
        expect(p.menu.isOpen).toBe(true);
        await r.run(200, null);
        p.doc.key('Escape');
        expect(p.menu.isOpen).toBe(false);
        const closed = r.clock.t;
        // "Resume." at the close, cutting what the menu was still saying
        const resume = r.engine.said.find((s) => s.line.key === 'sonic.say.menuResume');
        expect(resume).toMatchObject({ interrupt: true, at: closed });
        const menuLines = r.engine.ends.filter((e) => e.key === 'sonic.say.menuOpen' || e.key === 'menu.item');
        expect(menuLines.length).toBe(2);
        expect(menuLines.every((e) => e.cut && e.at === closed)).toBe(true);
        await r.run(120000, null, () => r.host.runner!.phase === 'flying');
        expect(r.host.runner!.phase).toBe('flying');
        const order = ['sonic.say.lessonKeys', L('hover-height', 'intro.1'), L('hover-height', 'intro.2'), L('hover-height', 'intro.3')];
        for (const k of order) {
            expect(whole(r, k), k).toHaveLength(1);
            expect(whole(r, k)[0]!.start, k).toBeGreaterThanOrEqual(closed);
        }
        for (let i = 1; i < order.length; i++) expect(whole(r, order[i]!)[0]!.start, order[i]).toBeGreaterThanOrEqual(whole(r, order[i - 1]!)[0]!.at);
        // after "Resume." ended, not over it
        const resumed = r.engine.ends.find((e) => e.key === 'sonic.say.menuResume')!;
        expect(resumed.cut).toBe(false);
        expect(whole(r, 'sonic.say.lessonKeys')[0]!.start).toBeGreaterThanOrEqual(resumed.at);
        // the title was said whole before the menu, and not again
        expect(whole(r, L('hover-height', 'title'))).toHaveLength(1);
        expect(whole(r, L('hover-height', 'title'))[0]!.at).toBeLessThan(closed);
    }, 300000);

    it('a browser that reports a cancelled line late (Chrome: a line cut before it began resolves at its safety timeout): the lesson\'s lines follow "Resume." at once, not after the menu\'s cut lines report in', async () => {
        const r = await open('hover-height');
        r.engine.lateCancelMs = 15000;
        await r.run(1500, null);
        const p = menuPage(r);
        p.escape();
        await r.run(200, null);
        p.doc.key('Escape');
        await r.run(30000, null, () => whole(r, L('hover-height', 'intro.1')).length > 0);
        const resumed = r.engine.ends.find((e) => e.key === 'sonic.say.menuResume')!;
        expect(resumed.cut).toBe(false);
        // the keys line said again as soon as "Resume." ended (the same frame), not 15 s later when the menu's queued item line reports its cut
        expect(whole(r, 'sonic.say.lessonKeys')[0]!.start - resumed.at).toBeLessThanOrEqual(20);
        expect(whole(r, L('hover-height', 'intro.1'))).toHaveLength(1);
    }, 300000);

    it('control: the same lesson without the menu says each of those lines whole once, in the same order (as before the fix)', async () => {
        const r = await open('hover-height');
        await r.run(120000, null, () => r.host.runner!.phase === 'flying');
        for (const k of ['sonic.say.lessonKeys', L('hover-height', 'intro.1'), L('hover-height', 'intro.2'), L('hover-height', 'intro.3')]) expect(whole(r, k), k).toHaveLength(1);
        expect(r.engine.ends.filter((e) => e.cut)).toEqual([]);
    }, 300000);

    it('I during the task (no pause): its line cuts the task, which is said again whole after it; the end of speech comes after the task, not after I', async () => {
        const r = await open('hover-height');
        await r.run(1500, null);
        const ends0 = speechEnds(r).length;
        void r.mode.bridge.say(r.host.status(), true);
        const said = r.clock.t;
        await r.run(60000, null, () => whole(r, L('hover-height', 'intro.2')).length > 0);
        const status = r.engine.ends.find((e) => e.key.startsWith('status.'))!;
        expect(status.cut).toBe(false);
        for (const k of ['sonic.say.lessonKeys', L('hover-height', 'intro.1'), L('hover-height', 'intro.2')]) {
            expect(whole(r, k), k).toHaveLength(1);
            expect(whole(r, k)[0]!.start, k).toBeGreaterThanOrEqual(status.at);
        }
        expect(r.engine.ends.filter((e) => e.cut).every((e) => e.at === said)).toBe(true);
        // the runner heard one end of speech, when the task's part ended
        expect(speechEnds(r).slice(ends0).length).toBe(1);
        expect(speechEnds(r).at(-1)!.t).toBeGreaterThanOrEqual(Math.round(whole(r, L('hover-height', 'intro.2'))[0]!.at) - 20);
    }, 300000);

    it('the lesson moved on: the menu\'s Next step during the task drops the cut lines (they are not said again), and the next part is said', async () => {
        const r = await open('hover-height');
        await r.run(1500, null);
        const p = menuPage(r);
        p.escape();
        for (let i = 0; i < LESSON_MENU_ITEMS.indexOf('next-step'); i++) p.doc.key('ArrowDown');
        p.doc.key('Enter', { code: 'Enter' });
        await r.run(60000, null);
        expect(whole(r, L('hover-height', 'intro.1'))).toEqual([]);
        expect(whole(r, L('hover-height', 'intro.2'))).toEqual([]);
        expect(r.mode.bridge.waitingToSayAgain).toBe(0);
        expect(r.of('key').map((e) => e.action)).toContain('next');
    }, 300000);

    it('the start screen over the task (the menu\'s Sound settings): the task waits, and is said again when the screen closes, its first line cutting what the screen still said', async () => {
        const r = await open('hover-height');
        await r.run(1500, null);
        const p = menuPage(r);
        p.escape();
        for (let i = 0; i < LESSON_MENU_ITEMS.indexOf('settings'); i++) p.doc.key('ArrowDown');
        p.doc.key('Enter', { code: 'Enter' });
        expect(p.screens).toEqual(['settings']);
        // the screen's spoken list says a stop (a host line, interrupting), and the pilot stays a while
        void r.mode.bridge.say({ key: 'sonic.say.text', params: { text: 'Settings. Theme: Soft. Item 1 of 14.' } }, true);
        await r.run(5000, null);
        expect(whole(r, L('hover-height', 'intro.1'))).toEqual([]);
        void r.mode.bridge.say({ key: 'sonic.say.text', params: { text: 'Calm sound: off. Item 2 of 14.' } }, true);
        // the screen closes (feature.ts closeMenu: the 'panel' released) while its line is still said
        p.stack.release('panel');
        const closed = r.clock.t;
        // (the rig's page runs its next task 2 ms on: the bridge says them again right after the close, in the same turn of the page)
        await r.run(1, null);
        const screenLine = r.engine.ends.filter((e) => e.key === 'sonic.say.text').at(-1)!;
        expect(screenLine.cut).toBe(true);
        expect(screenLine.at - closed).toBeLessThanOrEqual(2);
        await r.run(60000, null, () => whole(r, L('hover-height', 'intro.2')).length > 0);
        expect(whole(r, 'sonic.say.lessonKeys')[0]!.start).toBe(screenLine.at);
        expect(whole(r, L('hover-height', 'intro.1'))[0]!.start).toBeGreaterThanOrEqual(closed);
    }, 300000);
});

// ------------------------------------------------------------------ F3

describe('review F3: B at the first step of the path\'s first lesson leaves no dead lesson behind the start screen', () => {
    it('ears-headphones (lesson 1 of the path), B at its first step: the start screen; closed without a lesson chosen, the lesson starts again from its beginning, and N moves it on', async () => {
        const first = lessonPaths().full[0]!;
        expect(first).toBe('ears-headphones');
        expect(lessonBefore(first, 'full')).toBeNull();
        const r = await open(first);
        await r.run(800, null);
        r.press('feedback.open');
        await r.run(1000, null);
        expect(r.menus).toBe(1);
        expect(r.lessonEvents('leave').map((e) => e.lessonId)).toEqual([first]);
        // the screen closed with Escape or Back (feature.ts onClose)
        expect(await r.host.restartAfterScreen()).toBe(true);
        expect(r.lessonEvents('open').map((e) => e.lessonId)).toEqual([first, first]);
        expect(r.host.runner!.phase).toBe('intro');
        // the lesson runs: its title is said again, and N moves it on (a step or a line follows the key)
        const n = r.sonic.length;
        const said = r.engine.said.length;
        r.press('scene.next');
        await r.run(3000, null);
        expect(r.sonic.slice(n).filter((e) => e.kind === 'key').map((e) => (e as { action: string | null }).action)).toEqual(['next']);
        expect(r.sonic.slice(n).some((e) => e.kind === 'lesson' || e.kind === 'speech')).toBe(true);
        expect(r.engine.said.length).toBeGreaterThan(said);
    }, 300000);

    it('control: a lesson still running under the screen (the lesson menu\'s Lesson list) is not started again when the screen closes', async () => {
        const r = await open('rings-first');
        await r.run(2000, null);
        expect(await r.host.restartAfterScreen()).toBe(false);
        expect(r.lessonEvents('open')).toHaveLength(1);
    }, 300000);
});

// ------------------------------------------------------------------ F5

describe('review F5: the progress panel shows nothing of the live lesson while a replay plays', () => {
    it('drawn from the runner while the lesson runs; hidden the moment a replay takes the engine (PageRuntime.playback), drawn again when it gives it back', async () => {
        const r = await open('rings-first');
        await r.run(1500, null);
        const doc = new FakeDocument();
        const tr = createTranslator('en', engineDicts());
        const panel = new ProgressPanel({ parent: doc.body as unknown as HTMLElement, text: (key, params) => tr.text({ key, ...(params ? { params: params as Record<string, string | number> } : {}) }) });
        const redraws = new Set<() => void>();
        const runtime = new PageRuntime({} as never, r.mode, () => { for (const f of [...redraws]) f(); });
        const off = followProgress(panel, (cb) => {
            const offEvent = r.events.on('sonicEvent', cb);
            redraws.add(cb);
            return () => {
                offEvent();
                redraws.delete(cb);
            };
        }, () => progressNow(r.mode, r.host.runner, (title) => tr.text(title)));
        expect(panel.text.split('\n')[0]).toBe(tr.text(getLesson('rings-first').title));
        runtime.playback(true);
        expect(r.mode.inPlayback).toBe(true);
        expect(panel.text).toBe('');
        expect(progressNow(r.mode, r.host.runner, (t) => tr.text(t))).toBeNull();
        runtime.playback(false);
        expect(panel.text.split('\n')[0]).toBe(tr.text(getLesson('rings-first').title));
        off();
    }, 300000);

    it('control: with no lesson running the panel is hidden too, playing or not', async () => {
        const r = await open('rings-first');
        r.host.close();
        expect(progressNow(r.mode, r.host.runner, (t) => String(t))).toBeNull();
    }, 300000);
});

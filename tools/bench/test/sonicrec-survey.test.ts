// Fly by Sound, step 4 (docs/wip/v12-feedback.md): the spoken survey after a recording (apps/fly/src/sonic-session/survey.ts and
// survey-keys.ts) against scripted keys and a speech that can take time. The dialog itself and the keys of a real page are tried in
// tools/bench/src/sonicrec-local.ts. Every claim has a control that must fail the way the claim says.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DICTS, SURVEYS, SURVEY_CHILD, SURVEY_FIRST, SURVEY_RETURNING, createTranslator, packSession, readPackage, validateSurveyAnswers } from '../../../packages/sonic-fpv/src';
import type { SpeechLine, SurveyAnswers } from '../../../packages/sonic-fpv/src';
import { MIN_GAP_MS, digitsOf, runSurvey, spokenQuestion, surveyFor } from '../../../apps/fly/src/sonic-session/survey';
import type { QuestionView, SurveyDeps, SurveyInput, SurveyView } from '../../../apps/fly/src/sonic-session/survey';
import { captureSurveyKeys, mapSurveyKey } from '../../../apps/fly/src/sonic-session/survey-keys';
import { newProfile, withProfile } from '../../../apps/fly/src/sonic-session/consent';
import type { PilotProfile } from '../../../apps/fly/src/sonic-session/consent';
import { Recorder } from '../../../apps/fly/src/sonic-session/recorder';
import { openSessionStore } from '../../../apps/fly/src/sonic-session/store';
import { VoiceCapture } from '../../../apps/fly/src/sonic-session/voice';
import { FakeDirectory, FakeMic, fakeRuntime, nodeGzip, sampleAt } from './sonicrec-fixtures';

afterEach(() => {
    vi.useRealTimers();
});

const tr = createTranslator('en', DICTS);
const D = (n: number): SurveyInput => ({ kind: 'digit', digit: n });
const SKIP: SurveyInput = { kind: 'skip' };
const DONE: SurveyInput = { kind: 'done' };
const AGAIN: SurveyInput = { kind: 'again' };
const skips = (n: number): SurveyInput[] => Array.from({ length: n }, () => SKIP);

interface Run {
    spoken: SpeechLine[];
    shown: string[];
    answers: SurveyAnswers;
    held: number;
    released: number;
    detached: number;
}

type Entry = SurveyInput | { wait: number };

/**
 * Runs the survey with `script`: the inputs the pilot gives, one after the other every few milliseconds of real time (an entry
 * `{ wait }` is a pause), the first for the offer and then for the questions. The survey's own clock moves `step` ms for every input
 * (default 1000), so no answer is "the same press twice" unless a test makes it so. `sayMs`: how long a line of speech takes.
 */
async function run(script: Entry[], o: { profile?: PilotProfile; sayMs?: number; say?: SurveyDeps['say']; sayLimitMs?: number; offerMs?: number; failView?: boolean; step?: number; idleMs?: number } = {}): Promise<Run> {
    const spoken: SpeechLine[] = [];
    const shown: string[] = [];
    let held = 0;
    let released = 0;
    let detached = 0;
    let handler: ((i: SurveyInput) => void) | null = null;
    let clock = 0;
    const view: SurveyView = {
        offer() {
            shown.push('offer');
        },
        question(q: QuestionView) {
            if (o.failView) throw new Error('the dialog broke');
            shown.push(`q${q.number}:${q.item.id}`);
        },
        listening() {
            shown.push('listening');
        },
        close() {
            shown.push('close');
        }
    };
    const deps: SurveyDeps = {
        say: o.say ?? (async (line) => {
            spoken.push(line);
            if (o.sayMs) await new Promise((r) => setTimeout(r, o.sayMs));
        }),
        text: (line) => tr.text(line),
        keyLabel: (c) => c.replace('Key', ''),
        now: () => clock,
        profile: o.profile ?? newProfile(),
        view,
        listen: (h) => {
            handler = h;
            return () => {
                detached++;
                handler = null;
            };
        },
        holdFlight: () => {
            held++;
            return () => void released++;
        },
        ...(o.sayLimitMs === undefined ? {} : { sayLimitMs: o.sayLimitMs }),
        ...(o.offerMs === undefined ? {} : { offerMs: o.offerMs }),
        ...(o.idleMs === undefined ? {} : { idleMs: o.idleMs })
    };
    const running = runSurvey(deps);
    let at = 0;
    for (const entry of script) {
        if ('wait' in entry) {
            at += entry.wait;
            continue;
        }
        at += 6;
        setTimeout(() => {
            clock += o.step ?? 1000;
            handler?.(entry);
        }, at);
    }
    const answers = await running;
    return { spoken, shown, answers, held, released, detached };
}

const keysOf = (r: Run): string[] => r.spoken.map((l) => l.key);

describe('which survey', () => {
    it('a minor gets the child variant; an adult the first flight\'s until one was answered, then the returning pilot\'s', () => {
        expect(surveyFor({ minor: true, surveysSeen: [] })).toBe(SURVEY_CHILD);
        expect(surveyFor({ minor: true, surveysSeen: [SURVEY_FIRST.id] })).toBe(SURVEY_CHILD);
        expect(surveyFor({ minor: false, surveysSeen: [] })).toBe(SURVEY_FIRST);
        expect(surveyFor({ minor: false, surveysSeen: [SURVEY_FIRST.id] })).toBe(SURVEY_RETURNING);
        expect(surveyFor({ minor: false, surveysSeen: [SURVEY_CHILD.id] })).toBe(SURVEY_FIRST);
    });

    it('the keys a question takes: a scale its own numbers (0 to 9 or 1 to 5), a choice 1 up to its options, an open question none', () => {
        const byId = (id: string) => [...SURVEY_FIRST.items, ...SURVEY_RETURNING.items, ...SURVEY_CHILD.items].find((i) => i.id === id)!;
        expect(digitsOf(byId('fun'))).toEqual([1, 2, 3, 4, 5]);
        expect(digitsOf(byId('mental'))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(digitsOf(byId('up-direction'))).toEqual([1, 2, 3]);
        expect(digitsOf(byId('came-back'))).toEqual([1, 2]);
        expect(digitsOf(byId('helped'))).toEqual([]);
        // every digit a question can take is one key press (the package says so: "answered with ONE key press")
        for (const s of SURVEYS) for (const i of s.items) expect(Math.max(0, ...digitsOf(i)), `${s.id}/${i.id}`).toBeLessThanOrEqual(9);
    });
});

describe('the questions as they are spoken', () => {
    const q = (id: string) => [...SURVEY_FIRST.items, ...SURVEY_CHILD.items].find((i) => i.id === id)!;

    it('number, prompt, then how to answer in the package\'s own "Press n for ..." line; the first question says how to hear it again', () => {
        const d = { text: (l: SpeechLine) => tr.text(l), keyLabel: (c: string) => c.replace('Key', '') };
        const scale = spokenQuestion(q('fun'), 1, 9, d, true);
        expect(scale.map((l) => l.key)).toEqual(['survey.question-of', 'survey.item.fun', 'quiz.option', 'quiz.option', 'survey.repeat-hint']);
        expect(scale.slice(2, 4).map((l) => tr.text(l))).toEqual(['Press 1 for Not at all.', 'Press 5 for A lot.']);
        expect(tr.text(scale[4] as SpeechLine)).toBe('Press Z to hear the question again.');
        const choice = spokenQuestion(q('up-direction'), 5, 9, d, false);
        expect(choice.slice(2).map((l) => tr.text(l))).toEqual(['Press 1 for A higher tone.', 'Press 2 for A lower tone.', 'Press 3 for No idea.']);
        expect(choice.map((l) => l.key)).not.toContain('survey.repeat-hint');
        const open = spokenQuestion(q('helped'), 7, 9, d, false);
        expect(tr.text(open[2] as SpeechLine)).toBe('Say your answer out loud. Press Enter when you are done.');
        expect(tr.text(open[0] as SpeechLine)).toBe('Question 7 of 9.');
    });
});

describe('the survey', () => {
    it('asks all nine questions of the first flight, takes numbers by key and open answers by voice, and says thank you', async () => {
        const r = await run([D(1), D(4), D(7), D(2), D(0), D(1), D(3), DONE, DONE, D(1)]);
        expect(r.answers.surveyId).toBe('first-flight');
        expect(r.answers.skipped).toBe(false);
        expect(r.answers.answers.map((a) => [a.item, a.value, a.via])).toEqual([
            ['fun', 4, 'key'], ['mental', 7, 'key'], ['frustration', 2, 'key'], ['fear', 0, 'key'], ['up-direction', 1, 'key'], ['ears-tired', 3, 'key'], ['helped', null, 'voice'], ['annoyed', null, 'voice'], ['again', 1, 'key']
        ]);
        const ts = r.answers.answers.map((a) => a.t);
        expect(ts.every((t, i) => i === 0 || t >= (ts[i - 1] as number))).toBe(true);
        // an open answer is stamped where its voice window opened (when its question was asked), not when the press that ended it came
        const helped = r.answers.answers[6]!;
        const annoyed = r.answers.answers[7]!;
        expect(helped.t).toBe(r.answers.answers[5]!.t); // the window opened the moment the question before was answered
        expect(annoyed.t).toBeGreaterThan(helped.t);
        expect(validateSurveyAnswers(r.answers).ok).toBe(true);
        expect(keysOf(r)).toContain('survey.offer');
        expect(keysOf(r)).toContain('survey.intro.first');
        expect(keysOf(r)).toContain('survey.thanks');
        expect(r.spoken.find((l) => l.key === 'survey.howto')?.params).toEqual({ skip: 'Escape' });
        expect(r.shown.filter((x) => x.startsWith('q')).length).toBe(9);
        expect(r.shown.filter((x) => x === 'listening').length).toBe(2);
        expect(r.answers.answers[3]!.value).toBe(0); // zero is an answer on the ten-step scales, not a skip
        // the dialog goes and the flight is let go of, and the keys are let go of, once each
        expect(r.shown[r.shown.length - 1]).toBe('close');
        expect([r.held, r.released, r.detached]).toEqual([1, 1, 1]);
    });

    it('says no at the offer (2, Escape, or silence): nothing is asked, the answers say it was skipped', async () => {
        for (const no of [D(2), SKIP, D(7), DONE]) {
            const r = await run([no]);
            expect(r.answers).toMatchObject({ skipped: true, answers: [] });
            expect(keysOf(r)).toContain('survey.skipped');
            expect(r.shown.filter((x) => x.startsWith('q'))).toEqual([]);
        }
        // silence for the whole of the offer's time
        const quiet = await run([], { offerMs: 40 });
        expect(quiet.answers).toMatchObject({ skipped: true, answers: [] });
        // control: a yes asks the questions
        const yes = await run([D(1), ...skips(9)]);
        expect(yes.shown.filter((x) => x.startsWith('q')).length).toBe(9);
    });

    it('any question can be skipped; skipping every one is a skipped survey, skipping all but one is not', async () => {
        const all = await run([D(1), ...skips(9)]);
        expect(all.answers.answers).toHaveLength(9);
        expect(all.answers.answers.every((a) => a.via === 'skip' && a.value === null)).toBe(true);
        expect(all.answers.skipped).toBe(true);
        const nearly = await run([D(1), D(5), ...skips(8)]);
        expect(nearly.answers.skipped).toBe(false);
        expect(nearly.answers.answers[0]).toMatchObject({ item: 'fun', value: 5, via: 'key' });
        expect(nearly.answers.answers.slice(1).every((a) => a.via === 'skip')).toBe(true);
        expect(validateSurveyAnswers(nearly.answers).ok).toBe(true);
    });

    it('a number the question does not take, and Enter on a scale, are not answers: the question waits', async () => {
        const r = await run([D(1), D(7), D(0), DONE, AGAIN, D(3), ...skips(8)]);
        // question 1 is a scale of 1 to 5: 7, 0 and Enter were refused, Z asked it again, 3 was the answer
        expect(r.answers.answers[0]).toMatchObject({ item: 'fun', value: 3, via: 'key' });
        expect(r.shown.filter((x) => x === 'q1:fun').length).toBe(2); // asked, and asked again by Z: not once per refused key
        // control: the same refused keys on a question that takes them would have answered it
        const ok = await run([D(1), D(4), ...skips(8)]);
        expect(ok.answers.answers[0]).toMatchObject({ value: 4 });
    });

    it('a number pressed again in a hurry answers one question, not several (the yes of the offer is not also the answer to question 1)', async () => {
        // 100 ms apart by the survey's clock, MIN_GAP_MS apart is needed: the yes at 100, then 3s at 200, 300 (too soon), 400 (counts), then 2s at 500, 600 (too soon), 700 (counts)
        const hurried = await run([D(1), D(3), D(3), D(3), D(2), D(2), D(2)], { step: 100, idleMs: 120 });
        expect(MIN_GAP_MS).toBe(300);
        expect(hurried.answers.answers.map((a) => [a.item, a.value])).toEqual([['fun', 3], ['mental', 2]]);
        // control: a second apart, every press counts
        const slow = await run([D(1), D(3), D(3), D(3)], { step: 1000, idleMs: 120 });
        expect(slow.answers.answers.map((a) => [a.item, a.value])).toEqual([['fun', 3], ['mental', 3], ['frustration', 3]]);
    });

    it('a pilot who walks away does not leave the recording open: the survey is left as it is after the idle time, and no thank-you is said for it', async () => {
        const some = await run([D(1), D(4)], { idleMs: 80 });
        expect(some.answers.answers.map((a) => [a.item, a.value])).toEqual([['fun', 4]]);
        expect(some.answers.skipped).toBe(false);
        expect(keysOf(some)).not.toContain('survey.thanks');
        expect(some.shown[some.shown.length - 1]).toBe('close');
        expect([some.held, some.released, some.detached]).toEqual([1, 1, 1]);
        // nothing answered at all counts as a skipped survey
        const none = await run([D(1)], { idleMs: 80 });
        expect(none.answers).toMatchObject({ skipped: true, answers: [] });
        // control: with answers all the way the thank-you is said
        const all = await run([D(1), ...skips(9)]);
        expect(keysOf(all)).toContain('survey.thanks');
    });

    it('Z hears the question again without answering it', async () => {
        const r = await run([D(1), AGAIN, D(2), ...skips(8)]);
        expect(r.answers.answers[0]).toMatchObject({ item: 'fun', value: 2 });
        const askedFun = r.spoken.filter((l) => l.key === 'survey.item.fun');
        expect(askedFun).toHaveLength(2);
        // the hint about Z is said with the first question once, not again when it is repeated
        expect(r.spoken.filter((l) => l.key === 'survey.repeat-hint')).toHaveLength(1);
    });

    it('the child variant for a minor: six questions, the Again-Again ones', async () => {
        const profile = withProfile(newProfile(), { minor: true });
        const r = await run([D(1), D(5), D(1), D(2), D(3), D(1), DONE], { profile });
        expect(r.answers.surveyId).toBe('child-again-again');
        expect(r.answers.answers.map((a) => a.item)).toEqual(['child-fun', 'child-again-flying', 'child-again-walls', 'child-again-rings', 'child-scary', 'child-liked-best']);
        expect(keysOf(r)).toContain('survey.intro.child');
        expect(validateSurveyAnswers(r.answers).ok).toBe(true);
    });

    it('the returning pilot gets the ten questions of the returning survey', async () => {
        const profile = withProfile(newProfile(), { surveysSeen: [SURVEY_FIRST.id] });
        const r = await run([D(1), ...skips(10)], { profile });
        expect(r.answers.surveyId).toBe('returning-pilot');
        expect(r.answers.answers).toHaveLength(10);
        expect(keysOf(r)).toContain('survey.intro.returning');
    });

    it('an answer given while a question is still being read cuts the reading and goes on at once', async () => {
        // each line takes 60 ms; the yes comes first, then the answer 150 ms later: during the third line (intro, how to answer, "Question 1 of 9")
        const r = await run([D(1), { wait: 150 }, D(4), { wait: 500 }, ...skips(8)], { sayMs: 60 });
        const k = keysOf(r);
        expect(r.answers.answers[0]).toMatchObject({ item: 'fun', value: 4 });
        // question 1's prompt and the ends of its scale were never said: the answer cut them, and question 2 followed at once
        expect(k).not.toContain('survey.item.fun');
        expect(k).toContain('survey.item.mental');
        expect(k.indexOf('survey.question-of')).toBeLessThan(k.indexOf('survey.item.mental'));
        // control: left to finish, question 1 is said whole (its prompt, both ends, the hint about Z) before question 2
        const patient = await run([D(1), { wait: 700 }, D(4), ...skips(8)], { sayMs: 10 });
        const pk = keysOf(patient);
        const pf = pk.indexOf('survey.item.fun');
        expect(pk.slice(pf, pf + 5)).toEqual(['survey.item.fun', 'quiz.option', 'quiz.option', 'survey.repeat-hint', 'survey.question-of']);
        // and the intro and how to answer come before question 1, in that order
        expect(pk.indexOf('survey.intro.first')).toBeLessThan(pk.indexOf('survey.howto'));
        expect(pk.indexOf('survey.howto')).toBeLessThan(pk.indexOf('survey.item.fun'));
    });

    it('a time-limited open answer: the window closes by itself after the item\'s seconds and the voice stays in the recording', async () => {
        vi.useFakeTimers();
        let handler: ((i: SurveyInput) => void) | null = null;
        let clock = 0;
        const view: SurveyView = { offer: () => undefined, question: () => undefined, listening: () => undefined, close: () => undefined };
        const done = runSurvey({ say: async () => undefined, text: (l) => tr.text(l), keyLabel: (c) => c, now: () => clock, profile: newProfile(), view, listen: (h) => { handler = h; return () => undefined; } });
        const press = async (i: SurveyInput, after = 1000): Promise<void> => {
            clock += after;
            await vi.advanceTimersByTimeAsync(after);
            handler?.(i);
            await vi.advanceTimersByTimeAsync(0);
        };
        await press(D(1));
        for (let i = 0; i < 6; i++) await press(D(1 + (i % 2))); // fun, mental, frustration, fear, up-direction, ears-tired
        // question 7 is open (30 s): nobody presses anything
        clock += 30_000;
        await vi.advanceTimersByTimeAsync(30_000);
        // question 8 is open too
        clock += 30_000;
        await vi.advanceTimersByTimeAsync(30_000);
        await press(D(1));
        const a = await done;
        expect(a.answers[6]).toMatchObject({ item: 'helped', value: null, via: 'voice' });
        expect(a.answers[7]).toMatchObject({ item: 'annoyed', value: null, via: 'voice' });
        expect(a.answers[7]!.t).toBeGreaterThanOrEqual((a.answers[6] as { t: number }).t + 30_000);
        expect(a.skipped).toBe(false);
    });

    it('a survey that breaks keeps what was answered, never rejects, and lets go of the flight and the keys', async () => {
        const broken = await run([D(1)], { failView: true });
        expect(broken.answers.answers).toEqual([]);
        expect([broken.held, broken.released, broken.detached]).toEqual([1, 1, 1]);
        expect(broken.shown[broken.shown.length - 1]).toBe('close');
        // a voice that never answers does not hold the survey up
        const mute = await run([D(1), ...skips(9)], { say: () => new Promise<void>(() => undefined), sayLimitMs: 5 });
        expect(mute.answers.answers).toHaveLength(9);
        // a voice that refuses
        const refusing = await run([D(1), ...skips(9)], { say: () => Promise.reject(new Error('no voice')) });
        expect(refusing.answers.answers).toHaveLength(9);
    });
});

describe('the keys of the survey', () => {
    function target() {
        const added: { type: string; fn: (e: KeyboardEvent) => void; options: unknown }[] = [];
        return {
            added,
            t: {
                addEventListener: (type: string, fn: EventListener, options?: unknown) => void added.push({ type, fn: fn as (e: KeyboardEvent) => void, options }),
                removeEventListener: (type: string, fn: EventListener) => void added.splice(added.findIndex((a) => a.type === type && a.fn === fn), 1)
            }
        };
    }
    const press = (fn: (e: KeyboardEvent) => void, code: string, extra: object = {}): { prevented: boolean; stopped: boolean } => {
        const seen = { prevented: false, stopped: false };
        fn({ code, ctrlKey: false, metaKey: false, altKey: false, repeat: false, preventDefault: () => (seen.prevented = true), stopImmediatePropagation: () => (seen.stopped = true), ...extra } as unknown as KeyboardEvent);
        return seen;
    };

    it('numbers (top row and keypad), Escape, Enter and Z are the inputs; nothing else is', () => {
        expect(['Digit0', 'Digit5', 'Numpad9', 'Escape', 'Enter', 'NumpadEnter', 'KeyZ', 'KeyW', 'Space', 'KeyT', 'ArrowUp'].map(mapSurveyKey)).toEqual([
            D(0), D(5), D(9), SKIP, DONE, DONE, AGAIN, null, null, null, null
        ]);
    });

    it('while it listens every other key is swallowed before the page hears it (a W must not fly the paused flight), in the capture phase', () => {
        const got: SurveyInput[] = [];
        const { added, t } = target();
        const off = captureSurveyKeys((i) => got.push(i), t);
        expect(added).toHaveLength(1);
        expect(added[0]).toMatchObject({ type: 'keydown', options: { capture: true } });
        const fn = added[0]!.fn;
        for (const code of ['KeyW', 'KeyR', 'KeyT', 'Space', 'ArrowLeft']) expect(press(fn, code), code).toEqual({ prevented: true, stopped: true });
        expect(got).toEqual([]);
        expect(press(fn, 'Digit4')).toEqual({ prevented: true, stopped: true });
        expect(press(fn, 'Escape')).toEqual({ prevented: true, stopped: true });
        expect(got).toEqual([D(4), SKIP]);
        // a held key is one press
        press(fn, 'Digit2', { repeat: true });
        expect(got).toHaveLength(2);
        // key releases are not listened for: a stick let go of during the survey must reach the flight's keyboard source
        expect(added.some((a) => a.type === 'keyup')).toBe(false);
        off();
        expect(added).toHaveLength(0);
    });

    it('the browser\'s own shortcuts are left alone (Ctrl+R, Alt+Left, F5, F12)', () => {
        const { added, t } = target();
        captureSurveyKeys(() => undefined, t);
        const fn = added[0]!.fn;
        expect(press(fn, 'KeyR', { ctrlKey: true })).toEqual({ prevented: false, stopped: false });
        expect(press(fn, 'ArrowLeft', { altKey: true })).toEqual({ prevented: false, stopped: false });
        expect(press(fn, 'KeyL', { metaKey: true })).toEqual({ prevented: false, stopped: false });
        expect(press(fn, 'F5')).toEqual({ prevented: false, stopped: false });
        expect(press(fn, 'F12')).toEqual({ prevented: false, stopped: false });
        // control: a plain R is taken
        expect(press(fn, 'KeyR')).toEqual({ prevented: true, stopped: true });
    });
});

describe('the survey inside a recording', () => {
    const ENV = { release: { sha: 'abc1234', sonic: '3959930' }, locale: 'en' as const, userAgent: 'vitest', audio: { sampleRate: 48000, baseLatencyMs: 10, outputLatencyMs: null }, input: 'keyboard' as const, inputName: null, gpu: null, sceneTransform: [1, 0, 0, 0] as const };

    async function recordWithSurvey(script: Entry[], profile = newProfile()) {
        const dir = new FakeDirectory('sonic-sessions');
        const mic = new FakeMic('grant');
        const fake = fakeRuntime('walls-hall');
        let now = 100_000;
        const surveyRuns: SurveyAnswers[] = [];
        const rec = new Recorder({
            nowMs: () => now,
            nowIso: () => new Date(Date.UTC(2026, 10, 7, 10, 0, 0) + (now - 100_000)).toISOString(),
            runtime: () => fake.runtime,
            env: () => ENV,
            stores: { durable: true, create: (id) => openSessionStore(dir, id), open: (id) => openSessionStore(dir, id, false), list: async () => [...dir.dirs.keys()], remove: async (id) => void dir.dirs.delete(id) },
            voice: new VoiceCapture(mic),
            profile: () => profile,
            say: () => undefined,
            keyLabel: (c) => c.replace('Key', ''),
            gzip: nodeGzip,
            flushMs: 15,
            // the survey of this recording, with scripted keys, on the recording's own clock
            survey: async (env) => {
                let handler: ((i: SurveyInput) => void) | null = null;
                const view: SurveyView = { offer: () => undefined, question: () => undefined, listening: () => undefined, close: () => undefined };
                const running = runSurvey({ say: async () => undefined, text: (l) => tr.text(l), keyLabel: (c) => c, now: () => env.now(), profile: env.profile, view, listen: (h) => { handler = h; return () => undefined; } });
                let at = 0;
                for (const entry of script) {
                    if ('wait' in entry) {
                        at += entry.wait;
                        continue;
                    }
                    at += 6;
                    setTimeout(() => {
                        now += 1000;
                        handler?.(entry);
                    }, at);
                }
                const a = await running;
                surveyRuns.push(a);
                return a;
            }
        });
        rec.pressRecord();
        rec.pressRecord();
        const t0 = Date.now();
        while (rec.phase !== 'recording' && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 4));
        for (let i = 0; i < 60; i++) {
            now += 1000 / 60;
            rec.onSample(sampleAt(now + 5000));
        }
        await new Promise((r) => setTimeout(r, 60));
        const done = await rec.stop();
        const parts = await packSession(await openSessionStore(dir, done!.id));
        return { pkg: readPackage(new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer())), surveyRuns, done };
    }

    it('T stops the recording, the survey runs with the voice still recording, and survey.json is in the package: the answers as given, no answer events', async () => {
        const { pkg, surveyRuns } = await recordWithSurvey([D(1), D(4), D(7), D(2), D(0), D(1), D(3), DONE, DONE, D(1)]);
        expect(pkg.problems).toEqual([]);
        expect(pkg.survey).toEqual(surveyRuns[0]);
        expect(pkg.survey?.answers).toHaveLength(9);
        expect(pkg.survey?.answers[0]).toMatchObject({ item: 'fun', value: 4, via: 'key' });
        // the lesson's own `answer` events are the quiz's: a survey answer written there would be called missing by the replay
        expect(pkg.events.filter((e) => e.kind === 'answer')).toEqual([]);
        // the survey's clock is the recording's: every answer lies inside the recording
        const end = Date.parse(pkg.manifest.ended as string) - Date.parse(pkg.manifest.clock.startIso);
        expect(pkg.survey!.answers.every((a) => a.t >= 0 && a.t <= end + 50)).toBe(true);
        expect(pkg.manifest.files.map((f) => f.name)).toContain('survey.json');
    });

    it('a declined survey is a survey.json that says skipped, so the author knows it was offered', async () => {
        const { pkg } = await recordWithSurvey([D(2)]);
        expect(pkg.survey).toMatchObject({ skipped: true, answers: [], surveyId: 'first-flight' });
        expect(pkg.problems).toEqual([]);
    });

    it('a minor\'s recording gets the child survey', async () => {
        const { pkg } = await recordWithSurvey([D(1), D(5), D(1), D(2), D(3), D(1), DONE], withProfile(newProfile(), { minor: true }));
        expect(pkg.survey?.surveyId).toBe('child-again-again');
        expect(pkg.manifest.consent.minor).toBe(true);
    });
});

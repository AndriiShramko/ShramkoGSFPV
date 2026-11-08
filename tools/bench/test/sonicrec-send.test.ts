// Fly by Sound, step 8 (docs/wip/v12-feedback.md): sending a recording from the pilot's side: key U, the helper's button, the voice command,
// what the pilot hears, resuming at the next start (apps/fly/src/sonic-session/send-control.ts, voice-command.ts, transfer-view.ts).
// Node only; the fake server is sonicrec-send-fixtures.ts. The rules under test are the ones that protect the pilot: nothing is asked of the
// server before the pilot's own yes, a yes needs the question to have been heard, a minor's recording without a guardian never leaves, the
// app's own words can never count as a yes, and nothing talks over a recording. Every claim has a control.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SpeechLine } from '../../../packages/sonic-fpv/src';
import { Bus } from '../../../apps/fly/src/app/context';
import type { AppEvents, FlightContext } from '../../../apps/fly/src/app/context';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { newProfile } from '../../../apps/fly/src/sonic-session/consent';
import type { PilotProfile } from '../../../apps/fly/src/sonic-session/consent';
import type { RecorderPhase } from '../../../apps/fly/src/sonic-session/recorder';
import { listSessions } from '../../../apps/fly/src/sonic-session/registry';
import { SendControl } from '../../../apps/fly/src/sonic-session/send-control';
import type { SendNotice } from '../../../apps/fly/src/sonic-session/send-control';
import { channelList, mayListen, sendBlocker, transferLine } from '../../../apps/fly/src/sonic-session/transfer-view';
import { Transfer, readTransfer, writeTransfer } from '../../../apps/fly/src/sonic-session/upload';
import type { TransferProgress, TransferRecord } from '../../../apps/fly/src/sonic-session/upload';
import { VoiceCommands, heardPhrase, normalizeSpeech, splitPhrases } from '../../../apps/fly/src/sonic-session/voice-command';
import type { RecognitionEventLike, RecognitionLike } from '../../../apps/fly/src/sonic-session/voice-command';
import pkgEn from '../../../packages/sonic-fpv/locales/en.json';
import pkgEs from '../../../packages/sonic-fpv/locales/es.json';
import pkgPl from '../../../packages/sonic-fpv/locales/pl.json';
import pkgRu from '../../../packages/sonic-fpv/locales/ru.json';
import recEn from '../../../packages/i18n/locales/fly/sonicrec/en.json';
import recEs from '../../../packages/i18n/locales/fly/sonicrec/es.json';
import recPl from '../../../packages/i18n/locales/fly/sonicrec/pl.json';
import recRu from '../../../packages/i18n/locales/fly/sonicrec/ru.json';
import { FakeDirectory, fakeRuntime, sampleAt } from './sonicrec-fixtures';
import { FakeApi, makeSession, sha256 } from './sonicrec-send-fixtures';
import type { MadeSession } from './sonicrec-send-fixtures';

/** Non-ASCII letters are written as code points: Cyrillic and Polish letters outside the locales fail B18. */
const u = (...cp: number[]): string => String.fromCodePoint(...cp);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(what: string, pred: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
    const t0 = Date.now();
    while (!(await pred())) {
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
        await sleep(5);
    }
}

// ------------------------------------------------------------------ the voice command

describe('what is heard counts only as whole words after the same clean-up on both sides', () => {
    it('case, accents and punctuation do not matter; Cyrillic and Polish letters work', () => {
        expect(normalizeSpeech(`Wy${u(0x15b)}lij TO, autorowi!`)).toBe('wyslij to autorowi');
        expect(normalizeSpeech(`${u(0x41e, 0x442, 0x43f, 0x440, 0x430, 0x432, 0x44c)}  ${u(0x430, 0x432, 0x442, 0x43e, 0x440, 0x443)}.`)).toBe(u(0x43e, 0x442, 0x43f, 0x440, 0x430, 0x432, 0x44c, 0x20, 0x430, 0x432, 0x442, 0x43e, 0x440, 0x443));
        expect(normalizeSpeech('Env' + u(0xed) + 'alo al autor')).toBe('envialo al autor');
        expect(heardPhrase([`please, wy${u(0x15b)}lij to autorowi`], [`Wy${u(0x15b)}lij to autorowi`])).toBe(true);
        expect(heardPhrase(['Send IT to the author!'], ['send it to the author'])).toBe(true);
    });

    it('a word inside another word is not heard; nothing is heard from an empty list or an empty phrase', () => {
        expect(heardPhrase(['unsent items'], ['send'])).toBe(false);
        expect(heardPhrase(['sender'], ['send'])).toBe(false);
        expect(heardPhrase(['yesterday'], ['yes'])).toBe(false);
        expect(heardPhrase(['anything'], [])).toBe(false);
        expect(heardPhrase(['anything'], ['', '  '])).toBe(false);
        expect(heardPhrase([], ['yes'])).toBe(false);
        expect(splitPhrases(' a | b |  | c ')).toEqual(['a', 'b', 'c']);
    });
});

const DICTS = {
    en: { pkg: pkgEn as Record<string, string>, rec: recEn as Record<string, string> },
    es: { pkg: pkgEs as Record<string, string>, rec: recEs as Record<string, string> },
    pl: { pkg: pkgPl as Record<string, string>, rec: recPl as Record<string, string> },
    ru: { pkg: pkgRu as Record<string, string>, rec: recRu as Record<string, string> }
} as const;
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const phrasesOf = (l: (typeof LANGS)[number], kind: 'send' | 'agree'): string[] => splitPhrases(DICTS[l].rec[`sonicrec.voice.phrases.${kind}`] as string);

describe('the app\'s own words can never be taken for the pilot\'s yes', () => {
    // the speaker's echo, or the browser hearing the tail of the app's own speech, must not agree to send a recording for anyone.
    // The lines checked are the ones that can be in the air while the app listens: everything the sending itself says, and the lines
    // spoken just before it starts (the recording's end). The question about STARTING a recording (rec.ask: "Press T to say yes") is
    // not among them: a press of T stops the listening before that line is ever spoken, and a yes to it could not send anything.
    // sonic-core 1eea4d5 added send.none and send.cancelled (said when U finds nothing, and when the question is withdrawn) and the
    // survey's survey.mic-on, survey.howto and survey.howto-voice (said at the end of a recording, before the sending is offered):
    // every one of them is held here as well, by name, so a renamed key cannot drop out of the check unnoticed.
    const AROUND = ['rec.saved', 'rec.stopped', 'rec.off', 'rec.minor', 'help.send', 'survey.mic-on', 'survey.howto', 'survey.howto-voice'];
    const NEW_IN_1EEA4D5 = ['send.none', 'send.cancelled', 'survey.mic-on', 'survey.howto', 'survey.howto-voice'];
    it.each(LANGS)('%s: no word the app says around sending counts as a yes', (l) => {
        const lines = Object.entries(DICTS[l].pkg).filter(([k]) => k.startsWith('send.') || AROUND.includes(k));
        for (const k of NEW_IN_1EEA4D5) expect(lines.map(([key]) => key), `${l}: ${k} is checked`).toContain(k);
        const own = lines.map(([, v]) => v.replace('{key}', 'U').replace('{skip}', 'Escape'));
        expect(own.length).toBeGreaterThan(17);
        const agree = phrasesOf(l, 'agree');
        expect(agree.length).toBeGreaterThanOrEqual(5);
        for (const line of own) expect(heardPhrase([line], agree), line).toBe(false);
    });

    it.each(LANGS)('%s: what the app tells the pilot to say is heard as the send command', (l) => {
        const line = DICTS[l].pkg['send.by-voice'] as string;
        const taught = line.slice(line.indexOf(':') + 1).replace(/[.]/g, '').trim();
        expect(taught.length).toBeGreaterThan(5);
        expect(heardPhrase([taught], phrasesOf(l, 'send')), taught).toBe(true);
        expect(heardPhrase([`${taught}, please`], phrasesOf(l, 'send'))).toBe(true);
    });

    it.each(LANGS)('%s: the send command is not also a yes, and a yes is not also a send command', (l) => {
        for (const p of phrasesOf(l, 'send')) expect(heardPhrase([p], phrasesOf(l, 'agree')), `send phrase "${p}" counts as yes`).toBe(false);
        for (const p of phrasesOf(l, 'agree')) expect(heardPhrase([p], phrasesOf(l, 'send')), `yes phrase "${p}" counts as send`).toBe(false);
    });

    it('control: the check can fail. The words I first listed (the question\'s own) WOULD have been heard in it', () => {
        const q = (l: (typeof LANGS)[number]): string => (DICTS[l].pkg['send.confirm'] as string).replace('{key}', 'U');
        expect(heardPhrase([q('en')], ['agree'])).toBe(true);
        expect(heardPhrase([q('es')], ['de acuerdo'])).toBe(true);
        expect(heardPhrase([q('pl')], ['zgadzasz si' + u(0x119)])).toBe(true);
        expect(heardPhrase([(DICTS.pl.pkg['send.by-voice'] as string)], [`wy${u(0x15b)}lij to`])).toBe(true);
    });

    it('every language has the same keys for the commands, and a recognition language of its own', () => {
        for (const l of LANGS) expect(DICTS[l].rec['sonicrec.voice.lang']).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
        expect(DICTS.en.rec['sonicrec.voice.lang']).toBe('en-US');
        expect(new Set(LANGS.map((l) => DICTS[l].rec['sonicrec.voice.lang'])).size).toBe(4);
    });
});

class FakeRecognition implements RecognitionLike {
    static all: FakeRecognition[] = [];
    lang = '';
    continuous = true;
    interimResults = true;
    maxAlternatives = 1;
    onresult: RecognitionLike['onresult'] = null;
    onerror: RecognitionLike['onerror'] = null;
    onend: RecognitionLike['onend'] = null;
    started = 0;
    aborted = 0;
    failStart = false;
    constructor() {
        FakeRecognition.all.push(this);
    }
    start(): void {
        if (this.failStart) throw new Error('InvalidStateError');
        this.started++;
    }
    stop(): void {
        this.onend?.();
    }
    abort(): void {
        this.aborted++;
        queueMicrotask(() => this.onend?.());
    }
    /** What the pilot says: the alternatives of one result. */
    say(...alternatives: string[]): void {
        const result = Object.assign(
            alternatives.map((transcript) => ({ transcript })),
            { length: alternatives.length }
        );
        const e: RecognitionEventLike = { resultIndex: 0, results: { length: 1, 0: result } };
        this.onresult?.(e);
    }
    /** Silence: the browser ends this listen by itself. */
    silence(): void {
        this.onerror?.({ error: 'no-speech' });
        this.onend?.();
    }
    static last(): FakeRecognition {
        return FakeRecognition.all[FakeRecognition.all.length - 1] as FakeRecognition;
    }
}

const SEND = ['send it to the author', 'send it'];

describe('the voice commands listener', () => {
    afterEach(() => {
        FakeRecognition.all = [];
    });

    it('listens in the pilot\'s language, hears a phrase among the alternatives, and lets go of the microphone', async () => {
        const v = new VoiceCommands({ create: () => new FakeRecognition(), lang: 'pl-PL' });
        const heard = v.listen(SEND, 2000);
        const rec = FakeRecognition.last();
        expect(v.listening).toBe(true);
        expect({ lang: rec.lang, continuous: rec.continuous, interim: rec.interimResults, alternatives: rec.maxAlternatives, started: rec.started }).toEqual({ lang: 'pl-PL', continuous: false, interim: false, alternatives: 3, started: 1 });
        rec.say('send me a flight', 'please send it to the author');
        expect(await heard).toBe(true);
        expect(rec.aborted).toBe(1);
        expect(v.listening).toBe(false);
    });

    it('control: other words are not a command, and the time running out is false and lets go as well', async () => {
        const v = new VoiceCommands({ create: () => new FakeRecognition(), lang: 'en-US' });
        const heard = v.listen(SEND, 60);
        FakeRecognition.last().say('what is the weather', 'send me home');
        expect(await heard).toBe(false);
        expect(FakeRecognition.last().aborted).toBe(1);
    });

    it('a browser that says no (not allowed, no service) ends it at once and is not asked again; silence is listened through', async () => {
        for (const error of ['not-allowed', 'service-not-allowed', 'audio-capture', 'network']) {
            FakeRecognition.all = [];
            const v = new VoiceCommands({ create: () => new FakeRecognition(), lang: 'en-US' });
            const heard = v.listen(SEND, 5000);
            FakeRecognition.last().onerror?.({ error });
            expect(await heard, error).toBe(false);
            expect(FakeRecognition.all).toHaveLength(1);
        }
        FakeRecognition.all = [];
        const v = new VoiceCommands({ create: () => new FakeRecognition(), lang: 'en-US' });
        const heard = v.listen(SEND, 3000);
        FakeRecognition.last().silence();
        await until('a second listen after silence', () => FakeRecognition.all.length === 2);
        FakeRecognition.last().say('send it');
        expect(await heard).toBe(true);
    });

    it('stop() and a second listen both end the first at once; a browser without recognition, or one that cannot start, says false', async () => {
        const v = new VoiceCommands({ create: () => new FakeRecognition(), lang: 'en-US' });
        const first = v.listen(SEND, 5000);
        v.stop();
        expect(await first).toBe(false);
        const second = v.listen(SEND, 5000);
        const third = v.listen(SEND, 5000);
        expect(await second).toBe(false);
        v.stop();
        expect(await third).toBe(false);
        const none = new VoiceCommands({ create: null, lang: 'en-US' });
        expect(none.available).toBe(false);
        expect(await none.listen(SEND, 100)).toBe(false);
        expect(await v.listen([], 100)).toBe(false);
        const broken = new VoiceCommands({
            create: () => {
                const r = new FakeRecognition();
                r.failStart = true;
                return r;
            },
            lang: 'en-US'
        });
        expect(await broken.listen(SEND, 100)).toBe(false);
    });
});

// ------------------------------------------------------------------ the sending control

interface World {
    readonly made: MadeSession;
    readonly api: FakeApi;
    readonly ctl: SendControl;
    readonly lines: SpeechLine[];
    /** the options each line was said with, in the order of `lines` */
    readonly sayWith: ({ readonly interrupt?: boolean } | undefined)[];
    readonly notices: SendNotice[];
    readonly recorder: { phase: RecorderPhase };
    readonly gate: { hold: Promise<void> | null };
    profile: PilotProfile;
    readonly voice: VoiceCommands;
    readonly changes: { n: number };
}

const keys = (w: World): string[] => w.lines.map((l) => l.key);

async function world(o: { minor?: boolean; guardian?: boolean; voiceBytes?: number; askMs?: number; readMs?: number; listenMs?: number; speech?: boolean; api?: FakeApi; made?: MadeSession; noSession?: boolean; say?: (line: SpeechLine, options?: { readonly interrupt?: boolean }) => Promise<void> } = {}): Promise<World> {
    const made = o.made ?? (o.noSession ? await makeSession({ id: 'emptyDummy00000000001' }).then(async (m) => { await m.stores.remove(m.id); return m; }) : await makeSession({ voiceBytes: o.voiceBytes ?? 2500, minor: o.minor === true, guardian: o.guardian === true }));
    const api = o.api ?? new FakeApi();
    const lines: SpeechLine[] = [];
    const sayWith: ({ readonly interrupt?: boolean } | undefined)[] = [];
    const notices: SendNotice[] = [];
    const recorder = { phase: 'idle' as RecorderPhase };
    const gate: { hold: Promise<void> | null } = { hold: null };
    const changes = { n: 0 };
    const voice = new VoiceCommands({ create: () => new FakeRecognition(), lang: 'en-US' });
    const w: World = {
        made,
        api,
        lines,
        sayWith,
        notices,
        recorder,
        gate,
        profile: { ...newProfile(), speechRecognition: o.speech === true },
        voice,
        changes,
        ctl: undefined as unknown as SendControl
    };
    (w as { ctl: SendControl }).ctl = new SendControl({
        stores: made.stores,
        recorder,
        profile: () => w.profile,
        isLocked: async () => false,
        say: async (line, options) => {
            lines.push(line);
            sayWith.push(options);
            if (o.say !== undefined) return o.say(line, options);
            if (gate.hold !== null) await gate.hold;
        },
        keyLabel: (code) => code.replace('Key', ''),
        nowIso: () => '2026-11-07T11:00:00Z',
        voice,
        phrases: (kind) => splitPhrases(DICTS.en.rec[`sonicrec.voice.phrases.${kind}`] as string),
        transfer: { fetch: api.fetch, base: 'http://api.test/api/session', sha256: async (b) => sha256(b), sleep: async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }, random: () => 0.5 },
        onChange: () => changes.n++,
        onNotice: (n) => notices.push(n),
        ...(o.askMs === undefined ? {} : { askMs: o.askMs }),
        ...(o.readMs === undefined ? {} : { readMs: o.readMs }),
        ...(o.listenMs === undefined ? {} : { listenMs: o.listenMs })
    });
    return w;
}

const recordOf = async (w: World, id = w.made.id): Promise<TransferRecord | null> => readTransfer(await w.made.stores.open(id));

describe('key U: the app asks, and only the pilot\'s second press, after hearing the question, sends', () => {
    it('nothing is asked of the server until the second press; then the pilot hears sending, stored and delivered, in that order', async () => {
        const w = await world();
        w.ctl.pressSend();
        await until('the question', () => keys(w).includes('send.confirm'));
        expect(w.lines[0]).toEqual({ key: 'send.confirm', params: { key: 'U' } });
        expect(w.api.calls).toHaveLength(0); // the question alone sends nothing and asks nothing
        expect(w.ctl.asking).toBe(true);
        w.ctl.pressSend();
        await w.ctl.whenIdle();
        await until('delivered', () => keys(w).includes('send.delivered'));
        expect(keys(w)).toEqual(['send.confirm', 'send.sending', 'send.stored', 'send.delivered']);
        expect(w.api.stored()).toHaveLength(1);
        expect(await recordOf(w)).toMatchObject({ consentVia: 'key', consentAt: '2026-11-07T11:00:00Z', delivered: true });
        expect(w.ctl.asking).toBe(false);
    });

    it('a second press while the question is still being read out is not an answer: a key struck twice in a hurry agrees to nothing', async () => {
        const w = await world({ readMs: 800 });
        let release: () => void = () => undefined;
        w.gate.hold = new Promise<void>((resolve) => {
            release = resolve;
        });
        w.ctl.pressSend();
        await until('the question started', () => keys(w).includes('send.confirm'));
        w.ctl.pressSend();
        w.ctl.pressSend();
        await sleep(60);
        expect(w.api.calls).toHaveLength(0);
        expect(w.ctl.asking).toBe(true);
        release(); // the question has been heard
        await sleep(30);
        w.ctl.pressSend(); // now it is a yes
        await w.ctl.whenIdle();
        expect(w.api.stored()).toHaveLength(1);
        expect(keys(w)).toContain('send.sending');
    });

    it('control: a question that never finishes is taken as read after a limit, so a hidden tab cannot lock the pilot out', async () => {
        const w = await world({ readMs: 40 });
        w.gate.hold = new Promise<void>(() => undefined);
        w.ctl.pressSend();
        await until('the question', () => keys(w).includes('send.confirm'));
        await sleep(90);
        w.ctl.pressSend();
        await w.ctl.whenIdle();
        expect(w.api.stored()).toHaveLength(1);
    });

    it('no second press in time: not sent, and the pilot hears so (send.cancelled, v12-int step 2); nothing was asked of the server', async () => {
        const w = await world({ askMs: 60 });
        w.ctl.pressSend();
        await until('cancelled', () => w.notices.includes('cancelled'), 2000);
        expect(keys(w)).toEqual(['send.confirm', 'send.cancelled']);
        expect(w.api.calls).toHaveLength(0);
        expect(w.ctl.asking).toBe(false);
        expect(await recordOf(w)).toBeNull();
        // a press after the time has run out asks again from the start, it is not a late yes
        w.ctl.pressSend();
        await until('asked again', () => keys(w).filter((k) => k === 'send.confirm').length === 2);
        expect(w.api.calls).toHaveLength(0);
    });

    it('while a recording runs U does nothing but say so on screen; with nothing to send it says so on screen and aloud (send.none, v12-int step 2)', async () => {
        const w = await world();
        w.recorder.phase = 'recording';
        w.ctl.pressSend();
        await sleep(30);
        expect(w.notices).toEqual(['busy-recording']);
        expect(w.lines).toHaveLength(0);
        expect(w.api.calls).toHaveLength(0);
        const empty = await world({ noSession: true });
        empty.ctl.pressSend();
        await until('nothing', () => empty.notices.includes('nothing'));
        expect(keys(empty)).toEqual(['send.none']);
        expect(empty.api.calls).toHaveLength(0);
    });

    it('a recording that starts while the question is out cancels the question (and the microphone is the recorder\'s)', async () => {
        const w = await world();
        w.ctl.pressSend();
        await until('the question', () => w.ctl.asking);
        w.recorder.phase = 'asking';
        w.ctl.onRecorderStatus({ phase: 'asking' } as never);
        expect(w.ctl.asking).toBe(false);
        // the recorder speaks now: "not sent" is not said over its question (nothing here speaks while a recording runs)
        expect(keys(w)).toEqual(['send.confirm']);
        w.recorder.phase = 'idle';
        w.ctl.pressSend(); // a fresh question, not the old yes
        await until('asked again', () => keys(w).filter((k) => k === 'send.confirm').length === 2);
        expect(w.api.calls).toHaveLength(0);
    });

    it('a minor whose recording has no guardian\'s confirmation is never sent: the pilot hears why, nothing is asked of the server', async () => {
        const w = await world({ minor: true, guardian: false });
        w.ctl.pressSend();
        await until('refused', () => w.notices.includes('guardian'));
        expect(keys(w)).toEqual(['rec.minor']);
        expect(w.api.calls).toHaveLength(0);
        w.ctl.pressSend();
        await sleep(30);
        expect(w.api.calls).toHaveLength(0);
        // control: the same pilot's recording WITH the guardian's confirmation is asked about, and sent
        const ok = await world({ minor: true, guardian: true });
        ok.ctl.pressSend();
        await until('the question', () => ok.ctl.asking);
        ok.ctl.pressSend();
        await ok.ctl.whenIdle();
        expect(ok.api.stored()).toHaveLength(1);
    });

    it('the profile corrected after the flight holds the recording back: the same pilot is now under 18 without a guardian', async () => {
        const w = await world();
        const entry = (await listSessions(w.made.stores, async () => false))[0];
        expect(entry?.manifest?.consent.minor).toBe(false);
        w.profile = { ...newProfile(), id: entry?.manifest?.pilot.id as string, minor: true, guardianConfirmed: false };
        w.ctl.pressSend();
        await until('refused', () => w.notices.includes('guardian'));
        expect(w.api.calls).toHaveLength(0);
        // control: another pilot's profile (another id) does not hold it back
        w.profile = { ...newProfile(), minor: true, guardianConfirmed: false };
        w.ctl.pressSend();
        await until('the question', () => w.ctl.asking);
    });

    it('a recording already delivered is not sent again: U says it was delivered', async () => {
        const w = await world();
        const store = await w.made.stores.open(w.made.id);
        await new Transfer({ store, pack: async () => new Blob([(await w.made.pack()) as BlobPart]), consent: { at: '2026-11-07T10:00:00Z', via: 'key' }, fetch: w.api.fetch, base: 'http://api.test/api/session', sha256: async (b) => sha256(b), sleep: async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }, random: () => 0.5 }).run();
        const before = w.api.calls.length;
        w.ctl.pressSend();
        await until('already', () => w.notices.includes('already'));
        expect(keys(w)).toEqual(['send.delivered']);
        expect(w.api.calls).toHaveLength(before);
    });

    it('a sending that was agreed to and cut off goes on at U without asking again; the consent in its record is the one that counts', async () => {
        const w = await world({ voiceBytes: 4200 });
        const store = await w.made.stores.open(w.made.id);
        const t = new Transfer({ store, pack: async () => new Blob([(await w.made.pack()) as BlobPart]), consent: { at: '2026-11-07T09:00:00Z', via: 'button' }, fetch: w.api.fetch, base: 'http://api.test/api/session', sha256: async (b) => sha256(b), sleep: async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }, random: () => 0.5 });
        w.api.faults.push((c) => {
            if (c.method === 'POST' && c.path.endsWith('/2')) {
                t.stop();
                return { kind: 'network' };
            }
            return null;
        });
        await t.run();
        w.api.faults.length = 0;
        w.ctl.pressSend();
        await w.ctl.whenIdle();
        expect(keys(w)).not.toContain('send.confirm'); // no new question
        expect(w.api.stored()).toHaveLength(1);
        expect(await recordOf(w)).toMatchObject({ consentVia: 'button', consentAt: '2026-11-07T09:00:00Z', delivered: true });
    });
});

describe('the helper\'s Send button, the same rules', () => {
    it('sends at the click, without a spoken question (the panel showed the consent text and the pilot\'s tick); the way is recorded', async () => {
        const w = await world();
        expect(await w.ctl.sendByHelper(w.made.id)).toBeNull();
        await w.ctl.whenIdle();
        expect(keys(w)).toEqual(['send.sending', 'send.stored', 'send.delivered']);
        expect(await recordOf(w)).toMatchObject({ consentVia: 'button', delivered: true });
    });

    it('control: a minor without a guardian is refused at the button as well, and a recording that runs holds it', async () => {
        const w = await world({ minor: true, guardian: false });
        expect(await w.ctl.sendByHelper(w.made.id)).toBe('guardian');
        expect(w.api.calls).toHaveLength(0);
        const w2 = await world();
        w2.recorder.phase = 'recording';
        expect(await w2.ctl.sendByHelper(w2.made.id)).toBe('busy');
        expect(w2.api.calls).toHaveLength(0);
        expect(await w2.ctl.sendByHelper('nonexistent00000000000')).toBe('busy'); // a recording runs: busy comes first
        w2.recorder.phase = 'idle';
        // a recording that is gone (deleted meanwhile) is nothing to send: the panel says so, and the pilot hears it (send.none)
        expect(await w2.ctl.sendByHelper('nonexistent00000000000')).toBe('nothing');
        expect(keys(w2)).toEqual(['send.none']);
    });

    it('the button taking over a question that is out sends, and the pilot does not hear "not sent" (send.cancelled is only for a question left unanswered)', async () => {
        const w = await world();
        w.ctl.pressSend();
        await until('the question', () => w.ctl.asking);
        expect(await w.ctl.sendByHelper(w.made.id)).toBeNull();
        await w.ctl.whenIdle();
        expect(keys(w)).toEqual(['send.confirm', 'send.sending', 'send.stored', 'send.delivered']);
        expect(w.notices).toContain('cancelled'); // the panel's own line for the question, as before
    });

    it('pressing it twice makes one sending, not two', async () => {
        const w = await world({ voiceBytes: 4200 });
        const a = w.ctl.sendByHelper(w.made.id);
        const b = w.ctl.sendByHelper(w.made.id);
        await Promise.all([a, b]);
        await w.ctl.whenIdle();
        expect(w.api.callsTo(/^POST \/start$/)).toHaveLength(1);
        expect(w.api.stored()).toHaveLength(1);
    });
});

describe('what the pilot hears while it goes on', () => {
    it('a failing connection is said once ("did not work"), a retry at most twice, never a stream of them', async () => {
        const w = await world({ voiceBytes: 4200 });
        let n = 0;
        w.api.faults.push((c) => (c.method === 'POST' && c.path.endsWith('/1') && n++ < 7 ? { kind: 'network' } : null));
        expect(await w.ctl.sendByHelper(w.made.id)).toBeNull();
        await w.ctl.whenIdle();
        const said = keys(w);
        expect(said.filter((k) => k === 'send.failed')).toHaveLength(1);
        expect(said.filter((k) => k === 'send.retry').length).toBeLessThanOrEqual(2);
        expect(said.filter((k) => k === 'send.retry').length).toBeGreaterThanOrEqual(1);
        expect(said[said.length - 1]).toBe('send.delivered');
    });

    it('one channel done and the other failing: the pilot hears which, once; delivered only when both confirm', async () => {
        const w = await world();
        w.api.autoDeliverAfter = null;
        w.api.onStatusPoll = (polls, s) => {
            if (polls === 2) s.channels = { telegram: 'sent', email: 'retrying' };
            if (polls === 4) s.channels = { telegram: 'sent', email: 'retrying' };
            if (polls === 6) s.channels = { telegram: 'sent', email: 'sent' };
        };
        await w.ctl.sendByHelper(w.made.id);
        await w.ctl.whenIdle();
        expect(keys(w)).toEqual(['send.sending', 'send.stored', 'send.partial-telegram', 'send.delivered']);
        // the other way round
        const w2 = await world();
        w2.api.autoDeliverAfter = null;
        w2.api.onStatusPoll = (polls, s) => {
            if (polls === 2) s.channels = { telegram: 'failed', email: 'sent' };
            if (polls === 5) s.channels = { telegram: 'sent', email: 'sent' };
        };
        await w2.ctl.sendByHelper(w2.made.id);
        await w2.ctl.whenIdle();
        expect(keys(w2)).toEqual(['send.sending', 'send.stored', 'send.partial-email', 'send.delivered']);
    });

    it('control: a channel that is only waiting or sending is not reported as trouble', async () => {
        const w = await world();
        w.api.autoDeliverAfter = null;
        w.api.onStatusPoll = (polls, s) => {
            if (polls === 2) s.channels = { telegram: 'sent', email: 'sending' };
            if (polls === 3) s.channels = { telegram: 'sent', email: 'queued' };
            if (polls === 4) s.channels = { telegram: 'sent', email: 'sent' };
        };
        await w.ctl.sendByHelper(w.made.id);
        await w.ctl.whenIdle();
        expect(keys(w).some((k) => k.startsWith('send.partial'))).toBe(false);
    });

    it('nothing is said while a recording runs, and a refused sending is said as such', async () => {
        const w = await world({ voiceBytes: 4200 });
        w.api.onStatusPoll = () => {
            w.recorder.phase = 'recording'; // the pilot started another recording during the delivery
        };
        await w.ctl.sendByHelper(w.made.id);
        await w.ctl.whenIdle();
        expect(keys(w)).toEqual(['send.sending', 'send.stored']); // nothing after the recording began
        // a sending the server will not take
        const big = await world();
        big.api.maxBytes = 50;
        await big.ctl.sendByHelper(big.made.id);
        await big.ctl.whenIdle();
        expect(keys(big)).toEqual(['send.sending', 'send.failed']);
    });
});

describe('at the next start, what was begun goes on, by itself', () => {
    it('a sending that was started and not finished resumes; a delivered one, a blocked one and one never sent do not; once per page', async () => {
        const dir = new FakeDirectory('sonic-sessions');
        const api = new FakeApi();
        const mk = (id: string, at: string) => makeSession({ id, at, voiceBytes: 3200, dir });
        const cut = await mk('resumeCut00000000001', '2026-11-07T10:00:00Z');
        const done = await mk('resumeDone0000000002', '2026-11-07T10:10:00Z');
        const blocked = await mk('resumeBlocked00000003', '2026-11-07T10:20:00Z');
        const never = await mk('resumeNever000000004', '2026-11-07T10:30:00Z');
        const dep = (m: MadeSession, extra = {}) => ({ pack: async () => new Blob([(await m.pack()) as BlobPart]), consent: { at: '2026-11-07T10:40:00Z', via: 'key' as const }, fetch: api.fetch, base: 'http://api.test/api/session', sha256: async (b: Uint8Array) => sha256(b), sleep: async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }, random: () => 0.5, ...extra });
        await new Transfer({ store: await done.stores.open(done.id), ...dep(done) }).run();
        const stopper: { t: Transfer | null } = { t: null };
        api.faults.push((c) => {
            if (c.method === 'POST' && /\/1$/.test(c.path) && stopper.t !== null) {
                stopper.t.stop();
                return { kind: 'network' };
            }
            return null;
        });
        stopper.t = new Transfer({ store: await cut.stores.open(cut.id), ...dep(cut) });
        await stopper.t.run();
        stopper.t = null;
        const bstore = await blocked.stores.open(blocked.id);
        await writeTransfer(bstore, { v: 1, serverId: 'S-20261107-0000000000aa', token: 't', sha256: 'a'.repeat(64), size: 10, chunkBytes: 1000, chunks: 1, consentAt: '2026-11-07T10:00:00Z', consentVia: 'key', startedAt: '2026-11-07T10:00:00Z', stored: false, storedAt: null, delivered: false, deliveredAt: null, channels: null, blocked: 'too-large' });
        const calls0 = api.calls.length;
        const w = await world({ made: cut, api });
        expect(await w.ctl.resume()).toBe(1);
        await w.ctl.whenIdle();
        const mine = api.calls.slice(calls0);
        expect(mine.some((c) => c.path === '/start')).toBe(false); // it went on, it did not begin again
        expect((await recordOf(w, cut.id))?.delivered).toBe(true);
        expect((await recordOf(w, blocked.id))?.blocked).toBe('too-large'); // untouched
        expect(await recordOf(w, never.id)).toBeNull(); // never asked about
        expect(await w.ctl.resume()).toBe(0); // once per page
        // a resumed sending speaks only its outcomes: not "sending", not "did not work"
        expect(keys(w).includes('send.sending')).toBe(false);
        expect(keys(w)).toContain('send.delivered');
    });

    it('a recording whose own consent forbids it is not resumed, whatever a record says', async () => {
        const w = await world({ minor: true, guardian: false });
        await writeTransfer(await w.made.stores.open(w.made.id), { v: 1, serverId: 'S-20261107-0000000000bb', token: 't', sha256: 'b'.repeat(64), size: 10, chunkBytes: 1000, chunks: 1, consentAt: '2026-11-07T10:00:00Z', consentVia: 'key', startedAt: '2026-11-07T10:00:00Z', stored: false, storedAt: null, delivered: false, deliveredAt: null, channels: null, blocked: null });
        expect(await w.ctl.resume()).toBe(0);
        expect(w.api.calls).toHaveLength(0);
    });
});

describe('by voice, only where it was allowed', () => {
    afterEach(() => {
        FakeRecognition.all = [];
    });

    it('after a recording the app says how to send it and how to say it (with the disclosure first), then listens; "send it to the author", then a spoken yes, sends', async () => {
        const w = await world({ speech: true });
        void w.ctl.offerSend(w.made.id);
        await until('listening', () => FakeRecognition.all.length === 1);
        expect(keys(w)).toEqual(['send.ask', 'send.speech-note', 'send.by-voice']); // the disclosure comes before the first listen
        expect(w.lines[0]).toEqual({ key: 'send.ask', params: { key: 'U' } });
        expect(w.api.calls).toHaveLength(0);
        FakeRecognition.last().say('send it to the author');
        await until('the question', () => keys(w).includes('send.confirm'));
        expect(w.api.calls).toHaveLength(0); // a command is a request, not a yes
        await until('listening for the yes', () => FakeRecognition.all.length === 2);
        FakeRecognition.last().say('yes');
        await until('the sending to start', () => w.api.calls.length > 0);
        await w.ctl.whenIdle();
        expect(w.api.stored()).toHaveLength(1);
        expect(await recordOf(w)).toMatchObject({ consentVia: 'voice', delivered: true });
    });

    it('the question can be answered by the key as well, and then the listener lets go', async () => {
        const w = await world({ speech: true });
        w.ctl.pressSend();
        await until('listening for the yes', () => FakeRecognition.all.length === 1);
        const rec = FakeRecognition.last();
        w.ctl.pressSend();
        await w.ctl.whenIdle();
        expect(w.api.stored()).toHaveLength(1);
        expect(await recordOf(w)).toMatchObject({ consentVia: 'key' });
        expect(rec.aborted).toBeGreaterThanOrEqual(1);
    });

    it('control: without the tick nothing is ever listened to; the keys still work', async () => {
        const w = await world({ speech: false });
        await w.ctl.offerSend(w.made.id);
        expect(keys(w)).toEqual(['send.ask']);
        w.ctl.pressSend();
        await until('the question', () => w.ctl.asking);
        await sleep(30);
        expect(FakeRecognition.all).toHaveLength(0);
        w.ctl.pressSend();
        await w.ctl.whenIdle();
        expect(w.api.stored()).toHaveLength(1);
    });

    it('control: a minor without the guardian\'s confirmation is not invited and not listened to, even with the tick set', async () => {
        const w = await world({ speech: true, minor: true, guardian: false });
        await w.ctl.offerSend(w.made.id);
        expect(w.lines).toHaveLength(0);
        expect(FakeRecognition.all).toHaveLength(0);
        const g = await world({ speech: true, minor: true, guardian: true });
        void g.ctl.offerSend(g.made.id);
        await until('listening', () => FakeRecognition.all.length === 1);
    });

    it('a recording that starts stops the listening at once; a spoken yes after that sends nothing', async () => {
        const w = await world({ speech: true });
        void w.ctl.offerSend(w.made.id);
        await until('listening', () => FakeRecognition.all.length === 1);
        const rec = FakeRecognition.last();
        w.recorder.phase = 'asking';
        w.ctl.onRecorderStatus({ phase: 'asking' } as never);
        expect(rec.aborted).toBe(1);
        rec.say('send it to the author');
        await sleep(40);
        expect(w.api.calls).toHaveLength(0);
        expect(keys(w)).not.toContain('send.confirm');
    });

    it('nothing heard in the time: nothing happens and nothing is asked of the server', async () => {
        const w = await world({ speech: true, listenMs: 40 });
        await w.ctl.offerSend(w.made.id);
        await sleep(80);
        expect(w.api.calls).toHaveLength(0);
        expect(keys(w)).not.toContain('send.confirm');
    });

    it('the disclosure is said once per page, not before every listen', async () => {
        const w = await world({ speech: true });
        void w.ctl.offerSend(w.made.id);
        await until('listening', () => FakeRecognition.all.length === 1);
        FakeRecognition.last().say('send it to the author');
        await until('the question', () => keys(w).includes('send.confirm'));
        await until('listening for the yes', () => FakeRecognition.all.length === 2);
        expect(keys(w).filter((k) => k === 'send.speech-note')).toHaveLength(1);
        w.ctl.dispose();
    });
});

describe('transfer-view: the one line the panel shows, and who may be sent', () => {
    const rec = (over: Partial<TransferRecord> = {}): TransferRecord => ({ v: 1, serverId: 'S-20261107-000000000001', token: 't', sha256: 'f'.repeat(64), size: 10, chunkBytes: 5, chunks: 2, consentAt: 'x', consentVia: 'key', startedAt: 'x', stored: false, storedAt: null, delivered: false, deliveredAt: null, channels: null, blocked: null, ...over });
    const live = (over: Partial<TransferProgress>): TransferProgress => ({ stage: 'uploading', chunksDone: 1, chunks: 3, bytes: 10, stored: false, delivered: false, channels: null, problem: null, failures: 0, retryAt: null, serverId: null, ...over });
    const both = { telegram: { status: 'sent', attempts: 1, error: '' }, email: { status: 'sent', attempts: 1, error: '' } };
    const half = { telegram: { status: 'sent', attempts: 1, error: '' }, email: { status: 'retrying', attempts: 2, error: 'smtp-421' } };

    it('says what the server said, in the order of the truth', () => {
        expect(transferLine(null, null)).toEqual({ kind: 'none' });
        expect(transferLine(null, live({ stage: 'preparing' }))).toEqual({ kind: 'working' });
        expect(transferLine(null, live({}))).toEqual({ kind: 'uploading', done: 1, of: 3 });
        expect(transferLine(rec(), live({ stage: 'waiting', problem: 'network', retryAt: 5 }))).toEqual({ kind: 'waiting', problem: 'network', retryAt: 5 });
        const ref = 'S-20261107-000000000001';
        expect(transferLine(rec({ stored: true }), live({ stage: 'stored', stored: true, channels: half }))).toEqual({ kind: 'stored', channels: half, problem: null, ref });
        expect(transferLine(rec({ stored: true }), live({ stage: 'delivered', stored: true, delivered: true, channels: both }))).toEqual({ kind: 'delivered', channels: both, ref });
        expect(transferLine(null, live({ stage: 'delivered', stored: true, delivered: true, channels: both, serverId: 'S-20261107-0000000000ff' }))).toEqual({ kind: 'delivered', channels: both, ref: 'S-20261107-0000000000ff' }); // the live id when there is no record yet
        expect(transferLine(null, live({ stage: 'blocked', problem: 'too-large' }))).toEqual({ kind: 'blocked', reason: 'too-large' });
    });

    it('delivered needs both channels, in the record and in the live progress; one is only "on the server"', () => {
        expect(transferLine(rec({ stored: true, delivered: true, channels: both }), null).kind).toBe('delivered');
        expect(transferLine(rec({ stored: true, delivered: true, channels: half }), null).kind).toBe('stored'); // a record that says delivered with one channel open is not believed
        expect(transferLine(rec({ stored: true, delivered: true, channels: null }), null).kind).toBe('stored');
        expect(transferLine(null, live({ stage: 'delivered', stored: true, delivered: true, channels: half })).kind).toBe('stored');
    });

    it('a failure after the server has it does not turn into "not sent"', () => {
        expect(transferLine(rec({ stored: true }), live({ stage: 'waiting', stored: true, problem: 'network', channels: half }))).toEqual({ kind: 'stored', channels: half, problem: 'network', ref: 'S-20261107-000000000001' });
    });

    it('what the device remembers without a running transfer: interrupted, blocked, stored', () => {
        expect(transferLine(rec(), null)).toEqual({ kind: 'waiting', problem: 'interrupted', retryAt: null });
        expect(transferLine(rec({ blocked: 'gone' }), null)).toEqual({ kind: 'blocked', reason: 'gone' });
        expect(transferLine(rec({ stored: true, channels: half }), live({ stage: 'stopped' })).kind).toBe('stored');
    });

    it('the channels in the server\'s order, a missing one waiting', () => {
        expect(channelList(null)).toEqual([{ name: 'telegram', status: 'queued' }, { name: 'email', status: 'queued' }]);
        expect(channelList({ email: { status: 'sent', attempts: 1, error: '' } })).toEqual([{ name: 'telegram', status: 'queued' }, { name: 'email', status: 'sent' }]);
    });

    it('who may be sent and who may be listened to', async () => {
        const w = await world();
        const [entry] = await listSessions(w.made.stores, async () => false);
        const e = entry as NonNullable<typeof entry>;
        const profile = { ...newProfile() };
        expect(sendBlocker(e, profile)).toBeNull();
        expect(sendBlocker({ ...e, locked: true }, profile)).toBe('locked');
        expect(sendBlocker({ ...e, state: 'unfinished' }, profile)).toBe('unfinished');
        expect(sendBlocker({ ...e, state: 'unreadable', manifest: null }, profile)).toBe('unreadable');
        const manifest = e.manifest as NonNullable<typeof e.manifest>;
        const minorNo = { ...e, manifest: { ...manifest, consent: { ...manifest.consent, minor: true, guardianConfirmed: false } } };
        const minorYes = { ...e, manifest: { ...manifest, consent: { ...manifest.consent, minor: true, guardianConfirmed: true } } };
        expect(sendBlocker(minorNo, profile)).toBe('guardian');
        expect(sendBlocker(minorYes, profile)).toBeNull();
        expect(mayListen(e, { ...profile, speechRecognition: false })).toBe(false);
        expect(mayListen(e, { ...profile, speechRecognition: true })).toBe(true);
        expect(mayListen(minorNo, { ...profile, speechRecognition: true })).toBe(false);
        expect(mayListen(minorYes, { ...profile, speechRecognition: true })).toBe(true);
    });
});

// ------------------------------------------------------------------ the feature in the page

type Mod = typeof import('../../../apps/fly/src/sonic-session/session');
let mod: Mod;

beforeAll(async () => {
    class FakeElement { isContentEditable = false; }
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('HTMLInputElement', class extends FakeElement { type = 'text'; });
    vi.stubGlobal('HTMLTextAreaElement', class extends FakeElement {});
    vi.stubGlobal('HTMLSelectElement', class extends FakeElement {});
    vi.stubGlobal('location', { pathname: '/en/fly/', search: '' });
    vi.stubGlobal('document', { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('addEventListener', () => undefined);
    vi.stubGlobal('removeEventListener', () => undefined);
    mod = await import('../../../apps/fly/src/sonic-session/session');
});

describe('key U in the flight page', () => {
    const press = (router: KeyRouter, code: string, extra: object = {}): string | null =>
        router.route({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, preventDefault() {}, ...extra } as unknown as KeyboardEvent);

    function page(on: boolean) {
        const fake = fakeRuntime('walls-hall');
        const router = new KeyRouter();
        const events = new Bus<AppEvents>();
        const ctx = { keys: router, events, sonic: on ? fake.runtime : undefined, session: { transform: { s: 5, t: [0, 0, 0] } }, controls: { source: 'keyboard', profile: null }, renderer: { isWebGPU: false } } as unknown as FlightContext;
        return { ctx, router, events, fake };
    }

    it('with the sound mode off, U is routed and does nothing: no question, no request, no speech', () => {
        const spy = vi.fn();
        const realFetch = globalThis.fetch;
        globalThis.fetch = spy as unknown as typeof fetch;
        const { ctx, router, fake } = page(false);
        const s = mod.createSonicSession(ctx);
        expect(press(router, 'KeyU')).toBe('sonic.send');
        expect(s.send.asking).toBe(false);
        expect(fake.spoken).toHaveLength(0);
        expect(spy).not.toHaveBeenCalled();
        s.dispose();
        expect(press(router, 'KeyU')).toBeNull();
        globalThis.fetch = realFetch;
    });

    it('with the mode on and a held key: a held U is one press, and with nothing recorded it asks nothing and says so aloud (send.none)', async () => {
        const spy = vi.fn();
        const realFetch = globalThis.fetch;
        globalThis.fetch = spy as unknown as typeof fetch;
        const { ctx, router, fake } = page(true);
        const s = mod.createSonicSession(ctx);
        press(router, 'KeyU', { repeat: true });
        await sleep(30);
        expect(fake.spoken).toHaveLength(0); // the held key is no press
        press(router, 'KeyU');
        await until('send.none', () => fake.spoken.length > 0);
        await sleep(30);
        expect(fake.spoken.map((l) => l.key)).toEqual(['send.none']); // nothing to send: the pilot hears it, the panel (not built here) shows it
        expect(spy).not.toHaveBeenCalled();
        expect(s.send.asking).toBe(false);
        expect(s.recorder.phase).toBe('idle');
        s.dispose();
        globalThis.fetch = realFetch;
    });

    it('a flight sample or event never reaches the sender: ordinary flight is unchanged', () => {
        const { ctx, events } = page(false);
        const s = mod.createSonicSession(ctx);
        events.emit('sonicSample', sampleAt(1000));
        expect(s.send.live().size).toBe(0);
        s.dispose();
    });
});

// v12-int review, finding I2 (the same as the recorder's, tools/bench/test/sonicrec-recorder.test.ts "review I2"): the question of U, and what U
// answers at once, were said behind what the lesson was saying, and the reading limit let a second press agree to the question before it began.
describe('review I2: U\'s question and the lesson\'s speech', () => {
    /** The engine as it speaks with the browser's voice: utterances queue, each takes `unitMs`; a line that interrupts cuts what is queued. */
    function queueingEngine(unitMs: number) {
        let freeAt = 0;
        const rows: { key: string; startedAt: number }[] = [];
        return {
            startOf: (key: string): number | null => rows.find((r) => r.key === key)?.startedAt ?? null,
            say(line: SpeechLine, options?: { readonly interrupt?: boolean }): Promise<void> {
                const now = Date.now();
                if (options?.interrupt === true) freeAt = now;
                const startedAt = Math.max(now, freeAt);
                freeAt = startedAt + unitMs;
                rows.push({ key: line.key, startedAt });
                return new Promise<void>((resolve) => setTimeout(resolve, freeAt - now));
            }
        };
    }

    it('the question, "nothing to send", and where the sending is are said with interrupt: they are the answer to the pilot\'s key', async () => {
        const w = await world();
        w.ctl.pressSend();
        await until('the question', () => keys(w).includes('send.confirm'));
        expect(w.sayWith[keys(w).indexOf('send.confirm')]).toEqual({ interrupt: true });
        w.ctl.pressSend();
        await w.ctl.whenIdle();
        await until('delivered', () => keys(w).includes('send.delivered'));
        // the lines the sending says by itself as it goes are not answers to a key: they queue behind whatever is being said
        for (const k of ['send.sending', 'send.stored']) expect(w.sayWith[keys(w).indexOf(k)], k).toBeUndefined();
        // U again: nothing is going on and it was delivered; the answer is at once
        const n = w.lines.length;
        w.ctl.pressSend();
        await until('the answer', () => w.lines.length > n);
        expect(w.lines[n]?.key).toBe('send.delivered');
        expect(w.sayWith[n]).toEqual({ interrupt: true });
        const none = await world({ noSession: true });
        none.ctl.pressSend();
        await until('send.none', () => keys(none).includes('send.none'));
        expect(none.sayWith[0]).toEqual({ interrupt: true });
    });

    it('with the lesson talking the question is heard at once, so a press after the reading limit agrees to a question the pilot has heard', async () => {
        const engine = queueingEngine(40);
        for (let i = 0; i < 6; i++) void engine.say({ key: `lesson.line${i}` }); // 240 ms of speech ahead of the question
        const w = await world({ readMs: 90, askMs: 2000, say: (line, options) => engine.say(line, options) });
        w.ctl.pressSend();
        await until('the question', () => keys(w).includes('send.confirm'));
        await sleep(120); // longer than the reading limit, shorter than what the lesson has queued
        const begun = engine.startOf('send.confirm');
        w.ctl.pressSend(); // an impatient second press
        expect(begun !== null && begun <= Date.now()).toBe(true);
        await w.ctl.whenIdle();
        expect(w.api.stored()).toHaveLength(1);
    });

    it('control: said the old way (no interrupt) the question waits behind the lesson and the same second press agrees to it before it has begun', async () => {
        const engine = queueingEngine(40);
        for (let i = 0; i < 6; i++) void engine.say({ key: `lesson.line${i}` });
        const w = await world({ readMs: 90, askMs: 2000, say: (line) => engine.say(line) });
        const pressed = Date.now();
        w.ctl.pressSend();
        await until('the question', () => keys(w).includes('send.confirm'));
        await sleep(120);
        const startsAfter = (engine.startOf('send.confirm') ?? Infinity) - pressed;
        w.ctl.pressSend();
        expect(startsAfter).toBeGreaterThan(200);
        await w.ctl.whenIdle();
        expect(w.api.stored()).toHaveLength(1); // agreed to while it was still queued
    });
});

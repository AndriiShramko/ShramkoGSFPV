// Sending a recording to the author, from the pilot's side (docs/wip/v12-plan.md section 4.3 step 8; spec sections 8 and 10 of the sound
// package). upload.ts moves the bytes; this decides WHEN, and says what is happening in the package's own words:
//
//   U (sonic.send)     first press: the app asks (send.confirm: "Do you agree to send the recording, with your voice, to the author?
//                      Press U to agree."); a second press, after the question has been read out, is the pilot's separate confirmation and
//                      the upload starts. Nothing is sent, and nothing is asked of the server, before that second press.
//   the helper's Send  the panel shows the consent text and a tick for the pilot's agreement; the button starts it (same rules).
//   voice              "send it to the author" (and "yes" to the question), by the browser's speech recognition, only when it was allowed.
//   after a recording  "Press U to send this flight to the author" (send.ask), and for a pilot who allowed voice commands, the way to say it.
//   at the next start  a transfer that was started and not finished goes on by itself: its consent was given, its token is in upload.json.
//
// Privacy is decided here before any byte leaves: a recording whose own consent says under 18 without a guardian's confirmation is never
// sent (the server refuses it as well, and keeps nothing). While a recording runs, nothing here listens or speaks.
import type { SessionManifest, SpeechLine } from '@shramko/sonic-fpv';
import type { RecorderPhase, RecorderStatus, SessionStores } from './recorder';
import type { PilotProfile } from './consent';
import { listSessions, packageOf } from './registry';
import type { SessionEntry } from './registry';
import { mayListen, sendBlocker } from './transfer-view';
import type { SendBlocker } from './transfer-view';
import { Transfer, allConfirmed } from './upload';
import type { ConsentVia, TransferDeps, TransferProgress, TransferStage } from './upload';
import type { VoiceCommands } from './voice-command';

/** What the panel is told in words (its own dictionary: sonicrec.send.notice.<code>). */
export type SendNotice = 'nothing' | 'busy-recording' | 'asked' | 'cancelled' | 'guardian' | 'unfinished' | 'unreadable' | 'locked' | 'other-tab' | 'already' | 'started' | 'resumed';

export interface SendControlDeps {
    readonly stores: SessionStores;
    readonly recorder: { readonly phase: RecorderPhase };
    profile(): PilotProfile;
    isLocked(id: string): Promise<boolean>;
    /** a spoken line; resolves when it has been said (at once where there is no voice) */
    say(line: SpeechLine, options?: { readonly interrupt?: boolean }): Promise<void>;
    keyLabel(code: string): string;
    nowIso(): string;
    /** the voice-command listener; null or unavailable: keys and buttons only */
    readonly voice?: VoiceCommands | null;
    /** the words that mean "send it" and "yes" in the pilot's language (the dictionary's) */
    phrases(kind: 'send' | 'agree'): readonly string[];
    /** how a transfer reaches the server and the clock (the page's own; a test passes fakes) */
    readonly transfer?: Partial<TransferDeps>;
    /** the right to send one recording across tabs: null when another tab holds it (platform.ts holdSendLock) */
    holdSendLock?(id: string): Promise<(() => void) | null>;
    /** a running transfer's progress changed, or one ended: the panel redraws */
    onChange?(): void;
    onNotice?(notice: SendNotice): void;
    /** how long the question waits for the second press, ms (default 30 000) */
    readonly askMs?: number;
    /** the longest the app waits for its own question to be read out before it takes a press as the answer, ms (default 20 000) */
    readonly readMs?: number;
    /** how long a voice command is listened for, ms (default 20 000) */
    readonly listenMs?: number;
}

interface Confirming {
    readonly id: string;
    /** the question has been read out: only now is a press an answer */
    ready: boolean;
    timer: ReturnType<typeof setTimeout> | null;
}

interface Run {
    readonly transfer: Transfer;
    progress: TransferProgress;
    readonly foreground: boolean;
    readonly said: Set<string>;
    lastStage: TransferStage | null;
    retriesSpoken: number;
    readonly done: Promise<void>;
}

const DEFAULT_ASK_MS = 30_000;
const DEFAULT_READ_MS = 20_000;
const DEFAULT_LISTEN_MS = 20_000;
const U_KEY = 'KeyU';

function factsOf(m: SessionManifest): NonNullable<TransferDeps['facts']> {
    return { packageId: m.id, ...(m.lesson === null ? {} : { lesson: m.lesson.id }), minor: m.consent.minor, voice: m.consent.voice, release: m.app.release };
}

export class SendControl {
    private confirming: Confirming | null = null;
    private deciding = false;
    private readonly runs = new Map<string, Run>();
    /** starts that are under way (reading the folder, taking the lock): a transfer is registered only after them, so they are counted too */
    private readonly pending = new Set<Promise<unknown>>();
    /** ids whose start has been called and has not yet registered a run: a second call for the same id must not start a second upload */
    private readonly starting = new Set<string>();
    private noteSaid = false;
    private resumed = false;
    private disposed = false;

    constructor(private readonly deps: SendControlDeps) {}

    /** The progress of every transfer running in this page, by local session id. */
    live(): ReadonlyMap<string, TransferProgress> {
        return new Map([...this.runs].map(([id, r]) => [id, r.progress]));
    }

    /** True while the question is out and a press of U would be taken as the answer. */
    get asking(): boolean {
        return this.confirming !== null;
    }

    /** Resolves when no transfer of this page is starting or running any more. */
    async whenIdle(): Promise<void> {
        while (this.pending.size > 0 || this.runs.size > 0) await Promise.all([...this.pending, ...[...this.runs.values()].map((r) => r.done)]);
    }

    private track<T>(p: Promise<T>): Promise<T> {
        this.pending.add(p);
        const forget = (): void => void this.pending.delete(p);
        p.then(forget, forget);
        return p;
    }

    private notice(n: SendNotice): void {
        try {
            this.deps.onNotice?.(n);
        } catch {
            // the panel's trouble is not the sending's
        }
    }

    private changed(): void {
        try {
            this.deps.onChange?.();
        } catch {
            // the panel's trouble is not the sending's
        }
    }

    private sayLine(key: string, params?: Record<string, string | number>): Promise<void> {
        return this.deps.say(params === undefined ? { key } : { key, params }).catch(() => undefined);
    }

    private idle(): boolean {
        return this.deps.recorder.phase === 'idle';
    }

    // ------------------------------------------------------------------ the key

    /** Key U: ask, then (a second press, after the question was read out) send. Call it straight from the key press. */
    pressSend(): void {
        if (this.disposed) return;
        if (!this.idle()) {
            this.notice('busy-recording');
            return;
        }
        if (this.confirming !== null) {
            this.answerYes('key');
            return;
        }
        if (this.deciding) return;
        this.track(this.ask());
    }

    /** The recorder began a recording (or asks for one): nothing is listened for or asked about sending while it runs. */
    onRecorderStatus(s: RecorderStatus): void {
        if (s.phase === 'idle') return;
        this.deps.voice?.stop();
        this.cancelAsk('recording');
    }

    private async pickTarget(): Promise<SessionEntry | null> {
        const entries = await listSessions(this.deps.stores, this.deps.isLocked);
        const finished = entries.filter((e) => e.state === 'finished');
        return finished.find((e) => e.transfer?.delivered !== true) ?? finished[0] ?? null;
    }

    private async entry(id: string): Promise<SessionEntry | null> {
        return (await listSessions(this.deps.stores, this.deps.isLocked)).find((e) => e.id === id) ?? null;
    }

    private async ask(): Promise<void> {
        this.deciding = true;
        try {
            const entry = await this.pickTarget();
            if (this.disposed) return;
            if (entry === null) {
                // nothing to send: said aloud too (the package's send.none), or a pilot who cannot see the panel hears nothing at all
                void this.sayLine('send.none');
                return this.notice('nothing');
            }
            const run = this.runs.get(entry.id);
            if (run !== undefined) {
                // already going: U says where it is, and tries again at once when it is waiting
                this.report(run);
                run.transfer.retryNow();
                return;
            }
            if (entry.transfer?.delivered === true && allConfirmed(entry.transfer.channels)) {
                void this.sayLine('send.delivered');
                return this.notice('already');
            }
            const blocker = sendBlocker(entry, this.deps.profile());
            if (blocker !== null) return this.refuse(blocker);
            // a send that was agreed to before and was cut off goes on without asking again: the pilot's consent is in its record
            if (entry.transfer !== null && entry.transfer.blocked === null) {
                this.track(this.start(entry.id, null, true));
                return;
            }
            await this.openQuestion(entry);
        } finally {
            this.deciding = false;
        }
    }

    private refuse(blocker: SendBlocker): void {
        if (blocker === 'guardian') void this.sayLine('rec.minor');
        this.notice(blocker);
    }

    /** Asks the question and waits for the pilot's yes (a key, the helper's button, or a spoken yes). */
    private async openQuestion(entry: SessionEntry): Promise<void> {
        const question: Confirming = { id: entry.id, ready: false, timer: null };
        this.confirming = question;
        this.notice('asked');
        this.changed();
        question.timer = setTimeout(() => this.cancelAsk('unanswered'), this.deps.askMs ?? DEFAULT_ASK_MS);
        // the question is read out in full before a press counts: a key struck twice in a hurry must not agree to something unheard
        const read = this.sayLine('send.confirm', { key: this.deps.keyLabel(U_KEY) });
        let limit: ReturnType<typeof setTimeout> | null = null;
        await Promise.race([read, new Promise<void>((resolve) => { limit = setTimeout(resolve, this.deps.readMs ?? DEFAULT_READ_MS); })]);
        if (limit !== null) clearTimeout(limit);
        if (this.confirming !== question) return;
        question.ready = true;
        if (this.canListen(entry)) {
            await this.ensureNote();
            if (this.confirming !== question) return;
            if (await this.deps.voice?.listen(this.deps.phrases('agree'), this.deps.askMs ?? DEFAULT_ASK_MS)) {
                if (this.confirming === question && this.idle()) this.answerYes('voice');
            }
        }
    }

    /**
     * The question is withdrawn. A question nobody answered in its time (the question says only how to agree, so letting it run out
     * is how a pilot declines) is answered aloud with the package's send.cancelled ("Not sent. Your flight stays on this device."): the
     * pilot was asked and hears what came of it. Withdrawn because a recording started (the recorder is speaking now, and nothing here
     * speaks while a recording runs), because the helper's button took over (the sending starts and says so) or because the page goes:
     * nothing is said. The panel says so on screen in every case.
     */
    private cancelAsk(why: 'unanswered' | 'recording' | 'helper' | 'closing'): void {
        const c = this.confirming;
        if (c === null) return;
        if (c.timer !== null) clearTimeout(c.timer);
        this.confirming = null;
        this.deps.voice?.stop();
        if (why === 'unanswered' && this.idle()) void this.sayLine('send.cancelled');
        this.notice('cancelled');
        this.changed();
    }

    private answerYes(via: ConsentVia): void {
        const c = this.confirming;
        if (c === null || !c.ready) return; // still being read out: a press now is not an answer
        if (c.timer !== null) clearTimeout(c.timer);
        this.confirming = null;
        this.deps.voice?.stop();
        this.track(this.start(c.id, { at: this.deps.nowIso(), via }, true));
    }

    // ------------------------------------------------------------------ the helper's button

    /**
     * The helper's Send button, after the panel showed the consent text and the tick for the pilot's agreement was set. Returns the reason
     * when the recording cannot be sent, null when the sending started.
     */
    async sendByHelper(id: string): Promise<SendBlocker | 'busy' | 'nothing' | null> {
        if (this.disposed) return 'busy';
        if (!this.idle()) {
            this.notice('busy-recording');
            return 'busy';
        }
        const entry = await this.entry(id);
        if (entry === null) {
            // the recording is gone (deleted here or in another tab): there is nothing to send, and the pilot hears so as well
            void this.sayLine('send.none');
            return 'nothing';
        }
        const run = this.runs.get(id);
        if (run !== undefined) {
            run.transfer.retryNow();
            return null;
        }
        const blocker = sendBlocker(entry, this.deps.profile());
        if (blocker !== null) {
            this.refuse(blocker);
            return blocker;
        }
        this.cancelAsk('helper');
        await this.track(this.start(id, { at: this.deps.nowIso(), via: 'button' }, true));
        return null;
    }

    /** The helper's Try again on a recording that waits or was blocked: now. */
    retry(id: string): void {
        const run = this.runs.get(id);
        if (run !== undefined) run.transfer.retryNow();
    }

    // ------------------------------------------------------------------ after a recording, and at the next start

    /** A recording has just ended: the pilot is told how to send it, and a pilot who allowed voice commands how to say it. */
    async offerSend(id: string): Promise<void> {
        if (this.disposed || !this.idle()) return;
        const entry = await this.entry(id);
        if (entry === null || sendBlocker(entry, this.deps.profile()) !== null || this.runs.has(id)) return; // the minor's case was spoken at the start
        await this.sayLine('send.ask', { key: this.deps.keyLabel(U_KEY) });
        if (!this.canListen(entry) || this.confirming !== null) return;
        await this.ensureNote();
        await this.sayLine('send.by-voice');
        if (!this.idle()) return;
        const heard = await this.deps.voice?.listen(this.deps.phrases('send'), this.deps.listenMs ?? DEFAULT_LISTEN_MS);
        if (heard === true && this.idle() && this.confirming === null && !this.deciding && !this.runs.has(id)) await this.ask();
    }

    private canListen(entry: SessionEntry): boolean {
        return this.deps.voice?.available === true && mayListen(entry, this.deps.profile());
    }

    /** The browser's speech recognition sends audio to its maker: said before the first listen of a page (the dictionary's send.speech-note). */
    private async ensureNote(): Promise<void> {
        if (this.noteSaid) return;
        this.noteSaid = true;
        await this.sayLine('send.speech-note');
    }

    /** At the start of the sound mode: transfers that were started and not finished go on (once per page). */
    async resume(): Promise<number> {
        if (this.resumed || this.disposed) return 0;
        this.resumed = true;
        let entries: SessionEntry[];
        try {
            entries = await listSessions(this.deps.stores, this.deps.isLocked);
        } catch {
            return 0;
        }
        const waiting = entries.filter((e) => e.state === 'finished' && !e.locked && e.transfer !== null && e.transfer.blocked === null && !(e.transfer.delivered && allConfirmed(e.transfer.channels)) && sendBlocker(e, this.deps.profile()) === null);
        for (const e of waiting) this.track(this.start(e.id, null, false));
        if (waiting.length > 0) this.notice('resumed');
        return waiting.length;
    }

    // ------------------------------------------------------------------ the transfer

    /**
     * Starts the transfer of one recording. `consent`: the pilot's confirmation just given; null for a transfer whose confirmation is in
     * its record. `foreground`: the pilot or the helper started it just now (a resumed one speaks only its outcomes).
     */
    private async start(id: string, consent: { at: string; via: ConsentVia } | null, foreground: boolean): Promise<void> {
        // set before the first await: two calls for one recording in the same breath are one sending
        if (this.starting.has(id)) return;
        this.starting.add(id);
        try {
            await this.begin(id, consent, foreground);
        } catch {
            // the folder could not be read: nothing was started, and the recording is where it was
            this.notice('unreadable');
        } finally {
            this.starting.delete(id);
        }
    }

    private async begin(id: string, consent: { at: string; via: ConsentVia } | null, foreground: boolean): Promise<void> {
        if (this.runs.has(id) || this.disposed) return;
        const entry = await this.entry(id);
        if (entry === null || entry.manifest === null) return;
        const blocker = sendBlocker(entry, this.deps.profile());
        if (blocker !== null) return this.refuse(blocker);
        const release = (await this.deps.holdSendLock?.(id)) ?? (() => undefined);
        if (release === null) return this.notice('other-tab');
        if (this.runs.has(id) || this.disposed) {
            release();
            return;
        }
        const store = await this.deps.stores.open(id);
        let run: Run | null = null;
        const transfer = new Transfer({
            store,
            pack: () => packageOf(this.deps.stores, id),
            ...(consent === null ? {} : { consent }),
            facts: factsOf(entry.manifest),
            ...this.deps.transfer,
            onProgress: (p) => {
                if (run === null) return;
                run.progress = p;
                this.announce(run, p);
                this.changed();
            }
        });
        let finished: () => void = () => undefined;
        const done = new Promise<void>((resolve) => {
            finished = resolve;
        });
        run = { transfer, progress: transfer.progress(), foreground, said: new Set(), lastStage: null, retriesSpoken: 0, done };
        this.runs.set(id, run);
        this.notice(consent === null ? 'resumed' : 'started');
        if (foreground && this.idle()) void this.sayLine('send.sending');
        this.changed();
        void transfer
            .run()
            .catch(() => undefined)
            .finally(() => {
                release();
                this.runs.delete(id);
                finished();
                this.changed();
            });
    }

    /** U on a transfer that is going: where it is, in the package's words. */
    private report(run: Run): void {
        const p = run.progress;
        if (p.stage === 'delivered') void this.sayLine('send.delivered');
        else if (p.stage === 'stored') void this.sayLine('send.stored');
        else if (p.stage === 'waiting' || p.stage === 'blocked') void this.sayLine('send.failed');
        else void this.sayLine('send.sending');
    }

    /** What the pilot hears as the transfer goes on. Never while a recording runs; a resumed transfer is quiet until it has an outcome. */
    private announce(run: Run, p: TransferProgress): void {
        const prev = run.lastStage;
        run.lastStage = p.stage;
        if (!this.idle()) return;
        const once = (key: string, line: string, params?: Record<string, string | number>): void => {
            if (run.said.has(key)) return;
            run.said.add(key);
            void this.sayLine(line, params);
        };
        switch (p.stage) {
            case 'waiting':
                // one "did not work" per streak of failures (the count only goes back to nothing when something worked), and only
                // for what the server does not have yet
                if (!p.stored && p.failures === 1 && prev !== 'waiting' && run.foreground) void this.sayLine('send.failed');
                break;
            case 'preparing':
            case 'starting':
            case 'uploading':
            case 'finishing':
                if (prev === 'waiting' && run.retriesSpoken < 2 && run.foreground) {
                    run.retriesSpoken++;
                    void this.sayLine('send.retry');
                }
                break;
            case 'stored': {
                once('stored', 'send.stored');
                const telegram = p.channels?.telegram?.status;
                const email = p.channels?.email?.status;
                const ok = (s: string | undefined): boolean => s === 'sent' || s === 'link';
                const trouble = (s: string | undefined): boolean => s === 'retrying' || s === 'failed';
                if (ok(telegram) && trouble(email)) once('partial-telegram', 'send.partial-telegram');
                if (ok(email) && trouble(telegram)) once('partial-email', 'send.partial-email');
                break;
            }
            case 'delivered':
                once('delivered', 'send.delivered');
                break;
            case 'blocked':
                if (p.problem === 'consent-guardian') void this.sayLine('rec.minor');
                else once('failed', 'send.failed');
                break;
            case 'stopped':
                break;
        }
    }

    dispose(): void {
        this.disposed = true;
        this.cancelAsk('closing');
        this.deps.voice?.stop();
        for (const run of this.runs.values()) run.transfer.stop();
    }
}

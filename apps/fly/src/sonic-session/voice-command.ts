// Voice commands by the browser's speech recognition (docs/wip/v12-plan.md section 4.3 step 8 and section 8 item 3; spec section 8 of the
// sound package: "Sending can be done by a helper, by a key, or by voice ('send it to the author'), using the browser's speech recognition,
// which is disclosed because it sends audio to the browser vendor. Keys remain the default.")
//
// What keeps it honest:
//   - it is OFF unless the profile allows it (consent.ts `speechRecognition`: ticked by the helper or the pilot; never for a minor whose
//     guardian's consent is not confirmed); nothing in this file starts listening by itself, the sending control asks for each listen;
//   - it listens for a short time, only when the control says so (never while a recording runs, and only after the app has finished its
//     own line, so it does not hear itself), and stops at the first match or at the end of the time;
//   - the words it waits for are the dictionaries' (sonicrec.voice.phrases.*), never typed here: it matches whole words after the same
//     normalisation on both sides (case, accents and punctuation do not matter);
//   - the audio goes to the browser's maker: that is said aloud (the package's send.speech-note) before the first listen of a page, and
//     is on the panel next to the tick. Chrome's recognition is a network service: this code cannot know where the audio goes beyond that.
export interface RecognitionResultLike {
    readonly length: number;
    readonly [index: number]: { readonly transcript: string } | undefined;
}

export interface RecognitionEventLike {
    readonly resultIndex: number;
    readonly results: { readonly length: number; readonly [index: number]: RecognitionResultLike | undefined };
}

/** The part of SpeechRecognition (webkitSpeechRecognition) that is used, so a test can stand in for the browser. */
export interface RecognitionLike {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((e: RecognitionEventLike) => void) | null;
    onerror: ((e: { readonly error: string }) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}

/** The browser's recognition, or null when it has none (Firefox, an old Safari). */
export function browserRecognizer(): (() => RecognitionLike) | null {
    const w = globalThis as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    return typeof Ctor === 'function' ? () => new Ctor() : null;
}

/** Lower case, accents and marks dropped, everything that is not a letter or a digit turned into one space. */
export function normalizeSpeech(text: string): string {
    return text
        .normalize('NFD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/** Did any alternative contain any of the phrases as whole words? */
export function heardPhrase(alternatives: readonly string[], phrases: readonly string[]): boolean {
    const wanted = phrases.map(normalizeSpeech).filter((p) => p !== '');
    if (wanted.length === 0) return false;
    return alternatives.some((a) => {
        const said = ` ${normalizeSpeech(a)} `;
        return wanted.some((p) => said.includes(` ${p} `));
    });
}

/** The phrases of a dictionary line: alternatives separated by a vertical bar. */
export function splitPhrases(line: string): string[] {
    return line.split('|').map((p) => p.trim()).filter((p) => p !== '');
}

export interface VoiceCommandDeps {
    /** makes a recognition (browserRecognizer()); null where the browser has none */
    readonly create: (() => RecognitionLike) | null;
    /** the language of the recognition, BCP 47 (from the dictionary: en-US, es-ES, pl-PL, ru-RU) */
    readonly lang: string;
}

export class VoiceCommands {
    private current: { readonly rec: RecognitionLike; readonly end: (heard: boolean) => void } | null = null;

    constructor(private readonly deps: VoiceCommandDeps) {}

    get available(): boolean {
        return this.deps.create !== null;
    }

    get listening(): boolean {
        return this.current !== null;
    }

    /**
     * Listens for up to `ms` for any of `phrases`. Resolves true when one was heard; false when the time ran out, when the browser refused
     * (no permission, no service), when it cannot listen at all, or when stop() was called (or another listen began). Never throws.
     */
    listen(phrases: readonly string[], ms: number): Promise<boolean> {
        this.stop();
        const create = this.deps.create;
        if (create === null || phrases.length === 0) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
            let over = false;
            let rec: RecognitionLike | null = null;
            const timer = setTimeout(() => finish(false), ms);
            const finish = (heard: boolean): void => {
                if (over) return;
                over = true;
                clearTimeout(timer);
                if (this.current?.end === finish) this.current = null;
                try {
                    rec?.abort();
                } catch {
                    // already over
                }
                resolve(heard);
            };
            const begin = (): void => {
                if (over) return;
                try {
                    rec = create();
                    rec.lang = this.deps.lang;
                    rec.continuous = false;
                    rec.interimResults = false;
                    rec.maxAlternatives = 3;
                    rec.onresult = (e): void => {
                        const said: string[] = [];
                        for (let i = e.resultIndex; i < e.results.length; i++) {
                            const result = e.results[i];
                            for (let k = 0; result !== undefined && k < result.length; k++) {
                                const alt = result[k];
                                if (alt !== undefined) said.push(alt.transcript);
                            }
                        }
                        if (heardPhrase(said, phrases)) finish(true);
                    };
                    rec.onerror = (e): void => {
                        // the browser says no (not allowed, no service, no microphone): asking again would only repeat it. Silence and
                        // an aborted session are the ordinary end of one listen; the next one starts below
                        if (e.error !== 'no-speech' && e.error !== 'aborted') finish(false);
                    };
                    rec.onend = (): void => {
                        // a recognition ends by itself after some silence: the time is not over, so listen again
                        if (!over) setTimeout(begin, 50);
                    };
                    this.current = { rec, end: finish };
                    rec.start();
                } catch {
                    finish(false);
                }
            };
            begin();
        });
    }

    /** Stops listening at once (the listen in progress resolves false). */
    stop(): void {
        const c = this.current;
        this.current = null;
        if (c !== null) c.end(false);
    }
}

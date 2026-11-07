// Fly by Sound, the independent review of lane v12-feedback (docs/wip/v12-feedback-review.md): what each finding of the review is held to in
// Node. The browser side of the same findings is tools/bench/src/sonicrec-review.ts. Every claim has a control that fails the way the claim says.
import { describe, expect, it } from 'vitest';
import en from '../../../packages/i18n/locales/fly/sonicrec/en.json';
import es from '../../../packages/i18n/locales/fly/sonicrec/es.json';
import pl from '../../../packages/i18n/locales/fly/sonicrec/pl.json';
import ru from '../../../packages/i18n/locales/fly/sonicrec/ru.json';
import siteEn from '../../../packages/i18n/locales/site/en.json';
import siteEs from '../../../packages/i18n/locales/site/es.json';
import sitePl from '../../../packages/i18n/locales/site/pl.json';
import siteRu from '../../../packages/i18n/locales/site/ru.json';
import { readFileSync } from 'node:fs';
import { setText } from '../../../apps/fly/src/sonic-session/format';
import { REASON_PARAMS, RegistryError, reasonOf } from '../../../apps/fly/src/sonic-session/reasons';

const DICTS: Record<string, Record<string, string>> = { en, es, pl, ru };

describe('F2: nothing that moves every second is in a live region of the helper\'s panel', () => {
    it('the status sentences carry no clock and no counter, in any language (the numbers have a sentence of their own)', () => {
        for (const [lang, d] of Object.entries(DICTS)) {
            const live = Object.entries(d).filter(([k]) => k.startsWith('sonicrec.status.'));
            expect(live.length, lang).toBeGreaterThanOrEqual(6);
            for (const [k, v] of live) expect(v, `${lang} ${k}`).not.toMatch(/\{(time|frames|size)\}/);
            expect(d['sonicrec.clock'], lang).toMatch(/\{time\}/);
            expect(d['sonicrec.clock'], lang).toMatch(/\{frames\}/);
        }
        // control: the sentence as the lane first wrote it fails the same check
        expect('Recording: {time}. Flight frames: {frames}.').toMatch(/\{(time|frames|size)\}/);
    });

    it('setText writes only a text that is different (a text node written again is read out again by a screen reader)', () => {
        const writes: string[] = [];
        let text: string | null = '';
        const el = {
            get textContent(): string | null {
                return text;
            },
            set textContent(v: string | null) {
                writes.push(String(v));
                text = v;
            }
        };
        setText(el, 'a');
        setText(el, 'a');
        setText(el, 'a');
        setText(el, 'b');
        setText(el, 'b');
        expect(writes).toEqual(['a', 'b']);
        // control: a plain assignment writes every time
        const plain = { n: 0, set textContent(_v: string) { this.n++; } };
        for (let i = 0; i < 5; i++) plain.textContent = 'a';
        expect(plain.n).toBe(5);
    });
});

describe('F3: the pilot is not told that recording stopped while the microphone still listens', () => {
    const first = (d: unknown): string => (d as { privacy: { sections: { id?: string; p: string[] }[] } }).privacy.sections.find((x) => x.id === 'fly-by-sound')?.p[0] ?? '';

    it('the privacy text says the microphone stays on while the survey after a recording is asked, in all four languages', () => {
        expect(first(siteEn)).toMatch(/microphone stays on while the survey is asked/);
        expect(first(siteEs)).toMatch(/micr\u00f3fono sigue encendido mientras se hace la encuesta/);
        expect(first(sitePl)).toMatch(/Mikrofon pozostaje w\u0142\u0105czony, dop\u00f3ki trwa ankieta/);
        expect(first(siteRu)).toMatch(/\u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d \u043e\u0441\u0442\u0430\u0451\u0442\u0441\u044f \u0432\u043a\u043b\u044e\u0447\u0451\u043d\u043d\u044b\u043c, \u043f\u043e\u043a\u0430 \u0438\u0434\u0451\u0442 \u043e\u043f\u0440\u043e\u0441/);
        // control: the text as the lane first wrote it did not say so
        expect('It also notes your language, audio settings, the type and name of the input device').not.toMatch(/microphone stays on/);
    });
});

describe('F5: a recorder problem the helper reads is a sentence of the dictionaries, in the language of the page', () => {
    // every code the recorder reports (recorder.ts RecorderError) and the details it gives the sentence
    const CODES: Record<string, string[]> = {
        'mode-off': [],
        'storage-low': ['free', 'need'],
        'voice-start': ['reason'],
        'voice-write': ['reason'],
        'voice-stop': ['reason'],
        store: ['reason'],
        survey: ['reason'],
        finish: ['reason'],
        generic: ['reason']
    };

    it('every code has its sentence in en, es, pl and ru, naming exactly the details the recorder gives it', () => {
        for (const [lang, d] of Object.entries(DICTS)) {
            for (const [code, params] of Object.entries(CODES)) {
                const text = d[`sonicrec.error.${code}`];
                expect(text, `${lang} sonicrec.error.${code}`).toBeTypeOf('string');
                const named = [...(text as string).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
                expect(named, `${lang} sonicrec.error.${code}`).toEqual([...params].sort());
            }
        }
        // control: a code the recorder does not have is not in the dictionaries (a typo would show a key, not a sentence)
        expect(en['sonicrec.error.no-such-code' as keyof typeof en]).toBeUndefined();
    });
});

describe('F5b (v12-int step 9): what the panel says when keeping, saving or deleting fails is a sentence of the dictionaries, in the language of the page', () => {
    const SENTENCE_CODES = Object.keys(REASON_PARAMS);

    it('every reason has its sentence in en, es, pl and ru, naming exactly the details the registry gives it', () => {
        expect(SENTENCE_CODES.sort()).toEqual(['cannot-pack', 'locked', 'other', 'recover']);
        for (const [lang, d] of Object.entries(DICTS)) {
            for (const code of SENTENCE_CODES) {
                const text = d[`sonicrec.reason.${code}`];
                expect(text, `${lang} sonicrec.reason.${code}`).toBeTypeOf('string');
                const named = [...(text as string).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
                expect(named, `${lang} sonicrec.reason.${code}`).toEqual([...REASON_PARAMS[code as keyof typeof REASON_PARAMS]].sort());
            }
            // the three actions say which one failed, and name the reason (the old single "Could not save: {reason}" said "save" for a delete too)
            for (const action of ['save', 'delete', 'keep']) expect((d[`sonicrec.msg.failed.${action}`] as string).match(/\{(\w+)\}/g), `${lang} ${action}`).toEqual(['{reason}']);
            expect(d['sonicrec.msg.failed'], lang).toBeUndefined();
            expect(d['sonicrec.save.type'], `${lang} sonicrec.save.type`).toBeTypeOf('string');
        }
        // the other languages are not the English text copied (the sentences are the agent's translations, read by no native speaker)
        for (const lang of ['es', 'pl', 'ru']) {
            for (const code of SENTENCE_CODES) expect(DICTS[lang]![`sonicrec.reason.${code}`], `${lang} ${code}`).not.toBe(en[`sonicrec.reason.${code}` as keyof typeof en]);
            for (const action of ['save', 'delete', 'keep']) expect(DICTS[lang]![`sonicrec.msg.failed.${action}`], `${lang} ${action}`).not.toBe(en[`sonicrec.msg.failed.${action}` as keyof typeof en]);
            expect(DICTS[lang]!['sonicrec.save.type'], lang).not.toBe(en['sonicrec.save.type']);
        }
        // control: a code the registry does not have is not in the dictionaries
        expect(en['sonicrec.reason.no-such-code' as keyof typeof en]).toBeUndefined();
    });

    it('a registry error is said by its code, anything else as the technical detail of a general sentence', () => {
        expect(reasonOf(new RegistryError('locked'))).toEqual({ key: 'sonicrec.reason.locked', params: {} });
        expect(reasonOf(new RegistryError('recover'))).toEqual({ key: 'sonicrec.reason.recover', params: {} });
        // the package's own diagnostic is English only: it stays in the error (for the console), the sentence of the page's language names no detail
        const damaged = new RegistryError('cannot-pack', 'voice.webm is 10 bytes, the manifest says 2000');
        expect(reasonOf(damaged)).toEqual({ key: 'sonicrec.reason.cannot-pack', params: {} });
        expect(damaged.detail).toBe('voice.webm is 10 bytes, the manifest says 2000');
        expect(reasonOf(new RegistryError('cannot-pack'))).toEqual({ key: 'sonicrec.reason.cannot-pack', params: {} });
        expect(reasonOf(new DOMException('The object can not be found here.', 'NotFoundError'))).toEqual({ key: 'sonicrec.reason.other', params: { detail: 'The object can not be found here.' } });
        expect(reasonOf('plain text')).toEqual({ key: 'sonicrec.reason.other', params: { detail: 'plain text' } });
        // control: the old way, the exception's own message as the reason, is the very text that was English in every language
        expect(new Error('another tab is recording this session').message).toMatch(/^another tab/);
    });

    it('the panel and the registry hold no sentence of their own: no raw message in a failure line, no description in the save dialog', () => {
        const src = (f: string): string => readFileSync(new URL(`../../../apps/fly/src/sonic-session/${f}`, import.meta.url), 'utf8');
        const panel = src('panel.ts');
        expect(panel).not.toMatch(/sonicrec\.msg\.failed['"]/); // the one key that said "save" for everything
        expect(panel).not.toMatch(/reason: (err|e) instanceof Error/); // a message of an exception put into a sentence as it came
        expect((panel.match(/why\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
        expect(src('registry.ts')).not.toMatch(/throw new Error\(/); // codes (RegistryError), not sentences
        expect(src('save.ts')).not.toMatch(/description: '/); // the label comes from the caller
        // control: the line as it was does match the rule
        expect("say(t('sonicrec.msg.failed', { reason: err instanceof Error ? err.message : String(err) }));").toMatch(/reason: (err|e) instanceof Error/);
    });
});

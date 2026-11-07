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
import { setText } from '../../../apps/fly/src/sonic-session/format';

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

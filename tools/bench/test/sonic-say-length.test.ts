// Train 4, lane tutor-say S3 (decision 7 of the brief, after the first outside feedback "too much information at once"): every
// host line a lesson or the start screen says is short. The lane's keys of the fly/sonic dictionary (sonic.say.*, sonic.start.*,
// sonic.guide.*, sonic.progress.*, sonic.hp.*), in all four languages: at most two sentences, about twelve words a sentence (the cap:
// 14 in English, 18 in Spanish, Polish and Russian, whose words are shorter or need more of them), no step counter, no praise.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const LOCALES = ['en', 'es', 'pl', 'ru'] as const;
const CAP: Record<(typeof LOCALES)[number], number> = { en: 14, es: 18, pl: 18, ru: 18 };
const MINE = /^sonic\.(say|start|guide|progress|hp)\./;
/**
 * The two lines of keys are lists, not prompts: one sentence a key by the key-name rule of lane sonic-hints ("Next, key N." is heard
 * exactly by the four voices; sonic-hints.test.ts KEY_RULE), said once a visit and then only on key K (S2 (a)). Every other line counts.
 */
const KEY_LISTS = new Set(['sonic.say.lessonKeys', 'sonic.say.lessonKeysFree']);
/**
 * The graphics card lines are not a lesson's or the start screen's: a helper hears them once at the page's start, and their wording (why
 * the switch is worth it and how to make it, the note's button named) is the owner's of 2026-11-14 (sonic-gpuhint.test.ts holds it).
 */
const HELPER_LINES = new Set(['sonic.say.gpuHint', 'sonic.say.gpuHintAgain', 'sonic.say.gpuSoftware', 'sonic.say.gpuSoftwareAgain']);

const dict = (l: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../../packages/i18n/locales/fly/sonic/${l}.json`, import.meta.url), 'utf8')) as Record<string, string>;

/** The sentences of a line: split after . ! ? (a placeholder such as {title} is one word). */
export function sentences(text: string): string[] {
    return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

const words = (s: string): number => s.split(/\s+/).filter((w) => /[\p{L}\p{N}{]/u.test(w)).length;

/** What is wrong with one line, or [] (exported for the negative control below). */
export function faults(text: string, cap: number): string[] {
    const out: string[] = [];
    const ss = sentences(text);
    if (ss.length > 2) out.push(`${ss.length} sentences`);
    for (const s of ss) if (words(s) > cap) out.push(`${words(s)} words: "${s}"`);
    if (/\bstep\s*\{?\w*\}?\s+of\b/i.test(text) || /\{n\}\s*\/\s*\{total\}/.test(text)) out.push('a step counter');
    if (/!/.test(text) || /\b(great|well done|excellent|perfect|awesome|amazing|fantastic|good job)\b/i.test(text)) out.push('praise');
    return out;
}

describe('tutor-say S3: the host lines of a lesson and the start screen are short', () => {
    it('the rule fires: a long line, three sentences, a step counter and praise are caught (negative control of the checker)', () => {
        expect(faults('One. Two. Three.', 14)).toContain('3 sentences');
        expect(faults('Press this key and then that key and then the other key to go on now please.', 14)[0]).toMatch(/^17 words/);
        expect(faults('Step {n} of {total}.', 14)).toContain('a step counter');
        expect(faults('Great, you did it!', 14)).toContain('praise');
        expect(faults('Fly to the ring.', 14)).toEqual([]);
    });

    it('the same keys in all four languages', () => {
        const en = Object.keys(dict('en')).filter((k) => MINE.test(k)).sort();
        for (const l of LOCALES) expect(Object.keys(dict(l)).filter((k) => MINE.test(k)).sort(), l).toEqual(en);
    });

    for (const l of LOCALES) {
        it(`${l}: every line at most two sentences of at most ${CAP[l]} words, no step counter, no praise`, () => {
            const d = dict(l);
            const bad = Object.entries(d).filter(([k]) => MINE.test(k) && !KEY_LISTS.has(k) && !HELPER_LINES.has(k)).map(([k, v]) => [k, faults(v, CAP[l])] as const).filter(([, f]) => f.length > 0).map(([k, f]) => `${k}: ${f.join('; ')}`);
            expect(bad).toEqual([]);
        });
    }
});

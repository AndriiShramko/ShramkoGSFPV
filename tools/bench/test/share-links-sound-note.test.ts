// Lane n-share, the independent review: the Share of a flight BY SOUND (sonic/feature.ts ctx.sonicShare, mode-keys.ts shareLesson)
// over a course never saved. The link opens the scan alone (flight-link.ts: 'unsaved' never travels); the brief's Decision 2 asks
// that the pilot is told so in one line ("never a silent other course"). The pause menu's Share panel said it (share-note); the sound
// mode's Share, the one the owner uses in a flight by sound, said only "the link is copied". Negative control: on the lane's head
// before the review, shareLesson ignores the note and feature.ts passes none.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpeechLine } from '@shramko/sonic-fpv';
import { shareLesson } from '../../../apps/fly/src/sonic/mode-keys';
import { courseOfFlight, shareNoteKey } from '../../../apps/fly/src/share/flight-link';

const REPO = join(__dirname, '../../..');
const URL_ = 'https://example.test/fly/?sonic=fly&scene=887f27aa&sz=1';

async function said(note: SpeechLine | null): Promise<string[]> {
    const lines: string[] = [];
    await shareLesson({ url: URL_, via: 'key', lesson: null, copyKeys: 'Control and C', copy: async () => true, field: () => undefined, say: async (l) => void lines.push(l.key), note });
    return lines;
}

describe('the sound mode Share over a course never saved says the course stays behind', () => {
    it('the note is said after the link line', async () => {
        expect(await said({ key: 'sonic.link.unsaved' })).toEqual(['sonic.say.linkCopiedStart', 'sonic.link.unsaved']);
        expect(await said(null)).toEqual(['sonic.say.linkCopiedStart']);
    });

    it('a hand-built course in a flight by sound is unsaved, and feature.ts passes the note for it', () => {
        expect(shareNoteKey(courseOfFlight({ source: 'new', track: { id: 'mine', version: 1 } }, ''))).not.toBeNull();
        const feature = readFileSync(join(REPO, 'apps/fly/src/sonic/feature.ts'), 'utf8');
        expect(feature).toMatch(/note: shareNoteKey\(course\) \? \{ key: 'sonic\.link\.unsaved' \} : null/);
    });

    it('the line is in all four languages', () => {
        for (const l of ['en', 'es', 'pl', 'ru']) {
            const d = JSON.parse(readFileSync(join(REPO, `packages/i18n/locales/fly/sonic/${l}.json`), 'utf8')) as Record<string, string>;
            expect(d['sonic.link.unsaved'], l).toMatch(/\S{3}/);
        }
    });
});

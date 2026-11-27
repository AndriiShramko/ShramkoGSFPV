// Lane sr-quiet: a blind tester's report (JAWS, e-mail of 2026-11-20). (1) The screen reader read "12.6 V 8.1 s" every second: the
// HUD's corners are inside the page's live region #ui and change ten times a second. They are aria-hidden now (ui/hud.ts), so are
// the F3 lines and the REC time. (2) He did not know which keys change the height: K says the flying keys first, and the start
// screen of Fly by Sound has them as a plain list (key-hints.ts FLY_HELP), in all four languages.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLY_HELP } from '../../../apps/fly/src/sonic/key-hints';
import { keyHelpLines } from '../../../apps/fly/src/sonic/mode-keys';
import { GAME_KEYS } from '../../../apps/fly/src/play/keys';
import { MODE_PREFS } from '../../../apps/fly/src/sonic/mode';

const ROOT = join(__dirname, '../../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

describe('sr-quiet: the HUD is not read every second', () => {
    it('the OSD corners, the F3 lines and the REC time are aria-hidden', () => {
        const hud = read('apps/fly/src/ui/hud.ts');
        for (const c of ['tl', 'tr', 'bl', 'br']) expect(hud).toContain(`private ${c} = h('div', { class: 'osd ${c}', 'aria-hidden': 'true' });`);
        for (const id of ['latency-line', 'input-line', 'link-hint', 'detail-line', 'drawing-line']) expect(hud).toContain(`'data-testid': '${id}', 'aria-hidden': 'true'`);
        expect(hud).toMatch(/acroLine = h\('div', \{[^}]*'aria-hidden': 'true'/);
        expect(read('apps/fly/src/app/builtin/cinema.ts')).toContain(`h('span', { class: 'rec-dot-time', 'aria-hidden': 'true' })`);
    });
});

describe('sr-quiet: the flying keys are told', () => {
    it('K says the flying keys right after its intro, before the mode keys', () => {
        const lines = keyHelpLines(() => 'X');
        expect(lines.slice(0, 1 + FLY_HELP.length).map((l) => l.key)).toEqual(['help.intro', ...FLY_HELP]);
    });

    it('the mode flies the game scheme the lines describe (Space up, Shift down)', () => {
        expect(MODE_PREFS['input.play']).toBe('easy');
        expect(GAME_KEYS).toContainEqual({ code: 'Space', axis: 'lift', dir: 1 });
        expect(GAME_KEYS).toContainEqual({ code: 'ShiftLeft', axis: 'lift', dir: -1 });
    });

    it('every line and the list heading exist in en, es, pl, ru', () => {
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const d = JSON.parse(read(`packages/i18n/locales/fly/sonic/${lang}.json`)) as Record<string, string>;
            for (const k of [...FLY_HELP, 'sonic.keysList.heading', 'sonic.keysList.more']) expect(d[k], `${lang} ${k}`).toBeTruthy();
        }
    });

    it('the start screen shows the list as text, not as a stop of the spoken list', () => {
        const s = read('apps/fly/src/sonic/start-screen.ts');
        expect(s).toContain("'data-testid': 'sonic-keys-list'");
        expect(s).toContain('this.keysList(), ...lists');
    });
});

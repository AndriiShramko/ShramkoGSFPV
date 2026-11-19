// Lane menu4 (docs/wip/menu4.md; the owner's three kinds of new pilot): the first-visit question in
// "Before you fly" and what each answer stores. The notice asks "Have you flown FPV before?" with three
// answers; each accepts the notice and names a menu level; `warning-ok` stays on "Show me everything".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { fakeDocument, FakeElement } from './helpers/fake-dom';
import { SCHEMA } from '../../../packages/prefs/src';

type PanelsMod = typeof import('../../../apps/fly/src/ui/panels');
let P: PanelsMod;

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/en/fly/', href: 'http://127.0.0.1/en/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', fakeDocument());
    vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    P = await import('../../../apps/fly/src/ui/panels');
});

function ask(): { root: FakeElement; answers: string[] } {
    const root = new FakeElement('div');
    const answers: string[] = [];
    P.warningModal(root as unknown as HTMLElement, (level) => answers.push(level));
    return { root, answers };
}

describe('Before you fly asks how much the pilot has flown', () => {
    it('shows the question and three answers in the order never, sim, everything, each with its hint', () => {
        const { root } = ask();
        expect(root.textContent).toContain('Have you flown FPV before?');
        const buttons = root.querySelectorAll('button.level-answer');
        expect(buttons.map((b) => b.getAttribute('data-level'))).toEqual(['first', 'sim', 'expert']);
        expect(buttons[0]!.textContent).toContain('Never. Keep it simple');
        expect(buttons[0]!.classList.contains('primary')).toBe(true);
        expect(buttons[1]!.textContent).toContain('Yes, in other simulators or for real');
        expect(buttons[2]!.textContent).toContain('Show me everything');
        for (const b of buttons) expect(b.querySelector('span.level-hint')?.textContent.length ?? 0).toBeGreaterThan(10);
        expect(root.textContent).toContain('Settings, Display, Menu');
    });

    it('each answer closes the notice and gives its level; warning-ok is Show me everything', () => {
        for (const [action, level] of [['warning-first', 'first'], ['warning-sim', 'sim'], ['warning-ok', 'expert']] as const) {
            const { root, answers } = ask();
            root.querySelector(`button[data-action=${action}]`)!.click();
            expect(answers).toEqual([level]);
            expect(root.querySelector('button.level-answer')).toBe(null);
        }
    });

    it('the answers are the levels of the setting the boot stores', () => {
        const def = SCHEMA.byId.get('ui.menuLevel');
        expect(def && def.type === 'enum' ? [...def.options] : []).toEqual(P.LEVEL_ANSWERS.map((a) => a.level));
        const boot = readFileSync(join(__dirname, '../../../apps/fly/src/app/boot.ts'), 'utf8');
        expect(boot).toMatch(/warningModal\(ui, \(level\) => \{[^\n]*prefs\.set\('ui\.menuLevel', level\)/);
    });
});

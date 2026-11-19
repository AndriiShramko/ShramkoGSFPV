// Review of lane edit4b: an open question (parts/life-ask.ts) or the top bar's Course menu takes its own keys. The editor's
// keydown listener was added on window before theirs, so it ran first: Esc on the open menu said "Esc again leaves without
// saving" (a second Esc on the question then left the editor and dropped the unsaved gates), Delete on the question deleted
// the selected gate, Enter on a focused item ran Save. Page proof: tools/bench/scripts/edit4b-probe.mjs step 12.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyRoute } from '../../../apps/fly/src/course/editor/keys';

const root = join(__dirname, '..', '..', '..');

describe('edit4b review: the editor keys wait while a question or a menu is open', () => {
    const canvas = { typing: false, inWindow: false, onButton: false };
    const onAsk = { typing: false, inWindow: false, onButton: true, overlay: true };

    it('Esc, Delete, Ctrl+Z and Enter pass to the open question or menu', () => {
        expect(keyRoute({ code: 'Escape' }, onAsk)).toBe('pass');
        expect(keyRoute({ code: 'Delete' }, onAsk)).toBe('pass');
        expect(keyRoute({ code: 'KeyZ', ctrlKey: true }, onAsk)).toBe('pass');
        expect(keyRoute({ code: 'Enter' }, onAsk)).toBe('pass');
    });

    it('without one the editor keeps its keys', () => {
        expect(keyRoute({ code: 'Escape' }, canvas)).toBe('edit');
        expect(keyRoute({ code: 'Delete' }, canvas)).toBe('edit');
        expect(keyRoute({ code: 'Escape' }, { ...canvas, overlay: false })).toBe('edit');
    });

    it('the hub asks the question and the Course menu before it routes a key', () => {
        const src = readFileSync(join(root, 'apps/fly/src/app/builtin/course.ts'), 'utf8');
        expect(src).toMatch(/const overlay = askOpen\(\) \|\| top\?\.menuOpen\(\) === true;/);
        expect(src).toMatch(/keyRoute\(e, \{[^}]*overlay \}\)/);
        const bar = readFileSync(join(root, 'apps/fly/src/course/editor/top-bar.ts'), 'utf8');
        expect(bar).toMatch(/menuOpen\(\): boolean \{\s*return this\.openMenu !== null;/);
    });
});

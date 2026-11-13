// Lane tracks, stage F1-finish: the editor's paint of the gates (the selected one told apart, a failing one red), voting only after a
// completed lap (tracks-plan 2.9), the body of an admin's version saved from the editor, and the four languages of the new texts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adminVersionBody, badGates, editPaints, lappedIds, mayVote } from '../../../apps/fly/src/course/editor/rules';
import { bestKey } from '../../../apps/fly/src/course/link';

const REPO = join(__dirname, '..', '..', '..');
const ids = ['g1', 'g2', 'g3', 'g4'];

describe('editor paint', () => {
    it('paints the selected gate apart from the rest and nothing red without problems', () => {
        expect(editPaints(ids, 2, [])).toEqual(['later', 'later', 'selected', 'later']);
    });
    it('paints a failing gate red, and both ends of a leg in a wall; the start is no gate', () => {
        const probs = [
            { code: 'gate-wall' as const, gate: 'g1', freeM: 0.1 },
            { code: 'leg-wall' as const, from: 'g3', to: 'g4', freeM: 0.2 },
            { code: 'start-wall' as const, freeM: 0.1 },
            { code: 'leg-wall' as const, from: 'start', to: 'g1', freeM: 0.2 }
        ];
        expect([...badGates(probs, ids)].sort()).toEqual([0, 2, 3]);
        expect(editPaints(ids, 2, probs)).toEqual(['bad', 'later', 'selected-bad', 'bad']);
        expect(editPaints(ids, 1, [{ code: 'outside', gate: 'g2' }, { code: 'gate-direction', gate: 'g4', deg: 50 }])).toEqual(['later', 'selected-bad', 'later', 'bad']);
    });
});

describe('voting after a lap', () => {
    const track = { id: '887f27aa-0000abcd', version: 2, scene: { id: '887f27aa', version: 1 }, transform: [1, 0, 0, 0], generator: null };
    it('reads the course ids from the best-lap keys of course/link.ts', () => {
        const bests = { [bestKey(track, 'whoop')]: 12345, [bestKey({ ...track, id: '887f27aa-0000ffff' }, 'whoop')]: 0, junk: 5 };
        const lapped = lappedIds(bests);
        expect([...lapped]).toEqual(['887f27aa-0000abcd']);
        expect(mayVote('887f27aa-0000abcd', lapped)).toBe(true);
        expect(mayVote('887f27aa-0000ffff', lapped)).toBe(false);
        expect(mayVote('887f27aa-0000abcd', new Set())).toBe(false);
    });
});

describe("the admin's version from the editor", () => {
    it('keeps the edited gates on the served id, names the version before, writes a person file under the admin name without a generator', () => {
        const edited = { format: 'shramko-sonic-track/1', id: 'g1.1', version: 1, title: 'Course 9ix', author: { kind: 'generator', name: 'gsfpv-course' }, generator: { name: 'gsfpv-course', seed: 1 }, parent: null, gates: [{ id: 'g1' }] };
        const b = adminVersionBody(edited, '887f27aa-0000abcd', 3, '  Hall loop  ');
        expect(b.id).toBe('887f27aa-0000abcd');
        expect(b.version).toBe(4);
        expect(b.parent).toEqual({ id: '887f27aa-0000abcd', version: 3 });
        expect(b.author).toEqual({ kind: 'person', name: 'Admin' });
        expect(b.generator).toBeNull();
        expect(b.title).toBe('Hall loop');
        expect(b.gates).toEqual([{ id: 'g1' }]);
        expect(adminVersionBody(edited, 'x', 1, '   ').title).toBe('Course 9ix');
    });
});

describe('texts', () => {
    it('has the new keys in en, es, pl, ru, each language its own words', () => {
        const keys = ['course.edit.saveAdmin', 'course.edit.savedAdmin', 'course.edit.adminFirst', 'course.edit.voteAfterLap'];
        const by: Record<string, Record<string, string>> = {};
        for (const l of ['en', 'es', 'pl', 'ru']) by[l] = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'course', `${l}.json`), 'utf8'));
        for (const k of keys) {
            const vals = ['en', 'es', 'pl', 'ru'].map((l) => by[l]![k]);
            expect(vals.every((v) => typeof v === 'string' && v.length > 0), k).toBe(true);
            expect(new Set(vals).size, k).toBe(4);
        }
        expect(by.en!['course.edit.savedAdmin']).toContain('{v}');
        expect(by.ru!['course.edit.savedAdmin']).toContain('{v}');
    });
});

// The owner's Tracks tab (apps/fly/src/admin/tracks, stage T4-admin): how a row is read, sorted and searched, what a rename sends, and the
// link that opens a course in the simulator's editor (and how the page reads that link back, course/link.ts). Node only (model.ts has no
// DOM and no words); the tab itself is tried in a browser against the real routes on a local copy (tools/bench/src/tracks-admin.ts), the
// routes in apps/api/tests/test_tracks_edit.py. Every claim has a control.
import { describe, expect, it } from 'vitest';
import { ADMIN_AUTHOR_NAME, editorLink, isHidden,markParts, matches, renamed, sortRows, sortScenes, titleIssue, TRACK_ID } from '../../../apps/fly/src/admin/tracks/model';
import type { AdminTrackRow } from '../../../apps/fly/src/admin/tracks/model';
import { editOfLink, seedOfLink, serverOfLink } from '../../../apps/fly/src/course/link';

const row = (id: string, over: Partial<AdminTrackRow> = {}): AdminTrackRow => ({
    id,
    version: 1,
    versions: [1],
    title: `Course ${id}`,
    gates: 12,
    lengthM: 240.4,
    created: '2026-11-13T10:00:00Z',
    edited: null,
    creator: { kind: 'generator', name: null },
    editor: null,
    parent: null,
    origin: null,
    up: 0,
    down: 0,
    broken: 0,
    hidden: false,
    editable: false,
    ...over
});

describe('marks', () => {
    it('a pilot shows the typed name; the generator and the admin never show one', () => {
        expect(markParts({ kind: 'pilot', name: 'Ola' })).toEqual({ kind: 'pilot', name: 'Ola' });
        expect(markParts({ kind: 'generator', name: null })).toEqual({ kind: 'generator', name: null });
        expect(markParts({ kind: 'admin', name: null })).toEqual({ kind: 'admin', name: null });
        // controls: a name on a non-pilot mark is not shown, an empty pilot name is no name, an unknown kind is 'other', no mark is null
        expect(markParts({ kind: 'admin', name: 'x' })?.name).toBeNull();
        expect(markParts({ kind: 'pilot', name: '  ' })?.name).toBeNull();
        expect(markParts({ kind: 'robot', name: 'x' })).toEqual({ kind: 'other', name: null });
        expect(markParts(null)).toBeNull();
    });

    it('hidden is true for the admin\'s true and the scene cap\'s "cap", false only for false', () => {
        expect(isHidden(row('a', { hidden: true }))).toBe(true);
        expect(isHidden(row('a', { hidden: 'cap' }))).toBe(true);
        expect(isHidden(row('a'))).toBe(false);
    });
});

describe('order and search', () => {
    const a = row('887f27aa-00000001', { created: '2026-11-10T10:00:00Z', up: 5, down: 1, broken: 0, title: 'Hangar loop' });
    const b = row('887f27aa-00000002', { created: '2026-11-12T10:00:00Z', up: 1, down: 0, broken: 3 });
    const c = row('887f27aa-00000003', { created: '2026-11-11T10:00:00Z', up: 6, down: 4, broken: 1 });
    const ids = (rs: AdminTrackRow[]): string[] => rs.map((r) => r.id.slice(-1));

    it('newest first, best net votes first, most broken first', () => {
        expect(ids(sortRows([a, b, c], 'new'))).toEqual(['2', '3', '1']);
        expect(ids(sortRows([a, b, c], 'votes'))).toEqual(['1', '3', '2']);
        expect(ids(sortRows([a, b, c], 'broken'))).toEqual(['2', '3', '1']);
        // control: the input is not reordered in place
        const input = [a, b, c];
        sortRows(input, 'new');
        expect(ids(input)).toEqual(['1', '2', '3']);
    });

    it('a net tie goes to more up-votes, then to the newer', () => {
        const d = row('887f27aa-00000004', { created: '2026-11-13T10:00:00Z', up: 2, down: 0 });
        const e = row('887f27aa-00000005', { created: '2026-11-09T10:00:00Z', up: 3, down: 1 });
        const f = row('887f27aa-00000006', { created: '2026-11-14T10:00:00Z', up: 2, down: 0 });
        expect(ids(sortRows([d, e, f], 'votes'))).toEqual(['5', '6', '4']);
    });

    it('search folds case and finds a title or an id; empty keeps all', () => {
        expect(matches(a, 'HANGAR')).toBe(true);
        expect(matches(a, '00000001')).toBe(true);
        expect(matches(a, '  ')).toBe(true);
        expect(matches(a, 'warehouse')).toBe(false);
    });

    it('the busiest scene comes first', () => {
        expect(sortScenes([{ scene: 'bbbbbb', tracks: 1, hidden: 0 }, { scene: 'aaaaaa', tracks: 4, hidden: 1 }, { scene: 'cccccc', tracks: 4, hidden: 0 }]).map((s) => s.scene)).toEqual(['aaaaaa', 'cccccc', 'bbbbbb']);
    });
});

describe('rename', () => {
    it('refuses the same title, too short and too long before the server; counts letters, not UTF-16 units', () => {
        expect(titleIssue('Hangar loop ', 'Hangar loop')).toBe('same');
        expect(titleIssue('ab', 'x')).toBe('short');
        expect(titleIssue('a'.repeat(61), 'x')).toBe('long');
        expect(titleIssue('a'.repeat(60), 'x')).toBeNull();
        // three emoji are 6 UTF-16 units but 3 characters: allowed (the server decides about the signs)
        expect(titleIssue('\u{1F680}\u{1F680}\u{1F680}', 'x')).toBeNull();
        expect(titleIssue('Nowa trasa', 'Hangar loop')).toBeNull();
    });

    it('sends the latest file with only the title changed, trimmed and in NFC', () => {
        const file = { format: 'shramko-sonic-track/1', id: 'x', version: 2, title: 'Old', author: { kind: 'person', name: 'Ann' }, generator: null, gates: [{ id: 'g1' }] };
        const out = renamed(file, '  Cafe\u0301 run ');
        expect(out).toEqual({ ...file, title: 'Caf\u00e9 run' });
        expect(file.title).toBe('Old');
    });

    it('a generated course renamed becomes a person\'s file (the server keeps generator titles to "Course <x>")', () => {
        const file = { format: 'shramko-sonic-track/1', id: 'x', version: 1, title: 'Course 9ix', author: { kind: 'generator', name: 'gsfpv-course' }, generator: { name: 'gsfpv-course', seed: 1 }, parent: null };
        const out = renamed(file, 'Hangar loop');
        expect(out).toEqual({ ...file, title: 'Hangar loop', author: { kind: 'person', name: ADMIN_AUTHOR_NAME }, generator: null });
        expect(file.author.kind).toBe('generator');
    });
});

describe('open in the editor', () => {
    it('the admin\'s link names the scene, the course and edit=1, and the page reads them back', () => {
        const href = editorLink('pl', '887f27aa', '887f27aa-830e1273');
        expect(href).toBe('/pl/fly/?scene=887f27aa&course=887f27aa-830e1273&edit=1');
        const search = href.slice(href.indexOf('?'));
        expect(serverOfLink(search)).toBe('887f27aa-830e1273');
        expect(editOfLink(search)).toBe(true);
        expect(seedOfLink(search)).toBeNull();
        expect(TRACK_ID.test('887f27aa-830e1273')).toBe(true);
    });

    it('controls: a seed link is not a served course, a bad id is nothing, no edit=1 is no editor', () => {
        expect(serverOfLink('?course=g1.abc')).toBeNull();
        expect(seedOfLink('?course=g1.abc')).not.toBeNull();
        expect(serverOfLink('?course=887f27aa-830e127')).toBeNull();
        expect(serverOfLink('?course=887F27AA-830E1273')).toBeNull();
        expect(serverOfLink('?course=../887f27aa-830e1273')).toBeNull();
        expect(editOfLink('?course=887f27aa-830e1273')).toBe(false);
        expect(editOfLink('?edit=true')).toBe(false);
    });
});

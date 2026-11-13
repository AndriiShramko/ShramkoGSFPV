// The course editor's locale keys (lane tracks, stage T3-editor-ui): every refusal and problem code of
// packages/tracks/src/editor.ts and every action has its key in packages/i18n/locales/fly/course/*.json. No DOM, no i18n
// import, so a Node test can hold the tables to the four languages.
import type { CourseProblem, EditAction, EditRefusal } from '@gsfpv/tracks';
import { KEY_ROWS } from './keys';

/** the locale key of every refusal code: the test holds this table to EditRefusal and to the four languages */
export const REFUSAL_KEYS: Record<EditRefusal['code'], string> = {
    placement: 'course.edit.r.placement',
    'min-gates': 'course.edit.r.minGates',
    'max-gates': 'course.edit.r.maxGates',
    'size-min': 'course.edit.r.sizeMin',
    'size-max': 'course.edit.r.sizeMax',
    'order-edge': 'course.edit.r.orderEdge',
    same: 'course.edit.r.same',
    'nothing-to-undo': 'course.edit.r.undo',
    'nothing-to-redo': 'course.edit.r.redo'
};

export const PROBLEM_KEYS: Record<CourseProblem['code'], string> = {
    outside: 'course.edit.p.outside',
    'start-wall': 'course.edit.p.startWall',
    'gate-wall': 'course.edit.p.gateWall',
    'leg-wall': 'course.edit.p.legWall',
    'gate-direction': 'course.edit.p.direction',
    'no-start': 'course.edit.p.noStart'
};

/** what an accepted action did, by the key row that names it */
export const ACTION_KEYS: Record<EditAction['kind'], string> = {
    select: 'course.edit.key.next',
    'select-step': 'course.edit.key.next',
    move: 'course.edit.key.moved',
    turn: 'course.edit.key.turned',
    shape: 'course.edit.key.shaped',
    dive: 'course.edit.key.dive',
    size: 'course.edit.key.sized',
    insert: 'course.edit.key.insert',
    delete: 'course.edit.key.delete',
    order: 'course.edit.key.order',
    undo: 'course.edit.key.undo',
    redo: 'course.edit.key.redo'
};

/** A list mark as the server sends it (apps/api/tracks.py _mark: kind 'pilot' with a name, 'admin' or 'generator' with name null) in
 *  words: the locale key of its kind and the name, null when it has none (shown as the kind's word alone, never "null"). */
export function markParts(m: { kind: string; name?: string | null } | null | undefined): { kindKey: string; name: string | null } | null {
    if (!m) return null;
    const kind = m.kind === 'pilot' || m.kind === 'person' ? 'person' : m.kind === 'admin' ? 'admin' : 'generator';
    const name = typeof m.name === 'string' && m.name.trim() ? m.name : null;
    return { kindKey: `course.edit.kind.${kind}`, name };
}

/** every locale key the editor uses (the test checks all four languages have each) */
export function editorLocaleKeys(): string[] {
    const fixed = ['course.edit.title', 'course.edit.menu', 'keys.course.edit', 'course.edit.gate', 'course.edit.shape.ring', 'course.edit.shape.square',
        'course.edit.shape.cube-frame', 'course.edit.shape.dive', 'course.edit.ok', 'course.edit.problems', 'course.edit.did', 'course.edit.name',
        'course.edit.courseTitle', 'course.edit.saveMine', 'course.edit.saveAll', 'course.edit.close', 'course.edit.savedMine', 'course.edit.saveRefused',
        'course.edit.allEdited', 'course.edit.allDone', 'course.edit.unsaved', 'course.edit.noCourse', 'course.edit.list', 'course.edit.listEmpty',
        'course.edit.by', 'course.edit.editedBy', 'course.edit.kind.generator', 'course.edit.kind.person', 'course.edit.kind.admin', 'course.edit.votes',
        'course.edit.voteUp', 'course.edit.voteDown', 'course.edit.open', 'course.edit.voted', 'course.edit.voteFailed', 'course.edit.opened',
        'course.edit.mine', 'course.edit.keys', 'course.edit.gates'];
    return [...new Set([...fixed, ...Object.values(REFUSAL_KEYS), ...Object.values(PROBLEM_KEYS), ...Object.values(ACTION_KEYS), ...KEY_ROWS.map((r) => r.labelKey)])];
}

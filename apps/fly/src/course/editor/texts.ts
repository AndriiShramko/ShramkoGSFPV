// The course editor's locale keys (lane tracks, stage T3-editor-ui): every refusal and problem code of
// packages/tracks/src/editor.ts and every action has its key in packages/i18n/locales/fly/course/*.json. No DOM, no i18n
// import, so a Node test can hold the tables to the four languages.
import type { Course, CourseProblem, EditAction, EditRefusal } from '@gsfpv/tracks';
import { CAM_ROWS, KEY_ROWS } from './keys';
import { COURSE_MENU_HUB, TOOLS, TOP_BUTTONS } from './bar-place';

/** the locale key of every refusal code: the test holds this table to EditRefusal and to the four languages */
export const REFUSAL_KEYS: Record<EditRefusal['code'], string> = {
    placement: 'course.edit.r.placement',
    'min-gates': 'course.edit.r.minGates',
    'max-gates': 'course.edit.r.maxGates',
    'size-min': 'course.edit.r.sizeMin',
    'size-max': 'course.edit.r.sizeMax',
    'order-edge': 'course.edit.r.orderEdge',
    // lane edit4b (E4): an empty course
    'no-gate': 'course.edit.r.noGate',
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

/** train 3 H1: a leg from the start is named so (the check's id 'start' is no gate; it was shown as "gate 0") */
export const LEG_START_KEY = 'course.edit.p.legStart';

/** A gate's number as the pilot sees it (from 1), 0 when the id is no gate of the course. */
export const gateNumber = (c: Course, id: string): number => c.gates.findIndex((g) => g.id === id) + 1;

/** train 3 H1: the locale key and the values of one problem; gate numbers count from 1, a leg from the start names the start. */
export function problemParts(c: Course, p: CourseProblem): { key: string; args: Record<string, number> } {
    const key = PROBLEM_KEYS[p.code];
    switch (p.code) {
        case 'outside': case 'gate-wall': return { key, args: { g: gateNumber(c, p.gate) } };
        case 'gate-direction': return { key, args: { g: gateNumber(c, p.gate), deg: Math.round(p.deg) } };
        case 'leg-wall': return gateNumber(c, p.from) === 0 ? { key: LEG_START_KEY, args: { b: gateNumber(c, p.to) } } : { key, args: { a: gateNumber(c, p.from), b: gateNumber(c, p.to) } };
        default: return { key, args: {} };
    }
}

/** train 3 H1: the sentence that says what is wrong with one gate and what to do, by problem (a leg from the start apart) */
export const FIX_KEYS: Record<CourseProblem['code'] | 'legStart', string> = {
    outside: 'course.edit.fix.outside',
    'start-wall': 'course.edit.fix.startWall',
    'gate-wall': 'course.edit.fix.gateWall',
    'leg-wall': 'course.edit.fix.legWall',
    legStart: 'course.edit.fix.legStart',
    'gate-direction': 'course.edit.fix.direction',
    'no-start': 'course.edit.fix.noStart'
};
/** lane edit4b (E8): the sentences that name a gate for the pilot to find and fix. They come only from firstWrong, whose one
 *  caller (course.ts showWrong) points at that gate (Services.pointAt: selected, its number and paint flash, an edge arrow);
 *  the problem words (PROBLEM_KEYS, the window's status line) name gates the labels show red (rules.ts badGates). */
export const POINTED_KEYS: readonly string[] = [FIX_KEYS.outside, FIX_KEYS['gate-wall'], FIX_KEYS['leg-wall'], FIX_KEYS.legStart, FIX_KEYS['gate-direction']];
/** the lead's sentence around it: a refused Save, a floor-added gate the check refuses */
export const SAVE_FIX_KEY = 'course.edit.saveFix';
export const ADD_FIX_KEY = 'course.edit.addFix';

const involves = (p: CourseProblem, id: string): boolean => (p.code === 'leg-wall' ? p.from === id || p.to === id : 'gate' in p && p.gate === id);

/**
 * train 3 H1 (the lead's decision for a refused Save): the gate to select (index from 0), and the sentence that names it from 1
 * and says what to do. The first wrong gate is the lowest gate a problem points at (a leg points at its far gate; the start's own
 * problems at gate 1). With `focus` (a gate just added) only its problems count and that gate is the one selected.
 */
export function firstWrong(c: Course, problems: readonly CourseProblem[], focus: string | null = null): { index: number; key: string; args: Record<string, number> } | null {
    let best: { index: number; key: string; args: Record<string, number> } | null = null;
    const focusAt = focus === null ? -1 : c.gates.findIndex((g) => g.id === focus);
    for (const p of problems) {
        if (focus !== null && !involves(p, focus)) continue;
        let index = 0;
        let key = FIX_KEYS[p.code];
        let args: Record<string, number> = {};
        if (p.code === 'leg-wall') {
            const b = gateNumber(c, p.to);
            const a = gateNumber(c, p.from);
            index = focusAt >= 0 ? focusAt : b - 1;
            if (a === 0) {
                key = FIX_KEYS.legStart;
                args = { b };
            } else args = { a, b, m: index + 1 };
        } else if (p.code === 'outside' || p.code === 'gate-wall' || p.code === 'gate-direction') {
            index = gateNumber(c, p.gate) - 1;
            args = { g: index + 1 };
        }
        if (index < 0) continue;
        if (!best || index < best.index) best = { index, key, args };
    }
    return best;
}

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
    add: 'course.edit.bar.add',
    delete: 'course.edit.key.delete',
    replace: 'course.edit.key.cleared',
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
        'course.edit.mine', 'course.edit.keys', 'course.edit.gates',
        // lane editor3 E3: the top bar, Duplicate and flying inside the mode
        'course.edit.bar.add', 'course.edit.bar.addHint', 'course.edit.bar.duplicate', 'course.edit.flyHint', 'course.edit.flying',
        // review ED-6: a gate taken by a click
        'course.edit.selected', LEG_START_KEY, SAVE_FIX_KEY, ADD_FIX_KEY];
    return [...new Set([...fixed, ...Object.values(FIX_KEYS),...Object.values(REFUSAL_KEYS), ...Object.values(PROBLEM_KEYS), ...Object.values(ACTION_KEYS), ...KEY_ROWS.map((r) => r.labelKey),
        ...CAM_ROWS.map((r) => r.labelKey), ...TOP_BUTTONS.map((b) => b.labelKey), ...COURSE_MENU_HUB.map((b) => b.labelKey), 'course.edit.bar.back', ...TOOLS.map((b) => b.labelKey)])];
}

/** review ED-6: the word for what an accepted edit did: a step back says "previous gate", a click (select) says "selected" */
export function actionKey(e: EditAction): string {
    if (e.kind === 'select') return 'course.edit.selected';
    if (e.kind === 'select-step' && e.step < 0) return 'course.edit.key.prev';
    return ACTION_KEYS[e.kind];
}

// The course editor's words (lane tracks, stage T3-editor-ui): every refusal and problem code of packages/tracks/src/editor.ts
// and every list mark turned into the page's language (packages/i18n/locales/fly/course/*.json). Words only, no DOM.
import { t } from '../../i18n';
import type { Course, CourseProblem, EditRefusal, EditorState } from '@gsfpv/tracks';
import type { CourseMark } from '../store';
import { PROBLEM_KEYS, REFUSAL_KEYS } from './texts';
export { ACTION_KEYS, PROBLEM_KEYS, REFUSAL_KEYS, editorLocaleKeys } from './texts';

const gateNo = (c: Course, id: string): number => c.gates.findIndex((g) => g.id === id) + 1;

export function problemText(c: Course, p: CourseProblem): string {
    const k = PROBLEM_KEYS[p.code];
    switch (p.code) {
        case 'outside': case 'gate-wall': return t(k, { g: gateNo(c, p.gate) });
        case 'gate-direction': return t(k, { g: gateNo(c, p.gate), deg: Math.round(p.deg) });
        case 'leg-wall': return t(k, { a: gateNo(c, p.from), b: gateNo(c, p.to) });
        default: return t(k);
    }
}

export function refusalText(c: Course, r: EditRefusal): string {
    const k = REFUSAL_KEYS[r.code];
    switch (r.code) {
        case 'placement': return t(k, { why: r.problems.slice(0, 2).map((p) => problemText(c, p)).join('; ') });
        case 'min-gates': return t(k, { n: r.min });
        case 'max-gates': return t(k, { n: r.max });
        case 'size-min': return t(k, { m: r.minM.toFixed(1) });
        case 'size-max': return t(k, { m: r.maxM.toFixed(1) });
        default: return t(k);
    }
}

/** The selected gate: its number, shape and opening (flown m: the scan's size times the scene's scale). */
export function gateLine(s: EditorState, scale: number): string {
    const g = s.course.gates[s.selected];
    if (!g) return '';
    // a dive gate: its local -Z (the way it is passed) points down (editor.ts isDive)
    const [w, x, y, z] = g.quat;
    const downY = -2 * (y * z - w * x);
    const shape = Math.abs(downY) > 0.7 ? 'dive' : g.shape.kind;
    const opening = g.shape.kind === 'ring' ? g.shape.diameter : g.shape.kind === 'square' || g.shape.kind === 'cube-frame' ? g.shape.side : 0;
    const size = opening * scale;
    return t('course.edit.gate', { n: s.selected + 1, of: s.course.gates.length, shape: t(`course.edit.shape.${shape}`), size: size.toFixed(1) });
}

export function problemsLine(s: EditorState): string {
    if (s.problems.length === 0) return t('course.edit.ok');
    return t('course.edit.problems', { n: s.problems.length, first: problemText(s.course, s.problems[0]!) });
}

export function markText(m: CourseMark | null | undefined): string {
    if (!m) return '';
    const kind = m.kind === 'person' ? 'person' : m.kind === 'admin' ? 'admin' : 'generator';
    return `${m.name} (${t(`course.edit.kind.${kind}`)})`;
}

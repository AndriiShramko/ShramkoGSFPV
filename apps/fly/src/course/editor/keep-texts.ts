// Lane edit4s (train 4): the keys of the saving part's texts (locales fly/course-save/, namespace course.keep.*), in one
// list so the tests can hold all four languages to it.
import type { DraftBy } from './drafts';

/** the words of a draft's 'what changed' column, per kind of change */
export const DRAFT_BY_KEYS: Readonly<Record<string, string>> = {
    move: 'course.keep.by.move',
    drag: 'course.keep.by.move',
    place: 'course.keep.by.move',
    turn: 'course.keep.by.turn',
    dive: 'course.keep.by.turn',
    size: 'course.keep.by.size',
    shape: 'course.keep.by.shape',
    insert: 'course.keep.by.add',
    add: 'course.keep.by.add',
    piece: 'course.keep.by.add',
    delete: 'course.keep.by.delete',
    clear: 'course.keep.by.delete',
    order: 'course.keep.by.order',
    undo: 'course.keep.by.undo',
    redo: 'course.keep.by.undo',
    fix: 'course.keep.by.fix',
    restore: 'course.keep.by.restore',
    generate: 'course.keep.by.leave',
    new: 'course.keep.by.leave',
    'open-other': 'course.keep.by.leave',
    leave: 'course.keep.by.leave',
};

export const DRAFT_BY_OTHER = 'course.keep.by.edit';

export function draftByKey(by: DraftBy): string {
    return DRAFT_BY_KEYS[by] ?? DRAFT_BY_OTHER;
}

export const KEEP_KEYS: readonly string[] = [
    ...new Set(Object.values(DRAFT_BY_KEYS)),
    DRAFT_BY_OTHER,
    'course.keep.restored',
    'course.keep.blocked',
    'course.keep.versions',
    'course.keep.versionsNote',
    'course.keep.versionsEmpty',
    'course.keep.version',
    'course.keep.versionSaved',
    'course.keep.back',
    'course.keep.backDone',
    'course.keep.close',
];

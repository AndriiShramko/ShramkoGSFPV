// Lane edit4s (train 4, E6): the saving part of the course editor. DraftKeeper writes the edited course as a draft 2 s
// after the last change, at once before a step that drops it (generate, open another course, clear, a fix) and when the
// page or the editor closes; when the editor opens it brings back the newest unsaved draft that is newer than the opened
// course (one undo step: Ctrl+Z takes it away) and says so; Course > Versions lists the kept drafts.
// The design's seam (course/editor/seam.ts, stage S0) maps onto it one to one: seam 'opened' -> opened(), 'changed' ->
// changed(by), a loss -> beforeLoss(by), 'saved' -> saved(track), 'closed' -> leave(). Until the seam exists
// builtin/course.ts calls these methods itself.
import type { TrackFile } from '@shramko/sonic-fpv';
import { t } from '../../../i18n';
import { siteStorage } from '../../store';
import {
    DRAFT_DEBOUNCE_MS, addDraft, clockOf, draftToRestore, markSaved, readDrafts, writeDrafts,
    type DraftBy, type DraftEntry, type DraftStorage, type OpenedCourse,
} from '../drafts';

/** what the keeper needs from the editor (the members of the design's EditorSeam it uses) */
export interface KeepHost {
    sceneId(): string;
    /** the edited course as a file (showEd's identity rules); null when the editor is closed */
    trackNow(): TrackFile | null;
    /** the server course the edit started from (null: generated or new) */
    sourceId(): string | null;
    /** puts the gates of `track` in the editor as one undo step (seam.replace(..., 'restore')) */
    restore(track: TrackFile): void;
    say(text: string, level: 'did' | 'warn' | 'problem'): void;
    /** probe data (seam.hook('s', ...)) */
    hook(data: Record<string, unknown>): void;
    /** the kept drafts, newest first, for Course > Versions (panel.ts versions) */
    versions(list: readonly DraftEntry[]): void;
}

export class DraftKeeper {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private pendingBy: DraftBy | null = null;
    private toldBlocked = false;
    /** a change not yet saved on the server since the editor opened (an untouched course is no draft) */
    private dirty = false;
    private readonly onHide = (): void => this.leave();

    constructor(private readonly host: KeepHost, private readonly store: DraftStorage | null = siteStorage(), private readonly now: () => number = () => Date.now()) {
        globalThis.addEventListener?.('pagehide', this.onHide);
        this.report();
    }

    /** the scene's drafts, newest first */
    list(): DraftEntry[] {
        return readDrafts(this.store, this.host.sceneId());
    }

    /** the editor opened a course: the newest unsaved draft newer than it comes back (returned), else null */
    opened(o: OpenedCourse): DraftEntry | null {
        const d = draftToRestore(this.list(), o);
        if (d) {
            this.host.restore(d.track);
            this.host.say(t('course.keep.restored', { time: clockOf(d.t), n: this.list().length }), 'did');
        }
        this.dirty = false;
        this.report(d);
        return d;
    }

    /** one accepted change: a draft is written DRAFT_DEBOUNCE_MS after the last one */
    changed(by: DraftBy): void {
        this.pendingBy = by;
        this.dirty = true;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), DRAFT_DEBOUNCE_MS);
    }

    /** a step that drops the edited course is about to run: the course as it stands is kept now */
    beforeLoss(by: DraftBy): void {
        if (this.dirty) this.flush(this.pendingBy ?? by);
    }

    /** the page hides or the editor closes: a waiting draft is written now */
    leave(): void {
        if (this.pendingBy !== null) this.flush();
    }

    /** the course was saved on the server: its drafts are marked saved (kept in Versions, not restored) */
    saved(track: TrackFile): void {
        this.leave();
        this.dirty = false;
        const scene = this.host.sceneId();
        const list = this.list();
        if (list.length > 0) this.wrote(writeDrafts(this.store, scene, markSaved(list, track), this.now()));
        this.report();
    }

    /** Versions: the draft at `index` of list() goes into the editor (one undo step) */
    back(index: number): boolean {
        const d = this.list()[index];
        if (!d) return false;
        this.flush('restore');
        this.host.restore(d.track);
        this.host.say(t('course.keep.backDone', { time: clockOf(d.t), n: d.gates }), 'did');
        this.report(d);
        return true;
    }

    dispose(): void {
        this.leave();
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        globalThis.removeEventListener?.('pagehide', this.onHide);
    }

    private flush(by: DraftBy | null = this.pendingBy): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.pendingBy = null;
        if (by === null) return;
        const track = this.host.trackNow();
        if (!track) return;
        const scene = this.host.sceneId();
        const e: DraftEntry = { t: this.now(), by, title: track.title, sourceId: this.host.sourceId(), gates: track.gates.length, saved: false, track };
        this.wrote(writeDrafts(this.store, scene, addDraft(this.list(), e), this.now()));
        this.report();
    }

    private wrote(w: 'ok' | 'blocked'): void {
        if (w === 'ok' || this.toldBlocked) return;
        this.toldBlocked = true;
        this.host.say(t('course.keep.blocked'), 'warn');
    }

    private report(restored: DraftEntry | null = null): void {
        const l = this.list();
        this.host.versions(l);
        this.host.hook({ drafts: l.length, newest: l[0]?.t ?? null, restored: restored ? restored.t : undefined, blocked: this.toldBlocked });
    }
}

// The course's lines on the flight view (train 1, lane tracks, T2; tracks-plan 2.5): the running lap time, lap n of N, the
// next gate, the last and the best lap. Its own block under #ui; H hides it with the rest of the HUD (#ui.hud-off, hud.css).
import { t } from '../i18n';
import type { LapView } from '@gsfpv/tracks';
import { pushUnderNote } from './note-slot';
import './hud.css';

/** m:ss.cc */
export function lapClock(ms: number | null): string {
    if (ms === null) return '-';
    const cs = Math.floor(Math.max(0, ms) / 10);
    const m = Math.floor(cs / 6000);
    const s = Math.floor((cs % 6000) / 100);
    return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

export class CourseHud {
    readonly el: HTMLDivElement;
    private readonly time: HTMLDivElement;
    private readonly lines: HTMLDivElement;
    private shown = '';
    /** the note's slot (lane look L2): the block's top stays under the lowest bottom the flash note had since the last resize */
    private push = 0;
    private queued = false;
    private watched: HTMLElement | null = null;
    private readonly watch: MutationObserver;
    private readonly onResize: () => void;

    constructor(private readonly parent: HTMLElement) {
        this.el = document.createElement('div');
        this.el.className = 'course-hud';
        this.el.setAttribute('data-testid', 'course-hud');
        this.el.hidden = true;
        this.time = document.createElement('div');
        this.time.className = 'course-time';
        this.lines = document.createElement('div');
        this.lines.className = 'course-lines';
        this.el.append(this.time, this.lines);
        parent.appendChild(this.el);
        // the note (ui/hud.ts flash) shows, changes its text, hides; top-row.ts moves it under the buttons (#ui.note-crowded and
        // the --top-row-bottom it writes on #ui): each of these lays the block out again on the next frame
        this.watch = new MutationObserver(() => this.again());
        this.watch.observe(parent, { attributes: true, attributeFilter: ['class', 'style'], childList: true });
        this.onResize = (): void => {
            this.push = 0;
            this.el.style.removeProperty('--course-push');
            this.again();
        };
        addEventListener('resize', this.onResize);
    }

    private again(): void {
        const note = this.parent.querySelector<HTMLElement>(':scope > .hud-note');
        if (note && note !== this.watched) {
            this.watched = note;
            this.watch.observe(note, { attributes: true, childList: true, characterData: true, subtree: true });
        }
        if (this.queued) return;
        this.queued = true;
        requestAnimationFrame(() => {
            this.queued = false;
            this.clearNote();
        });
    }

    /** Keeps the lap block out of the note's slot: under the note whenever both are up, and at the same place after the note hides. */
    private clearNote(): void {
        const note = this.watched;
        // review LK-1: with H the block is display:none by CSS (#ui.hud-off) while its hidden attribute stays false; its box is
        // then all zeros and would push it under the note from the top of the view. H back on changes #ui's class: measured again.
        if (this.el.hidden || this.el.offsetParent === null || !note || note.hidden || note.offsetParent === null) return;
        const up = note.getBoundingClientRect();
        this.el.style.setProperty('--course-push', '0px');
        this.push = pushUnderNote(up, this.el.getBoundingClientRect(), this.push);
        this.el.style.setProperty('--course-push', `${this.push}px`);
    }

    update(v: LapView | null, gates: number): void {
        if (v === null) {
            this.el.hidden = true;
            return;
        }
        if (this.el.hidden) {
            this.el.hidden = false;
            this.again();
        }
        const time = lapClock(v.lapMs);
        const lines = [
            t('course.hud.lap', { n: Math.max(1, v.lap), of: v.lapsPerRun }),
            t('course.hud.next', { n: v.next + 1, of: gates }),
            t('course.hud.last', { time: lapClock(v.lastLapMs) }),
            t('course.hud.best', { time: lapClock(v.bestLapMs) })
        ].join('\n');
        const key = time + lines;
        if (key === this.shown) return;
        this.shown = key;
        this.time.textContent = time;
        this.lines.textContent = lines;
    }

    dispose(): void {
        this.watch.disconnect();
        removeEventListener('resize', this.onResize);
        this.el.remove();
    }
}

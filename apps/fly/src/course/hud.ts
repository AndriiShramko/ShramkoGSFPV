// The course's lines on the flight view (train 1, lane tracks, T2; tracks-plan 2.5): the running lap time, lap n of N, the
// next gate, the last and the best lap. Its own block under #ui; H hides it with the rest of the HUD (#ui.hud-off, hud.css).
import { t } from '../i18n';
import type { LapView } from '@gsfpv/tracks';
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

    constructor(parent: HTMLElement) {
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
    }

    update(v: LapView | null, gates: number): void {
        if (v === null) {
            this.el.hidden = true;
            return;
        }
        this.el.hidden = false;
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
        this.el.remove();
    }
}

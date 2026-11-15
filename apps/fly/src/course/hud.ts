// The course's lines on the flight view (train 1, lane tracks, T2; tracks-plan 2.5): the running lap time, lap n of N, the
// next gate, the last and the best lap. Its own block under #ui; H hides it with the rest of the HUD (#ui.hud-off, hud.css).
import { t } from '../i18n';
import type { LapView } from '@gsfpv/tracks';
import { COVERED_CLASS } from './cover';
import { pushUnderNote } from './note-slot';
import { placeGuide } from './guide';
import type { Box, GuideAim } from './guide';
import './hud.css';

import { lapClock } from './hud-clock';
export { lapClock };

/** what the guide shows now (the page hook course.guide; probes read it) */
export interface GuideState { shown: boolean; gate: number; metres: number; side: 'left' | 'right'; behind: boolean; inFrame: boolean; bearingDeg: number; x: number; y: number }

export class CourseHud {
    readonly el: HTMLDivElement;
    private readonly time: HTMLDivElement;
    private readonly lines: HTMLDivElement;
    private shown = '';
    /** the note's slot (lane look L2): the block's top stays under the lowest bottom the flash note had since the last resize */
    private push = 0;
    private queued = false;
    private watched: HTMLElement | null = null;
    private wallsWatched: HTMLElement | null = null;
    private readonly watch: MutationObserver;
    private readonly onResize: () => void;
    /** the guide to the next gate (stage X2-gate-one): its own element under #ui, hidden from assistive technology */
    private readonly guideEl: HTMLDivElement;
    private readonly guideArrow: HTMLSpanElement;
    private readonly guideText: HTMLSpanElement;
    private guideKey = '';
    private guideMove = '';
    private guideTurn = '';
    private guideW = 0;
    private guideH = 0;
    /** the boxes the guide stays out of (note, lap block, top row), measured when they change, never per frame */
    private avoid: Box[] = [];
    readonly guideState: GuideState = { shown: false, gate: -1, metres: 0, side: 'right', behind: false, inFrame: false, bearingDeg: 0, x: 0, y: 0 };

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
        this.guideEl = document.createElement('div');
        this.guideEl.className = 'course-guide';
        this.guideEl.setAttribute('data-testid', 'course-guide');
        // sound mode's cues guide a pilot who does not see the screen; this is for the eyes only
        this.guideEl.setAttribute('aria-hidden', 'true');
        this.guideEl.hidden = true;
        this.guideArrow = document.createElement('span');
        this.guideArrow.className = 'course-guide-arrow';
        this.guideText = document.createElement('span');
        this.guideText.className = 'course-guide-text';
        this.guideEl.append(this.guideArrow, this.guideText);
        parent.appendChild(this.guideEl);
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
        // review FX-4: the walls box changes its lines and its size; the guide's boxes are measured again then
        const walls = this.parent.querySelector<HTMLElement>(':scope > .bake-box');
        if (walls && walls !== this.wallsWatched) {
            this.wallsWatched = walls;
            this.watch.observe(walls, { attributes: true, childList: true, characterData: true, subtree: true });
        }
        if (this.queued) return;
        this.queued = true;
        requestAnimationFrame(() => {
            this.queued = false;
            this.clearNote();
            this.measureAvoid();
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

    /** The boxes the guide must not meet, read from the page when the note, the block or the top row change (not per frame). */
    private measureAvoid(): void {
        const out: Box[] = [];
        const add = (el: Element | null): void => {
            if (!el || (el as HTMLElement).hidden || (el as HTMLElement).offsetParent === null) return;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
        };
        add(this.parent.querySelector(':scope > .hud-note'));
        add(this.parent.querySelector(':scope > .top-actions'));
        // review FX-4: the walls box (top centre) holds the walls line while a course waits for its walls
        add(this.parent.querySelector(':scope > .bake-box'));
        if (!this.el.hidden) add(this.el);
        this.avoid = out;
    }

    /**
     * The guide to the next gate (`gate`, 0-based) for `a` (course/guide.ts aimOf), or none. Writes to the DOM only when the text
     * or the turn changes; moves by a transform, and only when the place moved by a whole pixel.
     */
    guide(a: GuideAim | null, gate: number): void {
        const st = this.guideState;
        if (!a || a.hide || this.el.hidden) {
            if (!this.guideEl.hidden) this.guideEl.hidden = true;
            st.shown = false;
            st.gate = a ? gate : -1;
            if (a) Object.assign(st, { metres: a.metres, side: a.side, behind: a.behind, inFrame: a.inFrame, bearingDeg: Math.round(a.bearingDeg) });
            return;
        }
        let fresh = false;
        if (this.guideEl.hidden) {
            this.guideEl.hidden = false;
            fresh = true;
            if (this.avoid.length === 0) this.measureAvoid();
        }
        const turn = a.behind ? `behind-${a.side}` : a.inFrame ? 'over' : '';
        if (turn !== this.guideTurn) {
            if (this.guideTurn) this.guideEl.classList.remove(this.guideTurn);
            if (turn) this.guideEl.classList.add(turn);
            this.guideTurn = turn;
            fresh = true;
        }
        const text = t('course.hud.guide', { n: gate + 1, m: a.metres });
        if (text !== this.guideKey) {
            this.guideText.textContent = text;
            this.guideKey = text;
            fresh = true;
        }
        if (fresh || this.guideW === 0) {
            this.guideW = this.guideEl.offsetWidth;
            this.guideH = this.guideEl.offsetHeight;
        }
        const p = placeGuide(a, innerWidth, innerHeight, this.guideW, this.guideH, this.avoid);
        const deg = a.inFrame ? 90 : Math.round((Math.atan2(a.dir[1], a.dir[0]) * 180) / Math.PI);
        const move = `${Math.round(p.x - this.guideW / 2)},${Math.round(p.y - this.guideH / 2)},${deg}`;
        if (move !== this.guideMove) {
            this.guideMove = move;
            this.guideEl.style.transform = `translate(${Math.round(p.x - this.guideW / 2)}px, ${Math.round(p.y - this.guideH / 2)}px)`;
            this.guideArrow.style.transform = `rotate(${deg}deg)`;
        }
        Object.assign(st, { shown: true, gate, metres: a.metres, side: a.side, behind: a.behind, inFrame: a.inFrame, bearingDeg: Math.round(a.bearingDeg), x: Math.round(p.x), y: Math.round(p.y) });
    }

    /**
     * A full window is up (the pause menu, a panel, the controls screen): the lap block is not drawn over it (owner, train 2:
     * "the clock and all these statistics lie over the menu"). A class, not `hidden`: update() keeps its own state under it.
     */
    cover(on: boolean): void {
        if (this.el.classList.contains(COVERED_CLASS) === on) return;
        this.el.classList.toggle(COVERED_CLASS, on);
        this.guideEl.classList.toggle(COVERED_CLASS, on);
        if (!on) this.again();
    }

    update(v: LapView | null, gates: number): void {
        if (v === null) {
            this.el.hidden = true;
            this.guide(null, -1);
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
        this.guideEl.remove();
    }
}

// Lane editor3, train 3 stage I2-clean (docs/wip/editor3.md): the top bar's line keeps a refusal until the pilot's next
// action (D6, fake timers), it wraps to three lines and is never cut (lane n-save), and the flight's parts are hidden in the edit view (D5, D7).
// The browser proof is tools/bench/src/editor3-clean.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DONE_MS, LineHold } from '../../../apps/fly/src/course/editor/line-hold';

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const CSS = read('apps/fly/src/course/editor/editor.css');
const TOP = read('apps/fly/src/course/editor/top-bar.ts');

describe('editor3 I2 the top bar line (D6)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });
    const make = (): { hold: LineHold; seen: Array<[string | null, boolean]> } => {
        const seen: Array<[string | null, boolean]> = [];
        return { hold: new LineHold((text, refused) => seen.push([text, refused])), seen };
    };

    it('a refusal is still on the line after 10 s and 60 s, and goes at the next action', () => {
        const { hold, seen } = make();
        hold.tell('Not saved', true, 1000);
        vi.advanceTimersByTime(10_000);
        expect(seen.at(-1)).toEqual(['Not saved', true]);
        vi.advanceTimersByTime(50_000);
        expect(seen.at(-1)).toEqual(['Not saved', true]);
        expect(hold.held).toBe(true);
        hold.acted(61_500);
        expect(seen.at(-1)).toEqual([null, false]);
        expect(hold.held).toBe(false);
    });

    it('the press that caused the refusal does not clear it (its event started before the telling)', () => {
        const { hold, seen } = make();
        hold.tell('Not saved', true, 2000);
        hold.acted(1990);
        hold.acted(2000);
        expect(seen.at(-1)).toEqual(['Not saved', true]);
        hold.acted(2001);
        expect(seen.at(-1)).toEqual([null, false]);
    });

    it('what an edit did goes back to the hint after DONE_MS; a later refusal is not cut by the earlier timer', () => {
        const { hold, seen } = make();
        hold.tell('Moved', false, 0);
        vi.advanceTimersByTime(DONE_MS - 1);
        expect(seen.at(-1)).toEqual(['Moved', false]);
        vi.advanceTimersByTime(1);
        expect(seen.at(-1)).toEqual([null, false]);
        hold.tell('Moved', false, 5000);
        hold.tell('Gate 2 is in a wall', true, 5100);
        vi.advanceTimersByTime(DONE_MS * 10);
        expect(seen.at(-1)).toEqual(['Gate 2 is in a wall', true]);
    });

    it('the bar clears a refusal on the next key or press; the line wraps and is never cut (lane n-save, Decision 6)', () => {
        expect(TOP).toMatch(/addEventListener\('keydown', this\.onAct, true\)/);
        // lane editfix E2: the press clears it when let go (pointerup), so the buttons do not move under it
        expect(TOP).toMatch(/addEventListener\('pointerup', this\.onAct, true\)/);
        expect(TOP).toMatch(/this\.line\.title = text/);
        expect(TOP).not.toMatch(/6000/);
        const rule = /\.ce-topbar \.ce-tb-line \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
        expect(rule).toMatch(/white-space: normal/);
        expect(rule).not.toMatch(/text-overflow: ellipsis/);
        expect(rule).toMatch(/max-width: 420px/);
    });
});

describe('editor3 I2 the flight is not in the edit view (D5, D7)', () => {
    it('every part of the flight is hidden while the mode is open and not flying', () => {
        const hidden = [...CSS.matchAll(/body:has\(\.course-editor:not\(\.ce-flying\)\) :is\(([^)]*)\)\s*\{\s*display: none !important;/g)].map((m) => m[1]!).join(', ');
        for (const q of ['.mode-chip', '.hud .osd.bl', '.hud .osd.br', '.hud .osd.tr', '.rec-bar', '.osd-stats', '.crash-overlay', '.crash-toast', '.course-hud', '.hud-note', '.gate-msg', '.next-hint']) {
            expect(hidden, q).toContain(q);
        }
        // the mode line stays
        expect(hidden).not.toMatch(/\.osd\.tl/);
    });

    it('below 500 px the Walls chip keeps its summary and its open menu is hidden in the edit view (D7)', () => {
        const i = CSS.indexOf("[data-testid='walls-more'] > :not(summary)");
        expect(i).toBeGreaterThan(0);
        expect(CSS.slice(i - 120, i)).toContain('@media (max-height: 500px) {');
        expect(CSS.slice(i - 60, i)).toContain('body:has(.course-editor:not(.ce-flying))');
    });

    it('below 500 px the top bar goes under the scene credit and the Walls summary (D7)', () => {
        expect(TOP).toMatch(/querySelectorAll\('\.attribution, \[data-testid="walls-box"\]'\)/);
        expect(TOP).toMatch(/setProperty\('--ce-below'/);
        expect(TOP).toMatch(/addEventListener\('resize', this\.place\)/);
        const m = /@media \(max-height: 500px\) \{\s*\.ce-topbar \{ top: ([^;]*);/.exec(CSS);
        expect(m?.[1]).toContain('var(--ce-below');
    });
});

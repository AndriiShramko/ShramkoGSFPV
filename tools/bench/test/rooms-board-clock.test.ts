// Release check 2 of lane race: the live board gives way to the course clock where both stand in the left column (a short
// keyboard view, course/hud.css of lane clockfix: clock 16..150 x 112..206 at 844x390, board 10..180 x 112..161, measured on
// a release build). No DOM in this test run: a few stand-in elements carry the rectangles the browser measured.
import { describe, expect, it } from 'vitest';
import { BoardView } from '../../../apps/fly/src/rooms/board-view';
import type { ViewRow } from '../../../apps/fly/src/rooms/lead';

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const box = (l: number, t: number, r: number, b: number): Rect => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t });

class El {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    className = '';
    children: El[] = [];
    textContent = '';
    offsetTop = 0;
    offsetHeight = 0;
    rect: Rect = box(0, 0, 0, 0);
    setAttribute(): void { /* not read */ }
    append(...c: El[]): void { for (const x of c) if (!this.children.includes(x)) this.children.push(x); }
    remove(): void { /* not read */ }
    closest(): null { return null; }
    getBoundingClientRect(): Rect { return this.rect; }
}

function rig(vw: number, vh: number, clock: El | null, osd: El | null = null): { view: BoardView; doc: unknown } {
    const doc = {
        createElement: () => new El(),
        querySelector: (s: string) => (s === '[data-testid=course-hud]' ? clock : s === '.osd.bl' ? osd : null),
        defaultView: { innerWidth: vw, innerHeight: vh },
    };
    const view = new BoardView(new El() as unknown as HTMLElement, doc as unknown as Document);
    return { view, doc };
}
const rows: ViewRow[] = [
    { slot: 0, place: 1, nick: 'Ann', best: '0:14.24', laps: 4, mine: true },
    { slot: 1, place: 2, nick: 'Bob', best: '0:27.30', laps: 2, mine: false },
];
const g = globalThis as { getComputedStyle?: unknown };
g.getComputedStyle = (e: El) => ({ display: e.style.display ?? '', visibility: e.style.visibility ?? '' });

describe('the live board and the course clock (lane race, release check 2)', () => {
    it('hides the board while the clock is drawn over its place (844x390 and 667x375, keyboard)', () => {
        for (const [vw, vh] of [[844, 390], [667, 375]]) {
            const clock = new El();
            clock.rect = box(16, 112, 150, 206);
            const { view } = rig(vw!, vh!, clock);
            (view.board as unknown as El).rect = box(10, 66, 167, 115);
            view.update(rows, true);
            expect(view.board.style.visibility).toBe('hidden');
            // the clock hides (the lap's own time shows): the board is back
            clock.style.display = 'none';
            view.update(rows, true);
            expect(view.board.style.visibility).toBe('');
        }
    });

    it('keeps the board where the clock stands elsewhere (1536x730: the clock at the top centre)', () => {
        const clock = new El();
        clock.rect = box(729, 120, 807, 217);
        const { view } = rig(1536, 730, clock);
        (view.board as unknown as El).rect = box(10, 66, 180, 115);
        view.update(rows, true);
        expect(view.board.style.visibility).toBe('');
        expect(view.board.style.display).toBe('');
    });

    it('on touch goes just under the telemetry line over the stick pads (667x375: line 99..115), hides when no room is left', () => {
        const osd = new El();
        osd.rect = box(16, 99, 300, 115);
        const clock = new El();
        clock.rect = box(266, 257, 401, 351); // touch: the clock at the bottom middle
        const { view } = rig(667, 375, clock, osd);
        (view.board as unknown as El).rect = box(10, 66, 167, 135);
        view.update(rows, true);
        expect(view.board.style.transform).toBe('translateY(55px)');
        expect(view.board.style.visibility).toBe('');
        // a board too tall to fit above 60 % of the height under the line hides
        const tall = rig(667, 375, null, osd).view;
        (tall.board as unknown as El).rect = box(10, 66, 167, 186);
        tall.update(rows, true);
        expect(tall.board.style.visibility).toBe('hidden');
    });

    it('keeps the board with no course clock at all', () => {
        const { view } = rig(844, 390, null);
        (view.board as unknown as El).rect = box(10, 112, 180, 161);
        view.update(rows, true);
        expect(view.board.style.visibility).toBe('');
    });
});

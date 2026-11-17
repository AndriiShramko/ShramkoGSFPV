// Lane race, L3 and L4 on the screen: the live board of best laps at the left edge under the mode line, and the lead banner
// at the top centre under the place of the lap's own time. Neither takes a pointer (nothing to close: they come and go by
// themselves) and neither reaches the middle third of the screen: the board is at most 30 % of the width wide and starts
// at the left edge under the top row (66 px: the scene author's line ends at 60 px at 844x390); the banner sits at the top
// centre between the top row and the course clock (64 px; the clock starts at 120 px, course/hud.css). Under the lap's time
// it would cover the clock block at 1280x720 (142 to 239 px) and the middle third: measured by tools/bench/src/rooms-board.ts
// MODE=r2, evidence/2026-11-17/rooms-board.json, run 1.
// The rows change places with a short move (MOVE_MS), so the eye sees who went up.
import { MOVE_MS } from './lead';
import type { ViewRow } from './lead';
import { slotCss } from './remote-stage';

const BOARD_CSS = 'position:absolute;left:max(10px,env(safe-area-inset-left));' +
    'top:calc(max(14px,env(safe-area-inset-top)) + var(--banner-h,0px) + 52px);' +
    'width:max-content;max-width:min(230px,30vw);pointer-events:none;' +
    'font:600 13px/1.25 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.5);border-radius:8px;padding:4px 6px;';
const ROW_CSS = 'display:grid;grid-template-columns:1.4em minmax(0,1fr) auto auto;gap:0 8px;align-items:baseline;' +
    'padding:2px 4px;border-radius:5px;white-space:nowrap;will-change:transform;';
const BANNER_CSS = 'position:absolute;left:50%;top:calc(max(14px,env(safe-area-inset-top)) + var(--banner-h,0px) + 50px);' +
    'transform:translateX(-50%);pointer-events:none;max-width:min(44vw,640px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
    'font:700 clamp(13px,3vh,26px)/1.25 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);' +
    'padding:4px 14px;border-radius:999px;';

export class BoardView {
    readonly board: HTMLElement;
    readonly banner: HTMLElement;
    private readonly rows = new Map<number, HTMLElement>();
    private key = '';

    constructor(parent: HTMLElement, private readonly doc: Document = document) {
        this.board = doc.createElement('div');
        this.board.className = 'rooms-board';
        this.board.dataset.testid = 'rooms-board';
        this.board.style.cssText = BOARD_CSS;
        this.board.style.display = 'none';
        this.banner = doc.createElement('div');
        this.banner.className = 'rooms-lead';
        this.banner.dataset.testid = 'rooms-lead';
        this.banner.setAttribute('aria-hidden', 'true');
        this.banner.style.cssText = BANNER_CSS;
        this.banner.style.display = 'none';
        parent.append(this.board, this.banner);
    }

    /** The board of this frame; `shown` false hides it. Rows that moved glide from their old place to the new one. */
    update(list: readonly ViewRow[], shown: boolean): void {
        this.board.style.display = shown && list.length > 0 ? '' : 'none';
        if (!shown) return;
        const key = JSON.stringify(list);
        if (key === this.key) return;
        this.key = key;
        const before = new Map<number, number>();
        for (const [slot, el] of this.rows) before.set(slot, el.offsetTop);
        const keep = new Set<number>();
        for (const r of list) {
            keep.add(r.slot);
            let el = this.rows.get(r.slot);
            if (!el) {
                el = this.doc.createElement('div');
                el.style.cssText = ROW_CSS;
                el.dataset.slot = String(r.slot);
                for (let i = 0; i < 4; i++) el.append(this.doc.createElement('span'));
                this.rows.set(r.slot, el);
            }
            const [place, nick, best, laps] = [...el.children] as HTMLElement[];
            place!.textContent = r.place === null ? '' : String(r.place);
            nick!.textContent = r.nick;
            nick!.style.cssText = `color:${slotCss(r.slot)};overflow:hidden;text-overflow:ellipsis;`;
            best!.textContent = r.best;
            best!.style.fontVariantNumeric = 'tabular-nums';
            laps!.textContent = String(r.laps);
            laps!.style.cssText = 'opacity:.75;font-variant-numeric:tabular-nums;';
            el.dataset.mine = r.mine ? '1' : '0';
            el.style.background = r.mine ? 'rgba(255,255,255,.18)' : 'transparent';
            el.style.outline = r.mine ? '1px solid rgba(255,255,255,.55)' : 'none';
            this.board.append(el);
        }
        for (const [slot, el] of this.rows) {
            if (keep.has(slot)) continue;
            el.remove();
            this.rows.delete(slot);
        }
        // the move: each row that changed place starts where it was and glides to its new place
        for (const [slot, el] of this.rows) {
            const was = before.get(slot);
            if (was === undefined) continue;
            const dy = was - el.offsetTop;
            if (dy === 0) continue;
            el.style.transition = 'none';
            el.style.transform = `translateY(${dy}px)`;
            void el.offsetHeight;
            el.style.transition = `transform ${MOVE_MS}ms ease-out`;
            el.style.transform = '';
        }
    }

    /** The banner's text of this frame, null hides it; the pilot's own takeover is green. */
    lead(text: string | null, mine: boolean, shown: boolean): void {
        if (text === null || !shown) {
            this.banner.style.display = 'none';
            return;
        }
        if (this.banner.textContent !== text) this.banner.textContent = text;
        this.banner.style.color = mine ? '#5dff7a' : '#fff';
        this.banner.dataset.mine = mine ? '1' : '0';
        this.banner.style.display = '';
    }

    dispose(): void {
        this.board.remove();
        this.banner.remove();
        this.rows.clear();
    }
}

/** A short rising blip for a lead change in an ordinary flight (no sound mode); never awaited, never in the way. */
let ac: AudioContext | null = null;
export function leadBlip(mine: boolean): void {
    try {
        const C = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
        if (!C) return;
        ac ??= new C();
        if (ac.state === 'suspended') void ac.resume().catch(() => undefined);
        const t0 = ac.currentTime;
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'triangle';
        // estimate: two short notes a fifth apart (own lead) or a fourth (another pilot's), 0.18 s in all, quiet
        o.frequency.setValueAtTime(660, t0);
        o.frequency.setValueAtTime(mine ? 990 : 880, t0 + 0.09);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        o.connect(g).connect(ac.destination);
        o.start(t0);
        o.stop(t0 + 0.2);
    } catch {
        // no sound on this system: the banner says it
    }
}

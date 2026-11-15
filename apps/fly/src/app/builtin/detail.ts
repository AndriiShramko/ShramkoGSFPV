// The detail line (lane loadq, the owner's message 58, decisions G1 to G3, docs/wip/loadq.md): one line where the walls
// line lives (on the credit, bottom left) that says what the page does with the scan's detail: still coming (how much
// of the setting, files to go, about how long), full for the setting (a few seconds, then it hides), or what holds it
// back: the frame rate keeper (with one press to let it choose), no finer level in the scan, files that did not arrive
// (trying again; after the last try one press asks them again). A pilot who never set the splat budget by hand sees it
// only for files that did not arrive (G4). The rule and the texts: app/detail-rule.ts, i18n detail.*.
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import type { Feature, FlightContext } from '../context';
import { detailLine, detailState, detailVisible } from '../detail-rule';
import type { DetailInput, DetailState } from '../detail-rule';

/** How often the line is computed again, ms. */
const TICK_MS = 500;

function input(ctx: FlightContext): DetailInput {
    const s = ctx.renderer.streamStats();
    const g = ctx.quality.governor;
    return {
        handSet: ctx.quality.handSet && !ctx.quality.cinema,
        released: ctx.quality.released,
        keeperSlow: ctx.quality.pinned && ctx.quality.keeperSlow,
        step: g.step,
        topM: g.topBudgetMillions,
        budgetM: ctx.renderer.splatBudgetMillions,
        drawnM: ctx.renderer.lodState().drawn / 1e6,
        pending: s.pending,
        retrying: s.retrying,
        givenUp: s.givenUp,
        filesPerSec: s.filesPerSec,
        still: ctx.quality.stillBudgetMillions > 0
    };
}

export const detail: Feature = {
    id: 'detail',
    install(ctx) {
        const text = h('span', { 'data-testid': 'detail-text' });
        const btn = h('button', { type: 'button', class: 'btn', 'data-action': 'detail-press', hidden: true, style: 'margin-left: 8px; padding: 1px 8px' }) as HTMLButtonElement;
        const line = h('div', { 'data-testid': 'detail-line', class: 'interactive', hidden: true, style: 'margin-top: 2px' }, text, btn);
        const credit = ctx.ui.querySelector('[data-testid="attribution"]');
        (credit ?? ctx.ui).append(line);
        let state: DetailState = 'hidden';
        let since = 0;
        let action: 'release' | 'retry' | null = null;
        btn.addEventListener('click', () => {
            if (action === 'release') ctx.quality.release();
            if (action === 'retry') ctx.renderer.retryFailedFiles();
            update();
        });
        function update(): void {
            const i = input(ctx);
            const s = detailState(i);
            const now = performance.now();
            if (s !== state) { state = s; since = now; }
            const l = detailLine(s, i, t);
            const show = detailVisible(s, since, now);
            line.hidden = !show;
            if (text.textContent !== l.text) text.textContent = l.text;
            action = l.action;
            btn.hidden = !show || l.action === null;
            if (btn.textContent !== l.actionText) btn.textContent = l.actionText;
        }
        const timer = setInterval(update, TICK_MS);
        ctx.hook.detail = () => ({ state, shown: !line.hidden, text: text.textContent ?? '', action, stream: ctx.renderer.streamStats(), pinned: ctx.quality.pinned, released: ctx.quality.released, keeperSlow: ctx.quality.keeperSlow });
        return () => { clearInterval(timer); line.remove(); };
    }
};

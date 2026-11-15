// Lane loadq G1 and G2 (apps/fly/src/app/detail-rule.ts): a budget the pilot set by hand is not lowered by the frame
// rate keeper (the governor), and the detail line's text for each state.
import { describe, expect, it } from 'vitest';
import { detailLine, detailState, detailVisible, drawPlan, FULL_SHOW_MS } from '../../../apps/fly/src/app/detail-rule';
import type { DetailInput } from '../../../apps/fly/src/app/detail-rule';

const say = (k: string, v?: Record<string, string | number>): string => (v ? `${k} ${JSON.stringify(v)}` : k);

const base: DetailInput = {
    handSet: true, released: false, keeperSlow: false, step: 0, topM: 16, budgetM: 16, drawnM: 6.2,
    pending: 14, retrying: 0, givenUp: 0, filesPerSec: 0.7
};

describe('G1: a hand-set budget is kept', () => {
    const at = { userMaxScale: 1, presetScale: 1, settingBudgetM: 16, stepScale: 0.5, stepBudgetM: 6 };
    it('the keeper at its lowest step does not lower a pinned budget or resolution', () => {
        expect(drawPlan({ ...at, pinned: true })).toEqual({ scale: 1, budgetM: 16 });
    });
    it('not pinned (auto, or let go): the keeper lowers as before', () => {
        expect(drawPlan({ ...at, pinned: false })).toEqual({ scale: 0.5, budgetM: 6 });
    });
});

describe('G2: the detail line', () => {
    it('coming: drawn of the setting, files to go and about how long', () => {
        const s = detailState(base);
        expect(s).toBe('coming');
        expect(detailLine(s, base, say).text).toBe('detail.coming {"drawn":"6.2","top":"16","files":14,"secs":20}');
        expect(detailLine(s, { ...base, filesPerSec: 0 }, say).text).toBe('detail.comingStart {"drawn":"6.2","top":"16","files":14}');
    });
    it('full for the setting, shown a few seconds then hidden; no finer level when less is drawn with nothing to come', () => {
        const full = { ...base, pending: 0, drawnM: 15.59 };
        expect(detailState(full)).toBe('full');
        expect(detailLine('full', full, say).text).toBe('detail.full');
        expect(detailVisible('full', 0, FULL_SHOW_MS - 1)).toBe(true);
        expect(detailVisible('full', 0, FULL_SHOW_MS)).toBe(false);
        expect(detailState({ ...full, drawnM: 9 })).toBe('nofiner');
    });
    it('held by the keeper: says so and offers to let the page choose; after the press: lowered', () => {
        const kept = { ...base, keeperSlow: true, step: 4 };
        expect(detailState(kept)).toBe('kept');
        const l = detailLine('kept', kept, say);
        expect(l.text).toBe('detail.kept');
        expect(l.action).toBe('release');
        expect(l.actionText).toBe('detail.release');
        const low = { ...kept, released: true, budgetM: 6, drawnM: 5.7 };
        expect(detailState(low)).toBe('lowered');
        expect(detailLine('lowered', low, say).text).toBe('detail.lowered {"drawn":"5.7","top":"16"}');
    });
    it('network: trying again, then the Try again press; for every pilot', () => {
        const net = { ...base, handSet: false, retrying: 12 };
        expect(detailState(net)).toBe('network');
        expect(detailLine('network', net, say).text).toBe('detail.network {"files":12}');
        const gone = { ...net, givenUp: 3 };
        expect(detailState(gone)).toBe('givenup');
        expect(detailLine('givenup', gone, say)).toEqual({ text: 'detail.givenup {"files":3}', action: 'retry', actionText: 'detail.retry' });
    });
    it('G4: a pilot who never set the budget sees nothing while detail streams', () => {
        expect(detailState({ ...base, handSet: false })).toBe('hidden');
        expect(detailVisible('hidden', 0, 0)).toBe(false);
    });
});

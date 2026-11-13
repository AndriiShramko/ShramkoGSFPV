// Lane look L2 (finding TR-11): the course's lap block never starts inside the flash note's slot (apps/fly/src/course/hud.ts
// and course/note-slot.ts pushUnderNote). The page check is tools/bench/src/tracks-page.ts hintClearOfTimer; this is the arithmetic only.
import { describe, expect, it } from 'vitest';
import { NOTE_GAP_PX, pushUnderNote } from '../../../apps/fly/src/course/note-slot';

describe('course hud: the lap block under the note', () => {
    it('a note moved under the buttons (1366x768: note 86..136, block at 120) pushes the block below it', () => {
        const push = pushUnderNote({ top: 86, bottom: 136 }, { top: 120, bottom: 200 }, 0);
        expect(120 + push).toBeGreaterThanOrEqual(136 + NOTE_GAP_PX);
    });
    it('a note above the block (1920x1080: note 44..90, block at 120) does not move it', () => {
        expect(pushUnderNote({ top: 44, bottom: 90 }, { top: 120, bottom: 200 }, 0)).toBe(0);
    });
    it('the push is held when the note hides or is shorter, so the block stays in place', () => {
        const held = pushUnderNote({ top: 86, bottom: 150 }, { top: 120, bottom: 200 }, 0);
        expect(pushUnderNote(null, { top: 120, bottom: 200 }, held)).toBe(held);
        expect(pushUnderNote({ top: 86, bottom: 100 }, { top: 120, bottom: 200 }, held)).toBe(held);
        expect(pushUnderNote({ top: 0, bottom: 0 }, { top: 120, bottom: 200 }, held)).toBe(held);
    });
    it('review LK-1: a block hidden by H (display none, its box all zeros) under the "text off" note keeps its push', () => {
        // 1366x768, note under the buttons: 86..135.7 (evidence/2026-11-13/train1c/tracks-page.json)
        expect(pushUnderNote({ top: 86, bottom: 135.7 }, { top: 0, bottom: 0 }, 0)).toBe(0);
        expect(pushUnderNote({ top: 86, bottom: 135.7 }, { top: 0, bottom: 0 }, 22)).toBe(22);
    });
});

// Lane look L2 (finding TR-11): the course's lap block (course/hud.ts) never starts inside the flash note's slot. Plain
// arithmetic on two boxes, no DOM, so the unit test (tools/bench/test/course-hud-note.test.ts) imports it without a page.

/** px between the bottom of the flash note and the top of the lap block (a layout choice, not a measurement) */
export const NOTE_GAP_PX = 6;

/**
 * How far the lap block must move down so that it starts NOTE_GAP_PX under the note, from both boxes as they stand with no
 * push; never less than the push held before, so the block does not jump back up when the note hides.
 */
export function pushUnderNote(note: { top: number; bottom: number } | null, block: { top: number }, held: number): number {
    if (!note || note.bottom <= note.top) return held;
    return Math.max(held, Math.ceil(note.bottom + NOTE_GAP_PX - block.top));
}

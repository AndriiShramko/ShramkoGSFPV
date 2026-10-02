/**
 * Background loops of the landing: 12 s each, cut from three flights the owner recorded in the
 * simulator on 2 October 2026 (2160×1080, 60 fps), one per block. `start`: the second of the
 * recording the loop begins at (its last 0.6 s cross-fade back into its first 0.6 s, so it loops
 * without a jump). Each scan is Andrii Shramko's, CC BY 4.0; the page credits it next to the video.
 * Cut and encoded by scripts/encode-videos.sh; which files exist: scripts/media.mjs.
 */
export const VIDEOS = {
  /** Tunis old town: along the mud-brick walls between the palms. */
  hero: { clip: "tunis", scene: "887f27aa", start: 12 },
  /** Winter Garden, Poland: between the chairs, along the glass wall and the plants. */
  locations: { clip: "garden", scene: "7a475d38", start: 1 },
  /** Modlinek Villa: round the tulips, then low under the table between the chair legs. */
  scale: { clip: "villa", scene: "39e63ce9", start: 41.5 },
} as const;

export type VideoSlot = keyof typeof VIDEOS;

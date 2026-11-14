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
  /** The Fly by Sound page, behind its first screen: the same Winter Garden loop (the scan of a sound lesson). */
  soundHero: { clip: "garden", scene: "7a475d38", start: 1 },
} as const;

export type VideoSlot = keyof typeof VIDEOS;

/**
 * Loops of the owner's REAL FPV flights (a drone in the air, not the simulator), Bydgoszcz, cut as 12 s seamless loops for his
 * FPV lecture deck (talks/fpv/deck_public/media of shramko-immersive-warsaw-2026); cropped to 2:1 and encoded by
 * scripts/encode-flight-videos.sh. Behind blocks of the Fly by Sound page.
 */
export const FLIGHTS = {
  /** Low over a pond with reflections in a park (deck slide 4). */
  soundHow: { clip: "pond", source: "s04_fpv_view.mp4" },
  /** Up a spruce, a full roll, a dive to a path and into the trees (deck slide 10). */
  soundStart: { clip: "acro", source: "s10_acro_flip.mp4" },
} as const;

export type FlightSlot = keyof typeof FLIGHTS;

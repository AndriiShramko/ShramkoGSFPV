// A recording lesson by lesson (v0.12, docs/wip/v12-int.md step 5). A recording usually spans several lessons; the
// sound package's replay core runs one lesson, so a package is cut at its `lesson open` events and each piece is
// replayed against its own lesson and world (replay-check.ts, replay-player.ts), on the package's one clock with its one
// voice. The cutting lives in the sound package (src/replay/segments.ts, moved there by train 1 lane voice so that the
// package's analysis tool `pnpm analyze` cuts a recording the same way); this module keeps the simulator's import path.
export { lessonSegments } from '@shramko/sonic-fpv';
export type { LessonSegment, SegmentedPackage } from '@shramko/sonic-fpv';

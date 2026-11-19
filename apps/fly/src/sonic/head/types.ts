// The named types between the head-tracking switch (switch.ts, always on a sound page, tiny) and the lazy tracking module
// (tracking.ts and what it loads). Types only: importing this file loads no code.
import type { ListenerLike } from './listener-turn';
import type { HeadPose } from './pose';

/** How a start of the camera ended: 'on', or why not (each has a spoken line that says what to do). */
export type HeadResult = 'on' | 'denied' | 'no-camera' | 'busy' | 'unsupported' | 'failed';

/** The spoken lines of head tracking: packages/i18n/locales/fly/sonichead, key `sonichead.say.<id>`. */
export type HeadLineId = 'ask' | 'loading' | 'on' | 'off' | 'keyOff' | 'centred' | 'lost' | Exclude<HeadResult, 'on'>;

/** The part of navigator.mediaDevices this uses. */
export interface MediaLike {
    getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
}

/**
 * The face tracker (stage H3: MediaPipe Face Landmarker in a worker). It reads the stream's pictures inside the browser and
 * calls `onFace` once per picture with the head's raw pose (null: no face in that picture) and the picture's time in ms on
 * performance.now()'s clock. Only these numbers come out: no picture is kept, drawn or sent.
 */
export interface HeadTracker {
    start(stream: MediaStream, onFace: (raw: HeadPose | null, tMs: number) => void): Promise<void>;
    stop(): void;
}

/** What the tracking module needs of the page. */
export interface HeadTrackingDeps {
    readonly media: () => MediaLike | null;
    readonly tracker: () => Promise<HeadTracker>;
    /** the AudioListener the sound plays to and its audio time, null before the sound started */
    readonly listener: () => { readonly listener: ListenerLike; readonly now: number } | null;
    readonly say: (id: HeadLineId, o?: { readonly interrupt?: boolean }) => Promise<void>;
    /** the narrator is on: the "head lost" line is said only then (off is sounds only) */
    readonly narrator: () => boolean;
}

/** The tracking module as the switch drives it. */
export interface HeadTrackingLike {
    readonly running: boolean;
    start(): Promise<HeadResult>;
    stop(): void;
    recentre(): void;
}

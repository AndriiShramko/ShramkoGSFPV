// Head tracking while it is on (lane head4): the camera stream, the face tracker reading it, the pose filter (filter.ts:
// smoothing, centre, the lost face held then glided back) and the turn of the page's AudioListener (listener-turn.ts), once
// per tracker result. Loaded only by switch.ts when the pilot turned "Turn my head to listen" on (a lazy import).
//
// Camera pictures never leave the browser: the stream goes to the tracker, which returns three angles a picture; nothing
// here keeps, draws or sends a picture, and nothing of it enters Fly by Sound's recordings.
import { HeadPoseFilter } from './filter';
import { ListenerTurn } from './listener-turn';
import type { ListenerLike } from './listener-turn';
import type { HeadPose } from './pose';
import type { HeadResult, HeadTracker, HeadTrackingDeps, HeadTrackingLike } from './types';

/** The front camera at a small size: the tracker needs no more, and a small picture costs less. No microphone. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
    audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
};

/** ms after which a tracker still loading is said to be loading */
export const LOADING_LINE_MS = 1000;

/** Why getUserMedia refused, from its DOMException name (each has its own spoken way on). */
export function cameraRefusal(e: unknown): Exclude<HeadResult, 'on'> {
    const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
    switch (name) {
        case 'NotAllowedError':
        case 'SecurityError':
            return 'denied';
        case 'NotFoundError':
        case 'OverconstrainedError':
            return 'no-camera';
        case 'NotReadableError':
        case 'AbortError':
            return 'busy';
        case 'TypeError':
            return 'unsupported';
        default:
            return 'failed';
    }
}

function stopStream(s: MediaStream): void {
    for (const track of s.getTracks()) track.stop();
}

export class HeadTracking implements HeadTrackingLike {
    private stream: MediaStream | null = null;
    private tracker: HeadTracker | null = null;
    private filter = new HeadPoseFilter();
    private turn: ListenerTurn | null = null;
    private turnOf: ListenerLike | null = null;
    /** counts starts and stops: a start that a stop overtook closes its own camera */
    private gen = 0;
    private centreAsked = false;

    constructor(private readonly d: HeadTrackingDeps) {}

    get running(): boolean {
        return this.stream !== null;
    }

    /** the ears' pose now (straight ahead while off) */
    get pose(): HeadPose {
        return this.filter.pose;
    }

    async start(): Promise<HeadResult> {
        if (this.stream) return 'on';
        const media = this.d.media();
        if (!media) return 'unsupported';
        const gen = ++this.gen;
        let stream: MediaStream;
        try {
            stream = await media.getUserMedia(CAMERA_CONSTRAINTS);
        } catch (e) {
            return cameraRefusal(e);
        }
        if (gen !== this.gen) {
            stopStream(stream);
            return 'failed';
        }
        // the first start downloads the tracker (about 8 MB): past a second the pilot hears that it is loading
        const slow = setTimeout(() => {
            if (gen === this.gen) void this.d.say('loading', { interrupt: false });
        }, LOADING_LINE_MS);
        try {
            this.tracker ??= await this.d.tracker();
            // a fresh filter: the first face seen is straight ahead
            this.filter = new HeadPoseFilter();
            await this.tracker.start(stream, (raw, tMs) => this.face(raw, tMs));
        } catch {
            stopStream(stream);
            return 'failed';
        } finally {
            clearTimeout(slow);
        }
        if (gen !== this.gen) {
            this.tracker.stop();
            stopStream(stream);
            return 'failed';
        }
        this.stream = stream;
        return 'on';
    }

    /** the camera off, the tracker stopped, the ears straight ahead at once */
    stop(): void {
        this.gen++;
        this.tracker?.stop();
        if (this.stream) stopStream(this.stream);
        this.stream = null;
        const l = this.d.listener();
        if (this.turn && l && l.listener === this.turnOf) this.turn.release(l.now);
        this.filter = new HeadPoseFilter();
    }

    /** the next face seen is straight ahead; "Centred" is said when it is */
    recentre(): void {
        this.centreAsked = true;
        this.filter.recentre();
    }

    /** one tracker result: the filter steps, the listener turns, a lost face is said once */
    private face(raw: HeadPose | null, tMs: number): void {
        if (!this.stream) return;
        const s = this.filter.step(raw, tMs);
        const l = this.d.listener();
        if (l) {
            // a new AudioContext (the sound restarted) has a new listener: turn that one
            if (l.listener !== this.turnOf || !this.turn) {
                this.turn = new ListenerTurn(l.listener);
                this.turnOf = l.listener;
            }
            this.turn.apply(s.pose, l.now);
        }
        if (s.event === 'lost' && this.d.narrator()) void this.d.say('lost', { interrupt: false });
        if (s.event === 'centred' && this.centreAsked) {
            this.centreAsked = false;
            void this.d.say('centred', { interrupt: true });
        }
    }
}

/** The module's door for switch.ts. */
export function createHeadTracking(d: HeadTrackingDeps): HeadTrackingLike {
    return new HeadTracking(d);
}

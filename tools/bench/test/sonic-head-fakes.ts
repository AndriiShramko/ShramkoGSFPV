// Stand-ins for head tracking's page (lane head4): a camera, a face tracker, the browser's permission and visibility, the voice
// and the AudioListener, each recording what it was asked, in one log, so a test reads the order (said first, then asked).
import { HeadSwitch } from '../../../apps/fly/src/sonic/head/switch';
import type { CameraPermission } from '../../../apps/fly/src/sonic/head/switch';
import type { HeadLineId, HeadTracker, HeadTrackingDeps } from '../../../apps/fly/src/sonic/head/types';
import type { ListenerLike, ParamLike } from '../../../apps/fly/src/sonic/head/listener-turn';
import type { HeadPose } from '../../../apps/fly/src/sonic/head/pose';
import type { SonicHost } from '../../../apps/fly/src/sonic/store';

export class FakeParam implements ParamLike {
    value = 0;
    target = 0;
    setTargetAtTime(v: number): void {
        this.target = v;
    }
    cancelScheduledValues(): void {
        /* nothing scheduled in the stand-in */
    }
}

export function fakeListener(): ListenerLike & Record<'forwardX' | 'forwardY' | 'forwardZ' | 'upX' | 'upY' | 'upZ', FakeParam> {
    return { forwardX: new FakeParam(), forwardY: new FakeParam(), forwardZ: new FakeParam(), upX: new FakeParam(), upY: new FakeParam(), upZ: new FakeParam() };
}

export class FakeTrack {
    stopped = false;
    stop(): void {
        this.stopped = true;
    }
}

export class FakeDoc {
    visibilityState: DocumentVisibilityState = 'visible';
    private readonly cbs: (() => void)[] = [];
    addEventListener(_type: string, cb: () => void): void {
        this.cbs.push(cb);
    }
    removeEventListener(_type: string, cb: () => void): void {
        const i = this.cbs.indexOf(cb);
        if (i >= 0) this.cbs.splice(i, 1);
    }
    set(v: DocumentVisibilityState): void {
        this.visibilityState = v;
        for (const cb of [...this.cbs]) cb();
    }
}

export interface HeadRig {
    readonly head: HeadSwitch;
    /** in order: 'say:<id>', 'gum' (the camera asked), 'load' (the lazy module), 'tracker.start', 'tracker.stop' */
    readonly log: string[];
    readonly tracks: FakeTrack[];
    readonly listener: ReturnType<typeof fakeListener>;
    readonly doc: FakeDoc;
    /** the tracker's next result (null: no face) at `tMs` */
    face(raw: HeadPose | null, tMs: number): void;
    /** what the camera does next: a DOMException name refuses, null opens */
    camera: { refuse: string | null };
    permission: CameraPermission;
    narrator: boolean;
    /** the sound started: the listener is there */
    audio: boolean;
    /** what the tracker posts out: everything it handed to onFace */
    readonly results: unknown[][];
}

export function headRig(host: SonicHost, o: { load?: HeadTrackingDeps['tracker'] } = {}): HeadRig {
    const log: string[] = [];
    const tracks: FakeTrack[] = [];
    const listener = fakeListener();
    const doc = new FakeDoc();
    const results: unknown[][] = [];
    let onFace: ((raw: HeadPose | null, tMs: number) => void) | null = null;
    const tracker: HeadTracker = {
        async start(_stream, cb) {
            log.push('tracker.start');
            onFace = cb;
        },
        stop() {
            log.push('tracker.stop');
            onFace = null;
        }
    };
    const rig: HeadRig = {
        head: null as unknown as HeadSwitch,
        log,
        tracks,
        listener,
        doc,
        results,
        face: (raw, tMs) => {
            results.push([raw, tMs]);
            onFace?.(raw, tMs);
        },
        camera: { refuse: null },
        permission: 'prompt',
        narrator: true,
        audio: true
    };
    const say = async (id: HeadLineId): Promise<void> => {
        log.push(`say:${id}`);
    };
    (rig as { head: HeadSwitch }).head = new HeadSwitch({
        host,
        say,
        permission: async () => rig.permission,
        load: async () => {
            log.push('load');
            return import('../../../apps/fly/src/sonic/head/tracking');
        },
        doc: doc as unknown as Document,
        media: () => ({
            getUserMedia: async () => {
                log.push('gum');
                if (rig.camera.refuse !== null) throw Object.assign(new Error(rig.camera.refuse), { name: rig.camera.refuse });
                const t = new FakeTrack();
                tracks.push(t);
                return { getTracks: () => [t] } as unknown as MediaStream;
            }
        }),
        tracker: o.load ?? (async () => tracker),
        listener: () => (rig.audio ? { listener, now: 0 } : null),
        narrator: () => rig.narrator
    });
    return rig;
}

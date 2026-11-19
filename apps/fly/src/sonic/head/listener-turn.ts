// Turns the page's AudioListener with the pilot's head (lane head4). The sound package builds its graph with the
// listener at the origin, forward -Z, up +Y, and places every voice's HRTF panner in that craft listener frame; it never
// writes the listener again. Turning the listener by the head pose makes every panner sound where it is in the world
// while the head turns, with one transform for everything (Cat3DA rotates its whole scene for the same reason).
//
// Known limit (docs/wip/head4.md, For the lead): the package's extra level difference between the ears (the ILD boost of
// near hazards, the beacon's and the line's side level) is set by the craft-frame side, not the head's. The design's
// per-voice rotation inside the package (an optional headPose in SonicFrameInput) would turn that too; it is the sound
// package's change to make.

import { headAxes, STRAIGHT, type HeadPose } from './pose';

/** The part of an AudioParam this needs. */
export interface ParamLike {
    value: number;
    setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
    cancelScheduledValues(startTime: number): unknown;
}

/** The part of an AudioListener this writes. */
export interface ListenerLike {
    readonly forwardX: ParamLike;
    readonly forwardY: ParamLike;
    readonly forwardZ: ParamLike;
    readonly upX: ParamLike;
    readonly upY: ParamLike;
    readonly upZ: ParamLike;
}

/** s: how fast the listener follows a new pose; the tracker sends about 30 poses a second, the panners glide at 0.03 s. */
export const LISTENER_GLIDE_S = 0.015;

export class ListenerTurn {
    private last: HeadPose = STRAIGHT;

    constructor(private readonly listener: ListenerLike) {}

    get pose(): HeadPose {
        return this.last;
    }

    /** turn the listener to `pose` from audio time `now` */
    apply(pose: HeadPose, now: number): void {
        this.last = pose;
        for (const [p, v] of this.targets(pose)) p.setTargetAtTime(v, now, LISTENER_GLIDE_S);
    }

    /** back to the package's own listener (straight ahead) at once: head tracking switched off */
    release(now: number): void {
        this.last = STRAIGHT;
        for (const [p, v] of this.targets(STRAIGHT)) {
            p.cancelScheduledValues(now);
            p.value = v;
        }
    }

    private targets(pose: HeadPose): readonly (readonly [ParamLike, number])[] {
        const a = headAxes(pose);
        const l = this.listener;
        return [
            [l.forwardX, a.forward[0]], [l.forwardY, a.forward[1]], [l.forwardZ, a.forward[2]],
            [l.upX, a.up[0]], [l.upY, a.up[1]], [l.upZ, a.up[2]]
        ];
    }
}

// v0.13 v13-int step 5 (docs/wip/v13-int.md; v13-host stage C's open item): "Reset my progress" on the start screen shown over a
// running lesson. The screen clears every lesson's saved progress (store.ts resetProgress), but the runner of the lesson under it still
// held that lesson's old counts and saved them back at its next attempt (or when it was left), so that lesson was not new. Now the
// screen tells the flight page (bind's onReset) and the lesson host forgets that runner's counts (LessonHost.progressReset): it saves
// nothing more, and the lesson starts again from nothing when the screen is closed (restartAfterReset) or another lesson opens.
// Flown on the lesson rig (the real flight model, lesson pilot, mode, bridge, host and the package's runner): rings-first to one counted
// attempt, the reset, then the flight going on.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLesson } from '../../../packages/sonic-fpv/src';
import { resetProgress, savedProgress } from '../../../apps/fly/src/sonic/store';
import { Rig } from './sonic-lesson-rig';
import type { Control } from './sonic-lesson-rig';

/** sonic-int-replay's rings pilot: it listens to the task, then flies through the gate at 3 m. */
const throughTheGate: Control = (r) => ({ forward: 1, lift: Math.max(-0.4, Math.min(0.4, (3 - r.pos[1]) * 0.8)) });
const listenThenFly: Control = (r) => (r.host.runner?.phase === 'intro' ? null : throughTheGate(r));

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
    vi.restoreAllMocks();
});

const ID = 'rings-first';
const counted = (r: Rig): number => savedProgress(r.store, ID)?.successes ?? 0;

/** rings-first opened and flown to its first counted attempt (saved), then "Reset my progress" answered Yes over it. */
async function resetOverARunningLesson(o: { tell: boolean }): Promise<{ r: Rig; before: number }> {
    const r = (rig = await Rig.make(getLesson(ID)));
    expect(await r.host.open(ID)).toBe(true);
    await r.run(180000, listenThenFly, () => counted(r) >= 1);
    const before = counted(r);
    expect(before).toBeGreaterThanOrEqual(1);
    // the start screen's Yes: the saved progress cleared, and (the fix) the flight page told
    resetProgress(r.store);
    if (o.tell) r.host.progressReset();
    expect(savedProgress(r.store, ID)).toBeNull();
    return { r, before };
}

describe('v13-int step 5: "Reset my progress" over a running lesson makes that lesson new too', () => {
    it('closed with Escape or Back: the lesson starts again from nothing, and its next counted attempt is the first one saved', async () => {
        const { r } = await resetOverARunningLesson({ tell: true });
        const old = r.host.runner;
        expect(await r.host.restartAfterReset()).toBe(true);
        expect(r.host.runner).not.toBe(old);
        expect(r.host.lesson?.id).toBe(ID);
        expect(r.host.runner!.progress()).toMatchObject({ attempts: 0, successes: 0, passed: false });
        await r.run(180000, listenThenFly, () => counted(r) >= 1);
        expect(savedProgress(r.store, ID)).toMatchObject({ successes: 1, passed: false });
        // nothing more to restart once it is the pilot's again
        expect(await r.host.restartAfterReset()).toBe(false);
    }, 600000);

    it('another lesson chosen on the screen: the lesson left saves nothing of its old counts, nor does an attempt it counts before that', async () => {
        const { r, before } = await resetOverARunningLesson({ tell: true });
        // (the flight waits under the screen; flown on here all the same) the old runner counts one more, and saves nothing of it
        await r.run(180000, listenThenFly, () => (r.host.runner?.progress().successes ?? 0) > before);
        expect(r.host.runner!.progress().successes).toBe(before + 1);
        expect(savedProgress(r.store, ID)).toBeNull();
        expect(await r.host.open('rings-line')).toBe(true);
        expect(savedProgress(r.store, ID)).toBeNull();
    }, 600000);

    it('control: the reset not told to the flight page (as before this step): the runner under the screen saves its old counts back at its next counted attempt, and when it is left', async () => {
        const { r, before } = await resetOverARunningLesson({ tell: false });
        // the screen closed: nothing restarts, the old runner flies on
        expect(await r.host.restartAfterReset()).toBe(false);
        await r.run(180000, listenThenFly, () => counted(r) >= 1);
        expect(counted(r)).toBe(before + 1);
        resetProgress(r.store);
        expect(await r.host.open('rings-line')).toBe(true);
        expect(counted(r)).toBe(before + 1);
    }, 600000);
});

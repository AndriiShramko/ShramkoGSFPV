// Lane tutor-air (train 4), S4: found by the page acceptance (tutor-air-accept.mjs, words60: 67 words before the first movement).
// A page that teaches by moments (a MomentHost, the narrator on) names the keys once, in the first moment (sonic.say.momentKeys), then
// on K only (plan Part C 3): the line of keys at a lesson's start ("Next, key N. Back, key B. ...", 15 words) is not said, so nothing
// but the headphone check comes before the first movement (decision 2). A page without a MomentHost, or with the narrator off, says
// it as before (the control).
import { afterEach, describe, expect, it } from 'vitest';
import { getLesson } from '../../../packages/sonic-fpv/src';
import { MomentHost } from '../../../apps/fly/src/sonic/moment-host';
import { Rig } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
});

const isKeysLine = (key: string): boolean => key === 'sonic.say.lessonKeys' || key === 'sonic.say.lessonKeysFree';
const moments = (): MomentHost => new MomentHost({ pause: () => undefined, resume: () => undefined }, { setAudible: () => undefined });

/** The headphone check walked to its questions (N, then the answers), then walls-hall opened up to its Go: the lines said. */
async function firstMinute(o: { moments: boolean; narratorOff?: boolean }): Promise<string[]> {
    rig = await Rig.make(getLesson('ears-headphones'), o.moments ? { moments: moments() } : {});
    rig.narratorOff = o.narratorOff === true;
    const said: string[] = [];
    rig.engine.onSpeech = (line) => said.push(line.key);
    expect(await rig.host.open('ears-headphones')).toBe(true);
    await rig.run(6000, null);
    for (let i = 0; i < 3; i++) {
        rig.press('scene.next');
        await rig.run(2500, null);
    }
    expect(await rig.host.open('walls-hall')).toBe(true);
    await rig.run(5000, null);
    return said;
}

describe('a page that teaches by moments says no line of keys before the first movement (decision 2, Part C 3)', () => {
    it('with a MomentHost and the narrator on: the headphone check and walls-hall\'s start say no line of keys', async () => {
        const said = await firstMinute({ moments: true });
        expect(said.length).toBeGreaterThan(3);
        expect(said.filter(isKeysLine)).toEqual([]);
    }, 120000);

    it('the control: without a MomentHost the line of keys is said once, as before', async () => {
        const said = await firstMinute({ moments: false });
        expect(said.filter(isKeysLine)).toHaveLength(1);
    }, 120000);

    it('the narrator off is the guide off: no moments, the line of keys as before', async () => {
        const said = await firstMinute({ moments: true, narratorOff: true });
        expect(said.filter(isKeysLine)).toHaveLength(1);
    }, 120000);
});

// sonic3 S1 pass 3: N in a free scan flight says the course's making with its stage and the time left (the owner's rule: anything
// longer than 2 s says its stage and the time left; N to gate 1 took 25 to 50 s in the browser with one line).
import { describe, expect, it } from 'vitest';
import { courseSpeech } from '../../../apps/fly/src/sonic/course-speech';

const t = (key: string, p?: Record<string, string | number>): string => `${key}${p ? ` ${JSON.stringify(p)}` : ''}`;

describe('the course making said in Fly by Sound', () => {
    it('says the step and the time left after the line of N, then at the pacer pace, and nothing after the answer', () => {
        let now = 0;
        const said: string[] = [];
        let ticking = true;
        const sp = courseSpeech((x) => said.push(x), t, () => now, () => () => { ticking = false; });
        // the line of N ("making a course") was just said: no progress line on top of it
        now = 1000;
        sp.tick();
        expect(said).toEqual([]);
        // the worker enters the obstacles' step: a new step is said once the pacer's gap is over, with the seconds left
        now = 5000;
        sp.progress('lay', 3000);
        sp.tick();
        expect(said.length).toBe(1);
        expect(said[0]).toMatch(/^progress\.spoken(Sec|Min|Over) /);
        expect(said[0]).toContain('"n":2');
        now = 6000;
        sp.tick();
        expect(said.length).toBe(1);
        // a long try: said again after the pacer's interval
        now = 26000;
        sp.tick();
        expect(said.length).toBe(2);
        sp.stop();
        expect(ticking).toBe(false);
        now = 60000;
        sp.progress('lay', 3000);
        sp.tick();
        expect(said.length).toBe(2);
    });
});

// Review SO-1, the switch on in the air (r11 life spy, U:/Temp/gsfpv-train3/sonic3/y1-spy2.json): with no new life left, the
// craft still went from 6.66 to 0.06 m/s by the first cue. Fly by Sound's lesson pilot (app/input.ts setLesson builds one)
// started its AutoArm 'off', which sends the arm channel low: the model disarmed in the air. A lesson pilot installed over
// a flight whose motors run keeps them (play/lesson-pilot.ts, play/assist.ts AutoArm.keepOn).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, Sim, S, compileParams } from '@gsfpv/sim-core';
import type { PresetJson } from '@gsfpv/sim-core';
import { ArmGate } from '@gsfpv/input';
import type { Profile } from '@gsfpv/input';
import { LessonPilot } from '../../../apps/fly/src/play/lesson-pilot';
import { scanFreeLesson } from '../../../packages/sonic-fpv/src';
import { REPO } from '../../../packages/prefs/test/helpers';

const PRESET = join(REPO, 'packages', 'sim-core', 'presets', 'pavo20pro-3s.json');

/** 10 ms of the page: the channels through the gate into the model, 1 kHz steps. */
function frame(sim: Sim, gate: ArmGate, ch: Float32Array): number {
    ch[4] = gate.update({} as Profile, ch, 0, true, sim.crashed);
    sim.setChannels(ch);
    for (let i = 0; i < 10; i++) sim.step();
    return ch[4];
}

describe('Fly by Sound switched on in the air keeps the motors', () => {
    it('a lesson pilot installed over a running flight sends arm high from its first frame; the craft stays armed and moving', () => {
        const p = compileParams(JSON.parse(readFileSync(PRESET, 'utf8')) as PresetJson, {});
        const sim = new Sim(p, null);
        sim.reset(0, 50, 0, 0);
        const gate = new ArmGate({ keepArmedAfterCrash: true });
        // the ordinary flight: the switch seen off, then armed with the throttle low, then a hover throttle and pitch forward
        for (let i = 0; i < 10; i++) frame(sim, gate, new Float32Array([0, 0, -1, 0, -1, MODE_CHANNEL.angle, 0, 0]));
        for (let i = 0; i < 10 && !sim.armed; i++) frame(sim, gate, new Float32Array([0, 0, -1, 0, 1, MODE_CHANNEL.angle, 0, 0]));
        expect(sim.armed).toBe(true);
        for (let i = 0; i < 150; i++) frame(sim, gate, new Float32Array([0, 0.4, 0.1, 0, 1, MODE_CHANNEL.angle, 0, 0]));
        const speed = (): number => Math.hypot(sim.s[S.vx], sim.s[S.vy], sim.s[S.vz]);
        expect(sim.armed).toBe(true);
        const before = speed();
        expect(before).toBeGreaterThan(1);
        // Fly by Sound here: the free flight's lesson pilot takes the channels, the pilot holds forward
        const pilot = new LessonPilot({ sim: () => sim, paused: () => false, ground: () => null }, scanFreeLesson('887f27aa', [1, 0, 0, 0]).assists);
        const out = new Float32Array(8);
        const arms: number[] = [];
        for (let t = 0; t < 300; t += 10) {
            pilot.apply([0, 1, 0, 0, -1, 0, 0, 0], out, 2000 + t);
            out[5] = MODE_CHANNEL.angle;
            arms.push(frame(sim, gate, out));
        }
        expect(arms[0]).toBeGreaterThan(0);
        expect(arms.every((a) => a > 0)).toBe(true);
        expect(sim.armed).toBe(true);
        expect(speed()).toBeGreaterThan(before / 2);
    });
});

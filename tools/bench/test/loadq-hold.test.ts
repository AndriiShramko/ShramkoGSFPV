// Lane fix-lod: where loadq-probe.mjs holds the camera. pause-rise-lublin holds an absolute place (AT, YAW), so the check
// does not move with the page's start place (car 1's placeStart moved "140 m up" over a low-detail part of Lublin).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-ignore plain .mjs helper without types
import { holdExpr, holdSpec } from '../scripts/loadq-hold.mjs';

const REPO = join(__dirname, '..', '..', '..');

/** Runs the page-side expression against a stub camera and returns what it held. */
function run(expr: string, start: number[], forward: number[]) {
    const looks: number[][] = [];
    let onUpdate: ((dt: number) => void) | null = null;
    const session = {
        cameraOverride: false,
        runner: { sim: { s: new Float64Array(16) } },
        renderer: {
            app: { on: (_e: string, fn: (dt: number) => void) => { onUpdate = fn; } },
            camera: { getPosition: () => ({ x: start[0], y: start[1], z: start[2] }), forward: { x: forward[0], y: forward[1], z: forward[2] } },
            setCameraLookAt: (...a: number[]) => { looks.push(a); },
        },
    };
    const g = globalThis as unknown as Record<string, unknown>;
    g.window = { __gsfpv: { session } };
    try {
        const ret = new Function('window', 'performance', `return ${expr};`)(g.window, { now: () => 0 });
        (onUpdate as unknown as (dt: number) => void)(1 / 60);
        return { ret, look: looks[0], override: session.cameraOverride };
    } finally {
        delete g.window;
    }
}

describe('loadq-hold: the held place of loadq-probe', () => {
    it('AT holds an absolute place, whatever the start; AT wins over UP', () => {
        const spec = holdSpec({ AT: '146.5,202,-97', YAW: '-86.6', UP: '140' });
        expect(spec).toEqual({ kind: 'at', pos: [146.5, 202, -97], yawDeg: -86.6, pitchDeg: -35 });
        for (const start of [[146.5, 62, -97], [92.4, 13.7, -104]]) {
            const r = run(holdExpr(spec), start, [0, 0, 1]);
            expect(r.override).toBe(true);
            expect(r.ret.pos).toEqual([146.5, 202, -97]);
            expect(r.ret.yawDeg).toBeCloseTo(-86.6, 1);
            expect(r.ret.pitchDeg).toBeCloseTo(-35, 1);
            expect(r.look.slice(0, 3)).toEqual([146.5, 202, -97]);
            expect(r.ret.start).toEqual(start);
        }
    });

    it('UP keeps its old meaning: that far above the start, the start heading', () => {
        const r = run(holdExpr(holdSpec({ UP: '140' })), [92.4, 13.7, -104], [1, 0, 0]);
        expect(r.ret.pos).toEqual([92.4, 153.7, -104]);
        expect(r.ret.yawDeg).toBeCloseTo(90, 1);
        expect(r.ret.pitchDeg).toBeCloseTo(-35, 1);
    });

    it('unset holds the start as placed; a bad AT is refused', () => {
        expect(holdSpec({})).toEqual({ kind: 'start' });
        expect(() => holdSpec({ AT: '1,2', YAW: '0' })).toThrow(/x,y,z/);
        expect(() => holdSpec({ AT: '1,2,3' })).toThrow(/YAW/);
    });

    it('the live check pause-rise-lublin holds the place of the passing run of 2026-11-16', () => {
        const sh = readFileSync(join(REPO, 'deploy', 'live-checks.sh'), 'utf8');
        const line = sh.split('\n').find((l) => l.includes('live-pause-lublin') && l.includes('loadq-probe.mjs')) ?? '';
        expect(line).toContain('AT=146.5,202,-97 YAW=-86.6');
        expect(line).not.toMatch(/\bUP=/);
    });

    it('the judge keeps its pass rule and names a line too slow to judge', () => {
        const sh = readFileSync(join(REPO, 'deploy', 'live-checks.sh'), 'utf8');
        const fn = sh.slice(sh.indexOf('pauserise() {'));
        const judge = fn.slice(fn.indexOf("node -e '") + 9, fn.indexOf("' \"$OUT/loadq/live-pause-lublin.json\""));
        const dir = mkdtempSync(join(tmpdir(), 'fixlod-'));
        const verdict = (mbPerS: number, pauseDrawn: number) => {
            const samples = Array.from({ length: 36 }, (_, s) => ({ s, MB: mbPerS * s, drawn: s - 10 < 10 ? 1e6 : s - 10 < 20 ? pauseDrawn : 1e6 }));
            const f = join(dir, `j-${mbPerS}-${pauseDrawn}.json`);
            writeFileSync(f, JSON.stringify({ revealS: 10, pausedAt: 10, move: { at: 20, base: 2.5, perFrame: [[120, 0, 0, 2.5]], drawnAfter: [pauseDrawn, 1.2e6] }, samples }));
            const r = spawnSync(process.execPath, ['-e', judge, f], { encoding: 'utf8' });
            return { code: r.status, out: r.stdout };
        };
        try {
            expect(verdict(14, 3e6).code).toBe(0);
            const slowPass = verdict(0.6, 3e6);
            expect(slowPass.code).toBe(0);
            expect(slowPass.out).not.toMatch(/not judged/);
            const fastFail = verdict(14, 1.2e6);
            expect(fastFail.code).toBe(1);
            expect(fastFail.out).not.toMatch(/not judged/);
            const slowFail = verdict(0.6, 1.2e6);
            expect(slowFail.code).toBe(1);
            expect(slowFail.out).toMatch(/scan MB\/s best 5 s 0\.6\b/);
            expect(slowFail.out).toMatch(/not judged: the line was too slow/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

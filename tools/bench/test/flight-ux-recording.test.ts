// v0.7 lane D1, recording (docs/wip/v07-d1.md section 2 and the review fixes R1, R2, R5), in Node on
// the real Recording (apps/fly/src/app/builtin/recording.ts) with only the encoder replaced: WebCodecs
// is not in Node, so a fake CinemaRecorder writes one small file per part into the real memory
// target. Claims, each with a negative control that must fire:
//  - every scan records (D36): start() and auto-record on a scan outside the catalogue and on a pasted
//    one run a recorder with the burned-in credit (control: the same Recording with D34's gate put
//    back, as v0.6 had it, refuses the same scans; without WebCodecs nothing records);
//  - every saved file reaches the bar once, through onSaved: the pilot's stop, the auto stop 3 s after
//    a disarm, a recording that ended by itself, the video export (control: a listener with v0.6's
//    onEnded contract, recordings that ended by themselves, never hears the auto stop: the review's
//    finding; in the browser: evidence/2026-10-13/v07-d1-S6-control-e344977.json);
//  - "Share your flight" gets every part of a split recording, in order, a gone part as null (the
//    browser's control, the same file: e344977 offered 1 part of 6);
//  - the burned-in credit is whole in an upright frame (a phone: 498 x 1080 at 1080p) and unchanged in
//    a landscape one (control: v0.6's one line at a 40th of the height overflows the upright frame).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkStore } from '../../../packages/prefs/test/helpers';
import { Recording } from '../../../apps/fly/src/app/builtin/recording';
import type { RecordingDeps, Saved } from '../../../apps/fly/src/app/builtin/recording';
import { outputSize } from '../../../apps/fly/src/cinema';
import { creditBaseFont, creditLayout } from '../../../apps/fly/src/cinema-credit';
import type { CreditLayout, MeasureText } from '../../../apps/fly/src/cinema-credit';
import { creditFacts, videoCredit } from '../../../apps/fly/src/scene-facts';
import type { SceneCredit } from '../../../apps/fly/src/scene-facts';

/** The fake encoder: what the Recording asked for, and its files written into the real target. */
const fake = vi.hoisted(() => {
    const state = { supported: true, parts: 1, made: [] as { o: { credit: string; scene: string }; endByItself(): void }[] };
    type Sink = { write(c: { data: Uint8Array; position: number }): Promise<void>; close(): Promise<void> };
    type Target = { kind: string; open(name: string): Promise<Sink> };
    class FakeRecorder {
        static get supported(): boolean {
            return state.supported;
        }
        recording = false;
        seconds = 0;
        lastCreditStripStd = 0;
        onEnded: ((info: unknown) => void) | null = null;
        readonly target: Target;
        constructor(readonly o: { credit: string; scene: string; width: number; height: number; target: Target }) {
            this.target = o.target;
            state.made.push(this);
        }
        async start(): Promise<string> {
            this.recording = true;
            return 'avc1.fake';
        }
        pause(): void {}
        addFrame(): void {}
        async cancel(): Promise<void> {
            this.recording = false;
        }
        stop(): Promise<unknown> {
            return this.close('stop');
        }
        /** the memory cap, a full disk: the recorder ends and reports it */
        endByItself(): void {
            void this.close('cap').then((info) => this.onEnded?.(info));
        }
        private async close(ended: string): Promise<unknown> {
            this.recording = false;
            const files: { name: string; bytes: number; frames: number; seconds: number }[] = [];
            for (let k = 1; k <= state.parts; k++) {
                const name = `gsfpv-${this.o.scene}-${state.made.indexOf(this)}-part${k}.mp4`;
                const sink = await this.target.open(name);
                await sink.write({ data: new Uint8Array([k]), position: 0 });
                await sink.close();
                files.push({ name, bytes: 1, frames: 60, seconds: 1 });
            }
            return {
                codec: 'avc1.fake', width: this.o.width, height: this.o.height, fps: 60, frames: 60 * files.length, bytes: files.length, seconds: files.length,
                duplicated: 0, heldForEncoder: 0, dropped: 0, file: files[files.length - 1].name, files, where: this.target.kind, folder: '', ended, picture: '2d'
            };
        }
    }
    return { state, FakeRecorder };
});
vi.mock('../../../apps/fly/src/cinema', async (orig) => ({ ...(await orig<object>()), CinemaRecorder: fake.FakeRecorder }));

const CATALOGUE = { title: 'Modlinek Villa — red room and bathroom', author: 'Owner Scans', license: 'CC BY 4.0' };
const NOT_IN_CATALOGUE: SceneCredit = creditFacts('cafe0001', undefined, { title: 'Old Mill', author: 'Jane Scan', license: 'CC BY-SA' });
const PASTED: SceneCredit = creditFacts('723068d7', undefined, {});

const deps = (c: SceneCredit): RecordingDeps => ({
    prefs: mkStore(), canvas: { width: 1280, height: 720 } as HTMLCanvasElement, scene: () => ({ id: c.id, credit: videoCredit(c) }), autoRespawn: () => false
});
/** Starts and stops queued so far are done. */
const settle = (rec: Recording): Promise<unknown> => rec.queue(async () => undefined);
/** The pilot's REC: true when a recorder runs afterwards. */
const records = async (rec: Recording): Promise<boolean> => {
    try {
        await rec.start({ auto: false, activation: true });
    } catch {
        return false;
    }
    return rec.recording;
};
/** v0.6's Recording (D34): start() refused a scan outside the showcase (its credit was null then). */
class D34Recording extends Recording {
    constructor(d: RecordingDeps, private readonly showcase: boolean) {
        super(d);
    }
    override async start(o: { auto: boolean; activation: boolean }): Promise<string> {
        if (!this.showcase) throw new Error('recording is only for showcase scenes');
        return super.start(o);
    }
}

afterEach(() => {
    fake.state.supported = true;
    fake.state.parts = 1;
});

describe('every scan records (D36)', () => {
    it('REC and auto-record on a scan outside the catalogue and a pasted one, the credit handed to the encoder', async () => {
        for (const c of [NOT_IN_CATALOGUE, PASTED]) {
            const rec = new Recording(deps(c));
            expect(await records(rec), c.id).toBe(true);
            expect(fake.state.made.at(-1)!.o.credit).toBe(videoCredit(c));
            await rec.stop();
            rec.setAuto(true);
            rec.onSim({ type: 'arm' }, 0, false);
            await settle(rec);
            expect([rec.recording, rec.autoRun], c.id).toEqual([true, true]);
            await rec.stop();
        }
        expect(fake.state.made.at(-1)!.o.credit).toBe('superspl.at/scene/723068d7 · ShramkoGSFPV · gsfpv.flyreelstudio.eu');
    });

    it('control: D34\'s gate put back refuses the same scans (and still records the showcase); without WebCodecs nothing records', async () => {
        expect(await records(new D34Recording(deps(NOT_IN_CATALOGUE), false))).toBe(false);
        expect(await records(new D34Recording(deps(PASTED), false))).toBe(false);
        expect(await records(new D34Recording(deps(creditFacts('39e63ce9', CATALOGUE)), true))).toBe(true);
        fake.state.supported = false;
        expect(await records(new Recording(deps(PASTED)))).toBe(false);
    });
});

describe('every saved file reaches the bar once (onSaved; review R1)', () => {
    /** An auto-recorded flight: Auto on, arm at 0 s, disarm at 1 s, the frames until the stop is due. */
    const autoFlight = async (rec: Recording): Promise<void> => {
        rec.setAuto(true);
        rec.onSim({ type: 'arm' }, 0, false);
        await settle(rec);
        rec.onSim({ type: 'disarm', reason: 'switch' }, 1000, false);
        for (const t of [2000, 3999, 4000]) {
            rec.tick(t);
            await settle(rec);
        }
        rec.setAuto(false);
    };

    it('the pilot\'s stop, the auto stop 3 s after a disarm, a recording that ended by itself, the export', async () => {
        const rec = new Recording(deps(PASTED));
        const heard: Saved[] = [];
        let started = 0;
        rec.onSaved = (s) => heard.push(s);
        rec.onStarted = () => { started++; };
        await rec.start({ auto: false, activation: true });
        const byPilot = await rec.stop();
        expect(heard).toEqual([byPilot]);

        await autoFlight(rec);
        expect(started).toBe(2); // the auto start clears the bar's last note (builtin/cinema.ts onStarted)
        expect(rec.recording).toBe(false);
        expect(heard).toHaveLength(2);
        expect(heard[1]).toBe(rec.last);
        expect(heard[1].info.ended).toBe('stop');
        expect(heard[1].info.files[0].name).not.toBe(byPilot!.info.files[0].name);

        await rec.start({ auto: false, activation: true });
        fake.state.made.at(-1)!.endByItself();
        await vi.waitFor(() => expect(heard).toHaveLength(3));
        expect([heard[2].info.ended, rec.recording]).toEqual(['cap', false]);

        const r = await rec.openExport({ width: 640, height: 360, activation: true });
        await rec.finishExport(r as never);
        expect(heard).toHaveLength(4);
        expect(heard[3]).toBe(rec.last);
    });

    it('control: a listener with v0.6\'s onEnded contract (recordings that ended by themselves) never hears the auto stop', async () => {
        const rec = new Recording(deps(PASTED));
        const v06: Saved[] = [];
        rec.onSaved = (s) => { if (s.info.ended !== 'stop') v06.push(s); };
        await autoFlight(rec);
        expect(rec.last).not.toBeNull();
        expect(v06).toEqual([]);
    });
});

describe('"Share your flight" sends every part (review R5)', () => {
    it('a split recording: every part in order; a part the browser pruned is null', async () => {
        fake.state.parts = 3;
        const rec = new Recording(deps(PASTED));
        await rec.start({ auto: false, activation: true });
        const s = (await rec.stop())!;
        const names = s.info.files.map((f) => f.name);
        expect(names).toHaveLength(3);
        const files = await rec.lastFiles();
        expect(files.map((f) => f?.name)).toEqual(names);
        expect(files.every((f) => f instanceof File && f.size === 1)).toBe(true);
        rec.last!.offer.splice(1, 1);
        expect((await rec.lastFiles()).map((f) => f?.name ?? null)).toEqual([names[0], null, names[2]]);
    });
});

describe('the burned-in credit is whole in any frame (review R2)', () => {
    // Segoe UI Semibold averages about 0.5 em a letter on these lines (the review: 1367 px for the
    // 104-letter Modlinek line at 27 px); 0.56 em here, a little wider than the real font
    const measure: MeasureText = (text, px) => [...text].length * px * 0.56;
    const PORTRAIT = outputSize(390, 844, '1080p');
    const MODLINEK = videoCredit(creditFacts('39e63ce9', CATALOGUE));
    const words = (s: string): string[] => s.split(/ · | — | /);
    /** Every line inside the frame with its padding, and the box inside the frame. */
    const whole = (l: CreditLayout, w: number, h: number): boolean =>
        l.lines.every((line) => measure(line, l.fontPx) + 2 * l.pad <= l.w + 1e-9) && l.x >= 0 && l.x + l.w <= w && l.y >= 0 && l.y + l.h <= h;

    it('upright: every line fits, nothing is lost (author, licence, ShramkoGSFPV, the site); landscape: one line as before', () => {
        expect(PORTRAIT).toEqual({ width: 498, height: 1080 });
        for (const credit of [MODLINEK, videoCredit(PASTED), videoCredit(NOT_IN_CATALOGUE)]) {
            const l = creditLayout(credit, PORTRAIT.width, PORTRAIT.height, measure);
            expect(whole(l, PORTRAIT.width, PORTRAIT.height), credit).toBe(true);
            expect(l.lines.flatMap(words)).toEqual(words(credit));
            expect(l.lines.length).toBeLessThanOrEqual(3);
            expect(l.fontPx).toBeGreaterThanOrEqual(12);
        }
        const m = creditLayout(MODLINEK, PORTRAIT.width, PORTRAIT.height, measure);
        expect(m.lines.join(' ')).toContain('Owner Scans, CC BY 4.0');
        expect(m.lines.join(' ')).toContain('ShramkoGSFPV');
        const wide = creditLayout(MODLINEK, 1920, 1080, measure);
        expect([wide.lines, wide.fontPx]).toEqual([[MODLINEK], creditBaseFont(1080)]);
        // a word wider than the frame breaks between letters, nothing lost
        const odd = creditLayout(`${'x'.repeat(90)} · ShramkoGSFPV`, 240, 400, measure);
        expect(whole(odd, 240, 400)).toBe(true);
        expect(odd.lines.join('').replace(/ · /g, '')).toBe(`${'x'.repeat(90)}ShramkoGSFPV`);
    });

    it('control: v0.6\'s one line at a 40th of the height overflows the upright frame', () => {
        const fs = creditBaseFont(PORTRAIT.height);
        const pad = Math.round(fs * 0.6);
        const h = fs + 2 * pad;
        const v06: CreditLayout = { fontPx: fs, pad, lineH: fs, lines: [MODLINEK], x: pad, y: PORTRAIT.height - h - pad, w: measure(MODLINEK, fs) + 2 * pad, h };
        expect(whole(v06, PORTRAIT.width, PORTRAIT.height)).toBe(false);
    });
});

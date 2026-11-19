// Lane head4, stage H2: "Turn my head to listen" in the sound settings (apps/fly/src/sonic/head/switch.ts, tracking.ts, page.ts).
//   - off by default: a fresh document has it off, and nothing of the tracking is loaded or asked (no camera, no module);
//   - switching on speaks first and only then asks for the camera; the result is spoken; a refusal turns it back off and says why;
//   - switching off and a hidden page stop the camera; shown again with it on, it opens again without the explanation;
//   - a setting left on starts at load only when the browser already allows the camera, never with a question at load;
//   - the tracker's results turn the AudioListener; Shift+H centres (said), and with tracking off says how to turn it on;
//   - a lost face is said once (with the narrator on), the ears glide back;
//   - the saved field survives the prefs document's reading, and the lazy import holds: no static import of the tracking code.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkStore } from '../../../packages/prefs/test/helpers';
import { KEYMAP } from '../../../packages/prefs/src/keymap';
import { validateCollection } from '../../../packages/prefs/src/doc';
import { headTrackOn, setHeadTrack } from '../../../apps/fly/src/sonic/head/switch';
import { cameraRefusal } from '../../../apps/fly/src/sonic/head/tracking';
import { headRig } from './sonic-head-fakes';

const ROOT = join(__dirname, '../../..');
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('head tracking setting (lane head4, H2)', () => {
    it('is off by default and loads nothing: no module, no camera, no question, even after resume', async () => {
        const store = mkStore();
        const rig = headRig(store);
        expect(headTrackOn(store)).toBe(false);
        expect(rig.head.on).toBe(false);
        await rig.head.resume();
        expect(rig.log).toEqual([]);
        expect(store.collection('sonic').headTrack).toBeUndefined();
    });

    it('switching on speaks the explanation first, then asks for the camera, then says it is on; saved on', async () => {
        const store = mkStore();
        const rig = headRig(store);
        expect(await rig.head.set(true)).toBe(true);
        expect(rig.log).toEqual(['say:ask', 'load', 'gum', 'tracker.start', 'say:on']);
        expect(rig.head.running).toBe(true);
        expect(headTrackOn(store)).toBe(true);
    });

    it.each([
        ['NotAllowedError', 'denied'],
        ['NotFoundError', 'no-camera'],
        ['NotReadableError', 'busy']
    ])('a camera refused with %s says %s, turns the setting back off, keeps no camera', async (name, line) => {
        const store = mkStore();
        const rig = headRig(store);
        rig.camera.refuse = name;
        expect(await rig.head.set(true)).toBe(false);
        expect(rig.log).toEqual(['say:ask', 'load', 'gum', `say:${line}`]);
        expect(headTrackOn(store)).toBe(false);
        expect(rig.head.running).toBe(false);
    });

    it('a tracker that does not start says failed, closes the camera it opened, turns the setting off', async () => {
        const store = mkStore();
        const rig = headRig(store, { load: () => Promise.reject(new Error('no model')) });
        expect(await rig.head.set(true)).toBe(false);
        expect(rig.log.at(-1)).toBe('say:failed');
        expect(rig.tracks.every((t) => t.stopped)).toBe(true);
        expect(headTrackOn(store)).toBe(false);
    });

    it('switching off stops the camera and says so; a hidden page stops it, shown again it opens without a second explanation', async () => {
        const store = mkStore();
        const rig = headRig(store);
        await rig.head.set(true);
        rig.doc.set('hidden');
        expect(rig.tracks[0]!.stopped).toBe(true);
        expect(rig.head.running).toBe(false);
        rig.doc.set('visible');
        await flush();
        await flush();
        expect(rig.head.running).toBe(true);
        expect(rig.log.filter((x) => x === 'say:ask')).toHaveLength(1);
        expect(rig.log.filter((x) => x === 'gum')).toHaveLength(2);
        expect(await rig.head.set(false)).toBe(false);
        expect(rig.tracks[1]!.stopped).toBe(true);
        expect(rig.log.at(-1)).toBe('say:off');
        expect(headTrackOn(store)).toBe(false);
        // switched off: a page shown again opens nothing
        rig.doc.set('hidden');
        rig.doc.set('visible');
        await flush();
        expect(rig.log.filter((x) => x === 'gum')).toHaveLength(2);
    });

    it('left on: at load it starts only when the browser already allows the camera, and says it is on; otherwise it is turned off, nothing asked', async () => {
        const store = mkStore();
        setHeadTrack(store, true);
        const asked = headRig(store);
        asked.permission = 'prompt';
        await asked.head.resume();
        expect(asked.log).toEqual([]);
        expect(headTrackOn(store)).toBe(false);
        setHeadTrack(store, true);
        const allowed = headRig(store);
        allowed.permission = 'granted';
        await allowed.head.resume();
        // review head4 R1: the camera opened by the page itself is said (the pilot hears it is on)
        expect(allowed.log).toEqual(['load', 'gum', 'tracker.start', 'say:on']);
        expect(allowed.head.running).toBe(true);
    });

    it('the tracker turns the listener: a head 30 degrees right faces the listener 30 degrees right; off puts it straight at once', async () => {
        const store = mkStore();
        const rig = headRig(store);
        await rig.head.set(true);
        rig.face({ yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, 0);
        for (let i = 1; i <= 90; i++) rig.face({ yawDeg: 30, pitchDeg: 0, rollDeg: 0 }, i * 33);
        expect(rig.listener.forwardX.target).toBeCloseTo(Math.sin(Math.PI / 6), 1);
        expect(rig.listener.forwardZ.target).toBeCloseTo(-Math.cos(Math.PI / 6), 1);
        await rig.head.set(false);
        expect(rig.listener.forwardX.value).toBe(0);
        expect(rig.listener.forwardZ.value).toBe(-1);
        expect(rig.listener.upY.value).toBe(1);
        // the tracker handed out numbers only (a pose of three numbers or null, and a time)
        for (const [pose, t] of rig.results) {
            expect(typeof t).toBe('number');
            if (pose !== null) expect(Object.values(pose as object).every((v) => typeof v === 'number')).toBe(true);
        }
    });

    it('the recentre key: off says how to turn it on; on, the next face is straight ahead and "Centred" is said', async () => {
        const store = mkStore();
        const rig = headRig(store);
        rig.head.recentre();
        await flush();
        expect(rig.log).toEqual(['say:keyOff']);
        await rig.head.set(true);
        rig.face({ yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, 0);
        for (let i = 1; i <= 60; i++) rig.face({ yawDeg: 20, pitchDeg: 0, rollDeg: 0 }, i * 33);
        expect(rig.listener.forwardX.target).toBeGreaterThan(0.25);
        rig.head.recentre();
        for (let i = 61; i <= 120; i++) rig.face({ yawDeg: 20, pitchDeg: 0, rollDeg: 0 }, i * 33);
        expect(rig.log.at(-1)).toBe('say:centred');
        expect(Math.abs(rig.listener.forwardX.target)).toBeLessThan(0.15);
        // the key is Shift+H in the sound mode only
        expect(KEYMAP.find((b) => b.action === 'sonic.headCentre')).toMatchObject({ when: 'sonic', keys: [{ code: 'KeyH', shift: true, cap: 'Shift+H' }] });
    });

    it('a lost face is said once with the narrator on, never with it off; the ears glide back to straight ahead', async () => {
        for (const narrator of [true, false]) {
            const rig = headRig(mkStore());
            rig.narrator = narrator;
            await rig.head.set(true);
            rig.face({ yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, 0);
            for (let i = 1; i <= 60; i++) rig.face({ yawDeg: 30, pitchDeg: 0, rollDeg: 0 }, i * 33);
            for (let i = 61; i <= 120; i++) rig.face(null, i * 33);
            expect(rig.log.filter((x) => x === 'say:lost')).toHaveLength(narrator ? 1 : 0);
            expect(rig.listener.forwardX.target).toBeCloseTo(0, 5);
        }
    });

    it('the camera refusals map from DOMException names', () => {
        expect(cameraRefusal({ name: 'NotAllowedError' })).toBe('denied');
        expect(cameraRefusal({ name: 'OverconstrainedError' })).toBe('no-camera');
        expect(cameraRefusal({ name: 'AbortError' })).toBe('busy');
        expect(cameraRefusal(new Error('x'))).toBe('failed');
    });

    it('the saved field: only true is kept by the prefs document; the tracking code is imported lazily only', async () => {
        const base = { v: 1, prefs: null, progress: {}, current: null };
        expect(validateCollection('sonic', { ...base, headTrack: true })?.headTrack).toBe(true);
        expect(validateCollection('sonic', { ...base, headTrack: false })).not.toHaveProperty('headTrack');
        expect(validateCollection('sonic', { ...base, headTrack: 'yes' })).not.toHaveProperty('headTrack');
        // switch.ts, page.ts and entry.ts never import the tracking code statically: it comes with import('./tracking') only
        for (const f of ['apps/fly/src/sonic/head/switch.ts', 'apps/fly/src/sonic/head/page.ts', 'apps/fly/src/sonic/entry.ts', 'apps/fly/src/sonic/start-screen.ts']) {
            const s = readFileSync(join(ROOT, f), 'utf8');
            for (const m of s.matchAll(/^import (?!type )[^;]*from '([^']+)'/gm)) expect(m[1], `${f}: ${m[1]}`).not.toMatch(/head\/(tracking|filter|pose|listener-turn)$|^\.\/(tracking|filter|pose|listener-turn)$/);
        }
        expect(readFileSync(join(ROOT, 'apps/fly/src/sonic/head/page.ts'), 'utf8')).toContain("load: () => import('./tracking')");
    });
});

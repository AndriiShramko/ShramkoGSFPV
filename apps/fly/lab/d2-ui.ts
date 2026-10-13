// Lab page (dev server only) for lane D2's screens in a real browser, without a scan or a GPU flight:
//   ?view=settings   the Settings screen on an in-memory store, opened at the rates row
//   ?view=switches   the Controls screen for a fake USB radio in use (&direct=1: straight on Switches)
// window.__d2 lets tools/bench/src/accept-v07-d2.ts read the store, send radio frames and see what
// Save handed over. Nothing here is remembered.
import { MemoryBackend, PrefsStore, SCHEMA } from '@gsfpv/prefs';
import { mapFrame } from '@gsfpv/input';
import type { Profile, RawFrame } from '@gsfpv/input';
import { SettingsScreen } from '../src/ui/settings/screen';
import { RadioScreen } from '../src/ui/radio';
import type { HidSource } from '../src/devices/hid';
import { presetResolver } from '../src/app/prefs';
import { switchesRow } from '../src/app/builtin/switches';
import type { FlightContext } from '../src/app/context';
import { PRESETS } from '../src/presets';

const q = new URLSearchParams(location.search);
const ui = document.getElementById('ui')!;
const DRONE = 'pavo20pro-3s';

/** A USB radio as the wizard left it: sticks on CH1-CH4, arm switch on CH5 (axis 4). */
const PROFILE: Profile = {
    version: 1, deviceKey: 'hid:lab:d2', deviceName: 'Lab EdgeTX radio', deadband: 0, created: '2026-10-13T00:00:00.000Z', wizard: 2, mode: 2, angleMode: null,
    axes: { roll: { index: 0, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 }, throttle: { index: 2, invert: false, center: -1, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: 0, min: -1, max: 1 } },
    arm: { kind: 'axis', index: 4, threshold: 0.4985, onAbove: true, off: -1, on: 1 }
};

interface Lab {
    rates?: () => unknown;
    send?: (axes: number[], buttons?: number) => void;
    /** what Settings' Switches link asked Controls to open: [firstOpen, view] */
    opened?: unknown[] | null;
    saved?: Profile | null;
    /** arm (ch[4]) and mode (ch[5]) the saved profile gives for a frame */
    map?: (axes: number[], buttons?: number) => number[];
}
const lab: Lab = {};
(window as unknown as { __d2: Lab }).__d2 = lab;

if (q.get('view') === 'settings') {
    const store = new PrefsStore(SCHEMA, new MemoryBackend(), presetResolver(PRESETS, []), { debounceMs: 0 });
    store.set('drone.current', DRONE);
    // the stick-mode row's Switches link, with a radio in use (&radio=0: none)
    lab.opened = null;
    const fakeCtx = {
        controls: q.get('radio') === '0' ? { profile: null, source: 'keyboard' } : { profile: PROFILE, source: 'hid' },
        input: { openRadio: (...a: unknown[]) => { lab.opened = a; } }
    } as unknown as FlightContext;
    new SettingsScreen(ui, {
        store, scene: null, reload: () => undefined, onClose: () => undefined,
        extra: (id) => (id === 'input.stickMode' ? switchesRow(fakeCtx, () => undefined) : null)
    }, { focus: 'tune.rates' });
    lab.rates = () => store.get('tune.rates', { drone: DRONE });
} else if (q.get('view') === 'switches') {
    const fake = { onFrame: null as ((f: RawFrame) => void) | null, rateHz: 250, key: PROFILE.deviceKey, close: () => undefined };
    const frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    lab.send = (axes, buttons = 0) => {
        frame.t = performance.now();
        for (let i = 0; i < 8; i++) frame.axes[i] = axes[i] ?? 0;
        frame.buttons = buttons;
        fake.onFrame?.(frame);
    };
    lab.saved = null;
    const r = new RadioScreen(ui, { kind: 'hid', profile: structuredClone(PROFILE), hid: fake as unknown as HidSource }, { firstOpen: false, view: q.get('direct') === '1' ? 'switches' : undefined });
    r.onDone = (c) => { lab.saved = c.profile; r.remove(); };
    lab.map = (axes, buttons = 0) => {
        const out = new Float32Array(8);
        if (lab.saved) mapFrame(lab.saved, { t: 0, axes: Float32Array.from(axes), buttons }, out);
        return [out[4], out[5]];
    };
}

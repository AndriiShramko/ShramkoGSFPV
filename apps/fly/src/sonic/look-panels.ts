// The mode's two panels on the page (v0.13 lane v13-look L2-1 to L2-3): the attitude display (attitude.ts, M41-24) and the sound
// panel (sound-panel.ts, M41-25). feature.ts registers each with one line; everything else is here. Only in the Fly by Sound mode
// (this module comes with the mode's chunk; the ordinary simulator keeps its picture), only while a lesson runs, each unless the
// pilot turned it off (look-prefs.ts; a change shows at once). Drawn from the page's frame: the craft's state (the session's flight
// model), the lesson (its band, its next gate, its room) and the engine's last plan (FlyBySoundEngine.plan) with the runner's view
// (view().playing). Their places on the page (look.css, agreed in docs/wip/v13-look.md): the attitude display at the bottom right
// over the recorder's buttons, the sound panel at the bottom left under v13-host's progress panel (the left edge halfway down); the
// view's centre (the target) and the captions (top centre) stay clear.
import { S, attitude } from '@gsfpv/sim-core';
import { DICTS, createTranslator, targetHeightM } from '@shramko/sonic-fpv';
import type { AnalyticWorldInfo, SonicWorld } from '@shramko/sonic-fpv';
import type { FlightContext } from '../app/context';
import { locale, t } from '../i18n';
import { AttitudeDisplay } from './attitude';
import type { AttitudeReport, AttitudeState, Scheme } from './attitude';
import { SoundPanel } from './sound-panel';
import type { SoundReport } from './sound-panel';
import { LOOK_PANELS, panelOn, setPanel } from './look-prefs';
import type { LookPanel } from './look-prefs';
import type { LessonHost } from './lessons';
import type { SonicMode } from './mode';
import type { PageEngine } from './audio';
import './look.css';

declare module '../app/test-hook' {
    interface TestHook {
        /**
         * v0.13 v13-look: what the attitude display and the sound panel show, their switches, and what drawing them costs a frame (ms);
         * `setSwitch` turns one on or off the way the spoken settings list will (look-prefs.ts setPanel: saved in the prefs); `freeze`
         * holds both pictures as they are (the flight and the sound go on), so a bench takes a picture and the report of the same frame
         * (the engine plays nothing while the flight is paused, so pausing it would empty the sound panel)
         */
        sonicPanels?: {
            report(): { attitude: AttitudeReport | null; sound: SoundReport | null; prefs: Record<LookPanel, boolean>; frameMs: Record<'attitude' | 'sound', CostStats> };
            setSwitch(which: LookPanel, on: boolean): void;
            freeze(on: boolean): void;
        };
    }
}

/** The page's colour scheme, followed while the page lives. */
function schemeWatch(): { get: () => Scheme; off: () => void } {
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
    let scheme: Scheme = mq?.matches ? 'light' : 'dark';
    const on = (e: MediaQueryListEvent): void => {
        scheme = e.matches ? 'light' : 'dark';
    };
    mq?.addEventListener('change', on);
    return { get: () => scheme, off: () => mq?.removeEventListener('change', on) };
}

/** The room's top above its floor: the highest point of the world's hollow; null for the open world or a scan. */
const tops = new WeakMap<object, number | null>();
function roomTopM(world: SonicWorld | null, floorY: number): number | null {
    if (world === null) return null;
    let top = tops.get(world);
    if (top === undefined) {
        const cav = (world as Partial<AnalyticWorldInfo>).cavities;
        top = Array.isArray(cav) && cav.length > 0 ? Math.max(...cav.map((c) => c.cy + c.hy)) : null;
        tops.set(world, top);
    }
    return top === null ? null : top - floorY;
}

export interface CostStats {
    readonly n: number;
    readonly p50: number;
    readonly p95: number;
    readonly max: number;
}

/** What a panel costs the frame it is shown in (its whole frame handler), ms: the last 600 frames. */
class FrameCost {
    private readonly ms: number[] = [];
    add(v: number): void {
        this.ms.push(v);
        if (this.ms.length > 600) this.ms.shift();
    }
    stats(): CostStats {
        const s = [...this.ms].sort((a, b) => a - b);
        const q = (f: number): number => (s.length ? (s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))] as number) : 0);
        return { n: s.length, p50: q(0.5), p95: q(0.95), max: s.length ? (s[s.length - 1] as number) : 0 };
    }
}

interface Panels {
    attitude: AttitudeDisplay | null;
    sound: SoundPanel | null;
    cost: Record<'attitude' | 'sound', FrameCost>;
    on: Record<LookPanel, boolean>;
    scheme: ReturnType<typeof schemeWatch>;
    /** the test hook's freeze: no frame draws or hides a panel */
    frozen: boolean;
}

const installed = new WeakMap<FlightContext, Panels>();

/** The two panels of the page, made once; each installer adds its own. */
function panelsOf(ctx: FlightContext): Panels {
    let p = installed.get(ctx);
    if (!p) {
        const on = Object.fromEntries(LOOK_PANELS.map((k) => [k, panelOn(ctx.prefs, k)])) as Record<LookPanel, boolean>;
        p = { attitude: null, sound: null, cost: { attitude: new FrameCost(), sound: new FrameCost() }, on, scheme: schemeWatch(), frozen: false };
        installed.set(ctx, p);
        const panels = p;
        ctx.hook.sonicPanels = {
            report: () => ({ attitude: panels.attitude?.report() ?? null, sound: panels.sound?.report() ?? null, prefs: { ...panels.on }, frameMs: { attitude: panels.cost.attitude.stats(), sound: panels.cost.sound.stats() } }),
            setSwitch: (which, on) => setPanel(ctx.prefs, which, on),
            freeze: (on) => {
                panels.frozen = on;
            }
        };
    }
    return p;
}

function release(ctx: FlightContext, p: Panels): void {
    if (p.attitude || p.sound) return;
    p.scheme.off();
    installed.delete(ctx);
    delete ctx.hook.sonicPanels;
}

/** Follows the panel's switch in the prefs (the spoken settings list, a settings file loaded, another tab). */
function followSwitch(ctx: FlightContext, p: Panels, which: LookPanel): () => void {
    return ctx.prefs.onChange((c) => {
        if (c.id === 'collection.sonic') p.on[which] = panelOn(ctx.prefs, which);
    });
}

/**
 * The attitude display (M41-24): the craft's attitude, height and climb in a lesson of the mode that flies (not in the listening
 * lessons of module 0, which fly nothing, nor while a recording plays back). One line in feature.ts.
 */
export function installAttitude(ctx: FlightContext, mode: SonicMode, host: () => LessonHost | null): () => void {
    const p = panelsOf(ctx);
    const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const view = new AttitudeDisplay({ parent: document.body, metres: (m, unit = true) => (unit ? t('soniclook.metres', { v: nf.format(m) }) : nf.format(m)), scheme: p.scheme.get });
    p.attitude = view;
    const offFrame = ctx.events.on('frame', () => {
        if (p.frozen) return;
        const t0 = performance.now();
        const h = host();
        const lesson = h?.lesson ?? null;
        const sim = ctx.session.sim;
        const show = p.on.attitude && mode.active && h !== null && h.active && lesson !== null && lesson.world.kind !== 'none' && !mode.inPlayback && !!sim;
        view.show(show);
        if (!show || !h || !lesson || !sim) return;
        const s = sim.s;
        const a = attitude(s);
        const floorY = mode.floorY;
        const band = lesson.layers.heightBandM;
        const state: AttitudeState = {
            rollDeg: a.roll,
            pitchDeg: a.pitch,
            heightM: s[S.py] - floorY,
            vyMps: s[S.vy],
            bandM: band,
            targetM: targetHeightM(h.runner?.target() ?? null, band, floorY),
            roomM: roomTopM(h.world, floorY)
        };
        view.draw(state);
        p.cost.attitude.add(performance.now() - t0);
    });
    const offSwitch = followSwitch(ctx, p, 'attitude');
    return () => {
        offFrame();
        offSwitch();
        view.dispose();
        p.attitude = null;
        release(ctx, p);
    };
}

/**
 * The sound panel (M41-25): what the engine plays, as the engine planned it, while a lesson runs (the listening lessons too: the
 * glossary's sounds are where a deaf pilot meets them). One line in feature.ts.
 */
export function installSoundPanel(ctx: FlightContext, mode: SonicMode, engine: PageEngine, host: () => LessonHost | null): () => void {
    const p = panelsOf(ctx);
    const glossary = createTranslator(locale, DICTS);
    const panel = new SoundPanel({ parent: document.body, text: (key, vars) => t(key, vars), cueName: (base) => glossary.text({ key: `cue.${base}.name` }), scheme: p.scheme.get });
    p.sound = panel;
    const offFrame = ctx.events.on('frame', ({ now }) => {
        if (p.frozen) return;
        const t0 = performance.now();
        const h = host();
        const show = p.on.soundPanel && mode.active && h !== null && h.active;
        panel.show(show);
        if (!show || !h) return;
        const lesson = h.lesson;
        const top = lesson && lesson.world.kind === 'analytic' ? roomTopM(h.world, mode.floorY) : null;
        panel.draw({ plan: engine.plan, playing: h.runner?.view().playing ?? null, topM: top !== null && top > 0.5 ? Math.ceil(top * 2) / 2 : 4, now });
        p.cost.sound.add(performance.now() - t0);
    });
    const offSwitch = followSwitch(ctx, p, 'soundPanel');
    return () => {
        offFrame();
        offSwitch();
        panel.dispose();
        p.sound = null;
        release(ctx, p);
    };
}

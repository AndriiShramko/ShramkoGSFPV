// The wind of the place in flight (v0.7 lane E, the owner's item 10; docs/wip/v07-e.md section 6).
// The settings (packages/prefs defs/wind.ts) choose the wind; session/wind-source.ts says which wind
// that is; the session flies it (sim-core ParamOverrides.wind, a 'life' setting: a new life where the
// craft is). The wind a scene starts with is windFor's (session/wind-source.ts): fly() and the scene
// host pass it to FlightSession.start, which awaits it with the walls. Here:
//  - a change of the settings goes on the flight once the flight runs again (A.7: not while the
//    settings screen holds it paused), as one new life;
//  - the HUD's wind dial (ui/wind-dial.ts): the wind relative to the nose and its speed, N on the
//    ring when the scene has a compass heading; a short note says which wind flies at the start;
//  - the Settings row's line (what the choice gives on this scan) and window.__gsfpv.wind.
import { attitude } from '@gsfpv/sim-core';
import { chooseWind, customWind, windFor, windMode } from '../../session/wind-source';
import type { WindSpec } from '../../session/wind-source';
import { WindDial } from '../../ui/wind-dial';
import { windDialView } from '../../ui/wind-view';
import { h, fmt } from '../../ui/dom';
import { t } from '../../i18n';
import type { Feature, FlightContext } from '../context';

// window.__gsfpv.wind (test-hook.ts is the shell's; this feature adds its part)
declare module '../test-hook' {
    interface TestHook {
        /** v0.7 wind: what the flight flies in now, the model's header field, and the dial */
        wind?: {
            state(): { mode: string; spec: WindSpec | null; config: unknown; windNow: number[]; dial: ReturnType<typeof windDialView> | null };
            /** apply the store's wind now (as the resume would) and wait for a live answer */
            apply(): Promise<boolean>;
        };
    }
}

/** "4.0 m/s from 270°, gusts 2.0 m/s (the scan's wind)": a spec in the pilot's words; still air says so. */
export function windText(spec: WindSpec | null): string {
    if (!spec) return t('wind.text.calm');
    const base = t('wind.text.on', { speed: fmt(spec.speed, 1), from: Math.round(spec.fromDeg), gust: fmt(spec.gust, 1) });
    return `${base} (${t(`wind.source.${spec.source}`)})`;
}

/** Under the Settings row of wind.mode: what the choice gives on this scan now, and the compass caveat. */
export function windRow(ctx: FlightContext): { el: HTMLElement; refresh(): void } {
    const line = h('p', { class: 'small sr-extra-line', 'data-testid': 'wind-row-line' });
    const note = h('p', { class: 'small muted sr-extra-line', 'data-testid': 'wind-row-note' });
    const el = h('div', { class: 'sr-extra' }, line, note);
    const refresh = (): void => {
        const prefs = ctx.prefs, id = ctx.scene.id, meta = ctx.scene.meta;
        const mode = windMode(prefs.get('wind.mode'));
        // the live wind is asked when the flight goes on; until then the line says so
        const c = chooseWind(mode === 'now' ? 'scene' : mode, meta, customWind(prefs, id), null);
        line.textContent = mode === 'now' ? t('wind.row.now', { fallback: windText(c.spec) }) : windText(c.spec);
        note.textContent = mode === 'off' || meta?.compassDeg !== undefined ? '' : t('wind.row.noCompass');
        note.hidden = note.textContent === '';
    };
    refresh();
    return { el, refresh };
}

export const wind: Feature = {
    id: 'wind',
    install(ctx) {
        const dial = new WindDial();
        ctx.hud.root.append(dial.el);
        let dirty = false;
        let applying: Promise<boolean> | null = null;

        /** A note at the start of a scene: which wind flies, or why not the live one asked for. */
        const announce = (): void => {
            const ses = ctx.session;
            const mode = windMode(ctx.prefs.get('wind.mode'));
            if (mode === 'now' && ses.windSpec?.source !== 'now') ctx.hud.flash(t(ses.windSpec ? 'wind.note.nowFallbackScene' : 'wind.note.nowNone'), 5000);
            else if (ses.windSpec) ctx.hud.flash(t('wind.note.on', { text: windText(ses.windSpec) }), 4000);
        };

        /** The store's wind on the flight: one new life when it differs (true). */
        const apply = async (): Promise<boolean> => {
            dirty = false;
            const ses = ctx.session;
            const spec = await windFor(ctx.prefs, ctx.scene.id, ctx.scene.meta);
            // a scene switch while the live wind was asked: that scene got its own at its start
            if (ses !== ctx.session || ses.disposed || !ses.runner) return false;
            if (!ses.setWind(spec)) return false;
            ctx.clearCrash();
            ses.applyLifeSettings(ses.presetId, ses.overrides);
            ctx.hud.flash(spec ? t('wind.note.on', { text: windText(spec) }) : t('wind.note.off'), 3500);
            return true;
        };
        const applySoon = (): void => {
            if (applying) { dirty = true; return; }
            applying = apply().finally(() => {
                applying = null;
                if (dirty && !ctx.session.paused) applySoon();
            });
        };

        // A.7: a 'life' setting goes on the flight once, when the flight runs again (the settings screen
        // holds it paused while the pilot drags a slider); several changes in one go are one new life
        const offPrefs = ctx.prefs.onChange((c) => {
            if (!c.id.startsWith('wind.')) return;
            if (c.scope === 'scene' && c.key !== ctx.scene.id) return;
            dirty = true;
            if (!ctx.session.paused) queueMicrotask(() => { if (dirty) applySoon(); });
        });
        const offPause = ctx.events.on('pause', ({ on }) => { if (!on && dirty) applySoon(); });
        const offSession = ctx.events.on('session', () => announce());
        const offFrame = ctx.events.on('frame', () => {
            const ses = ctx.session;
            if (!ses.runner || ses.disposed) return dial.update(null);
            const sim = ses.shownSim;
            const compass = ctx.scene.meta?.compassDeg;
            dial.update(windDialView(attitude(sim.s).yaw, sim.wind ? sim.windNow : null, typeof compass === 'number' ? compass : null));
        });

        ctx.hook.wind = {
            state: () => {
                const ses = ctx.session;
                const sim = ses.shownSim;
                const compass = ctx.scene.meta?.compassDeg;
                return {
                    mode: windMode(ctx.prefs.get('wind.mode')),
                    spec: ses.windSpec,
                    config: sim.p.wind,
                    windNow: Array.from(sim.windNow),
                    dial: windDialView(attitude(sim.s).yaw, sim.wind ? sim.windNow : null, typeof compass === 'number' ? compass : null)
                };
            },
            apply: () => apply()
        };
        announce();
        return () => {
            offPrefs();
            offPause();
            offSession();
            offFrame();
            dial.el.remove();
            delete ctx.hook.wind;
        };
    }
};

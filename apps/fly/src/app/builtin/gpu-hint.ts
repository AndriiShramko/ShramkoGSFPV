// The GPU hint (v0.12, lane v12-flight, docs/wip/v12-plan.md sections 2.12 and 4.2 step 11): on Windows, with WebGPU on an integrated
// Intel GPU, a note over the flight says that the browser is probably not using the laptop's NVIDIA or AMD card, why (Chrome on Windows
// ignores the page's powerPreference), and the two ways to switch: the browser's flag, shown as text to copy (a page cannot link to a
// chrome:// address), or Windows Settings, System, Display, Graphics, the browser, Options, High performance. The rule is render-pc's
// gpuSwitchHintDue; the words are the dictionary's (locales/fly/gpuhint); the pieces that need no page are sonic/gpu-hint.ts.
// It is shown once per browser (a note in localStorage, as the macro hint of builtin/scale.ts), when the flight runs (not under a
// Controls screen or a picker), and in Fly by Sound the engine says a short version aloud: a helper at the keyboard hears that the
// computer is on the weaker graphics and what to do (the note on the screen stays for whoever can see it). It changes nothing in the
// flight: the page cannot pick the GPU, only say how to.
import { gpuSwitchHintDue } from '@gsfpv/render-pc';
import type { GpuHintReading, GpuHintSignals } from '@gsfpv/render-pc';
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { gpuHintParts, gpuHintSeen, markGpuHintSeen, forgetGpuHint } from '../../sonic/gpu-hint';
import { deviceSignals } from '../drawing';
import { addSceneNote } from '../scene-notes';
import type { Feature, FlightContext } from '../context';
import './gpu-hint.css';

/** How long the note stays when nobody closes it, ms (a pilot needs time to read two ways and copy one). */
export const GPU_NOTE_MS = 90000;

declare module '../test-hook' {
    interface TestHook {
        /**
         * The GPU hint, for the acceptance runs: `check` reads the rule as the page would, with `over` laid over what this device says
         * (a test on an NVIDIA PC asks as an Intel laptop would), and shows the note when due and not shown before (`force`: even if it was);
         * `seen` is the browser's note; `reset` forgets it and takes the note off; `open` says whether the note is up.
         */
        gpuHint?: {
            check(over?: Partial<GpuHintSignals>, o?: { force?: boolean }): GpuHintReading & { shown: boolean };
            seen(): boolean;
            reset(): void;
            open(): boolean;
        };
    }
}

export const gpuHint: Feature = {
    id: 'gpu-hint',
    install(ctx: FlightContext) {
        let noteOff: (() => void) | null = null;

        /** What this device says now (the renderer's real adapter, never navigator.gpu: the engine can fall back), with `over` laid over it. */
        const signals = (over: Partial<GpuHintSignals> = {}): GpuHintSignals => ({
            ...deviceSignals(ctx.renderer.isWebGPU, ctx.renderer.gpuInfo),
            platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform,
            ...over
        });

        /** The note over the flight, and (in Fly by Sound) the line a helper hears. */
        const show = (): boolean => {
            if (noteOff) return false;
            const parts = gpuHintParts(navigator.userAgent, t);
            const status = h('div', { class: 'gh-status', role: 'status', 'aria-live': 'polite', 'data-testid': 'gpu-hint-status' });
            const body = h('div', { class: 'gh-body' }, h('p', {}, parts.text));
            if (parts.fixFlag && parts.address) {
                const address = parts.address;
                const code = h('code', { class: 'gh-address', 'data-testid': 'gpu-hint-address' }, address);
                const copy = h(
                    'button',
                    {
                        type: 'button',
                        class: 'btn sn-btn',
                        'data-action': 'gpu-hint-copy',
                        onclick: () => {
                            const clip = navigator.clipboard;
                            const done = (): void => {
                                status.textContent = t('gpuhint.copied');
                            };
                            const failed = (): void => {
                                status.textContent = t('gpuhint.copyFailed');
                                // the address selected, so the pilot only has to copy it
                                try {
                                    getSelection()?.selectAllChildren(code);
                                } catch {
                                    /* no selection API */
                                }
                            };
                            if (!clip?.writeText) failed();
                            else clip.writeText(address).then(done, failed);
                        }
                    },
                    t('gpuhint.copy')
                );
                body.append(h('p', {}, parts.fixFlag, ' ', code, ' ', copy));
            }
            body.append(h('p', {}, parts.fixWindows), status);
            const ok = h(
                'button',
                {
                    type: 'button',
                    class: 'btn sn-btn',
                    'data-action': 'gpu-hint-ok',
                    onclick: () => {
                        noteOff?.();
                        noteOff = null;
                    }
                },
                t('gpuhint.ok')
            );
            const note = h('div', { class: 'gpu-hint interactive', role: 'note', 'data-testid': 'gpu-hint' }, body, ok);
            noteOff = addSceneNote(ctx.ui, note, GPU_NOTE_MS);
            markGpuHintSeen();
            // Fly by Sound: a helper at the keyboard hears it (queued behind the lesson's own lines, the engine's one voice)
            const sonic = ctx.sonic;
            if (sonic) void sonic.engine.say({ key: 'sonic.say.gpuHint' }, { interrupt: false }).catch(() => undefined);
            return true;
        };

        const check = (over?: Partial<GpuHintSignals>, o: { force?: boolean } = {}): GpuHintReading & { shown: boolean } => {
            const reading = gpuSwitchHintDue(signals(over));
            if (!reading.due) return { ...reading, shown: false };
            if (!o.force && (gpuHintSeen() || ctx.session.paused)) return { ...reading, shown: false };
            return { ...reading, shown: show() };
        };

        // when the flight runs: after a screen or a picker closes, and once the page has settled for a flight that never pauses
        const offPause = ctx.events.on('pause', ({ on }) => {
            if (!on) check();
        });
        const timer = window.setTimeout(() => check(), 1500);

        ctx.hook.gpuHint = {
            check,
            seen: () => gpuHintSeen(),
            reset: () => {
                forgetGpuHint();
                noteOff?.();
                noteOff = null;
            },
            open: () => noteOff !== null
        };
        return () => {
            clearTimeout(timer);
            offPause();
            noteOff?.();
            noteOff = null;
            delete ctx.hook.gpuHint;
        };
    }
};

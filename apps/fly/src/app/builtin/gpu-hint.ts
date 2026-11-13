// The GPU hint (v0.12, lane v12-flight, docs/wip/v12-plan.md sections 2.12 and 4.2 step 11; lane gpu-select, docs/wip/gpu-select.md).
// A page cannot choose the graphics card: on Windows the browser takes the one Windows hands it, the integrated chip on a laptop
// with two (measured: Chrome 140 and Edge 157 give the page one adapter whatever powerPreference it asks for). So the page does
// what it can: it notices, says so every time, and makes the way out as short as it gets.
//   - A line that stays: "Graphics: <adapter> (integrated)" on the start screen (the scan picker, graphicsOnStart) and in the
//     pause menu, with a warning and a "How to switch" button when the rule is due. The same button opens the note in place.
//   - The note over the flight, by itself on every visit while the rule is due, until the pilot presses "Do not show again":
//     the browser's flag as text to copy (a page cannot link to a chrome:// address), and Windows' graphics page as a link
//     (ms-settings:display-advancedgraphics; the browser asks before it opens Settings) with the written path as the fallback.
//   - When the page later runs on a faster card the choice "Do not show again" is forgotten and that fact is remembered, so a
//     browser that falls back is told again, and told that it was on the faster card before.
//   - The software case: a browser that draws on the processor (no WebGPU adapter; WebGL names SwiftShader or Microsoft Basic
//     Render Driver) gets its own note: why this usually happens and how to fix it. No switch helps there.
// The rule is render-pc's gpuSwitchHintDue; the words are the dictionary's (locales/fly/gpuhint); the pieces that need no page
// (words, addresses, the browser's memory, the plan) are sonic/gpu-hint.ts. In Fly by Sound the engine says a short version aloud:
// a helper at the keyboard hears what the computer draws on and what to do (the note stays for whoever can see it). It changes
// nothing in the flight: the page cannot pick the GPU, only say how to.
import { gpuSwitchHintDue, isWindows } from '@gsfpv/render-pc';
import type { GpuHintReading, GpuHintSignals, GpuInfo, SplatRenderer } from '@gsfpv/render-pc';
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { forgetGpuHint, gpuHintMemory, gpuHintParts, gpuHintSeen, markGpuHintSeen, noteFastGraphics, planGpuHint } from '../../sonic/gpu-hint';
import type { GpuHintMemory, GpuHintParts, GpuNote } from '../../sonic/gpu-hint';
import { deviceSignals } from '../drawing';
import { PauseMenu } from '../menu';
import { addSceneNote } from '../scene-notes';
import type { Feature, FlightContext } from '../context';
import './gpu-hint.css';

/** How long the note stays when nobody closes it, ms (a pilot needs time to read two ways and copy one). */
export const GPU_NOTE_MS = 90000;

/** The reading the page works with, and what the note did. */
export type GpuHintResult = GpuHintReading & { shown: boolean; note: GpuNote | null };

declare module '../test-hook' {
    interface TestHook {
        /**
         * The GPU hint, for the acceptance runs: `check` reads the rule as the page would, with `over` laid over what this device says
         * (a test on an NVIDIA PC asks as an Intel laptop would), and shows the note when the plan says so (`force`: whatever was shown or
         * remembered); `seen`: the pilot said "Do not show again"; `memory`: what the browser remembers ('off', 'fast' or null);
         * `reset` forgets it, takes the note off and makes this visit new again; `open` says whether the note is up.
         */
        gpuHint?: {
            check(over?: Partial<GpuHintSignals>, o?: { force?: boolean }): GpuHintResult;
            seen(): boolean;
            memory(): GpuHintMemory;
            reset(): void;
            open(): boolean;
        };
    }
}

/** The note came by itself during this visit (one page load): once is enough until the next one. */
let shownThisVisit = false;

let glName: string | null = null;
/**
 * WebGL's name for the graphics (the unmasked renderer), read once per page from a canvas of its own that is given back at
 * once. Chrome hides the WebGPU adapter's model but tells this one, and a browser that draws on the processor says so here.
 */
export function glRenderer(): string {
    if (glName !== null) return glName;
    glName = '';
    try {
        const c = document.createElement('canvas');
        const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
        if (gl) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            glName = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
    } catch {
        /* no WebGL: no name */
    }
    return glName;
}

/** What this device says now, for the rule: the adapter given, the system as Client Hints name it, WebGL's name. */
export function graphicsSignals(webgpu: boolean, gpu: GpuInfo | null, over: Partial<GpuHintSignals> = {}): GpuHintSignals {
    return {
        ...deviceSignals(webgpu, gpu),
        platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform,
        glRenderer: glRenderer(),
        ...over
    };
}

/** The reading of the renderer's real adapter (never navigator.gpu: the engine can fall back), for the note and the bug report. */
export function graphicsReading(renderer: SplatRenderer, over: Partial<GpuHintSignals> = {}): GpuHintReading {
    return gpuSwitchHintDue(graphicsSignals(renderer.isWebGPU, renderer.gpuInfo, over));
}

/** The bug report's lines about the graphics: the adapter's name, its kind, whether a hint was due and what the browser remembers. */
export function graphicsReport(renderer: SplatRenderer): { name: string; kind: string; hint: string | null; due: boolean; reason: string; memory: GpuHintMemory; webgl: string } {
    const r = graphicsReading(renderer);
    return { name: r.name, kind: r.kind, hint: r.hint, due: r.due, reason: r.reason, memory: gpuHintMemory(), webgl: glRenderer() };
}

/** "Graphics: Intel(R) UHD Graphics (integrated)": the line that stays. */
export function graphicsLineText(r: Pick<GpuHintReading, 'kind' | 'name'>): string {
    const name = r.name || t('gpuhint.unnamed');
    return t(r.kind === 'integrated' ? 'gpuhint.line.integrated' : r.kind === 'software' ? 'gpuhint.line.software' : 'gpuhint.line', { name });
}

/** The words of a note for this reading (the pilot's own browser decides the addresses). */
function partsFor(note: GpuNote, r: GpuHintReading, s: Pick<GpuHintSignals, 'userAgent' | 'platform'>): GpuHintParts {
    return gpuHintParts(navigator.userAgent, (k) => t(k), { note, name: r.name, windows: isWindows(s.userAgent, s.platform) });
}

/**
 * The body of a note: the lead, the browser's way with its address and a copy button, Windows' way with its link, then
 * "Got it" and (for the switch notes) "Do not show again". `close` takes the note away; `never` is called first when the
 * pilot does not want it again.
 */
function noteBody(parts: GpuHintParts, close: () => void, never: (() => void) | null): HTMLElement[] {
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
    const windows = h('p', {}, parts.fixWindows);
    // Windows' own page, one click away: the browser asks before it opens Settings (no target: a new tab would stay empty)
    if (parts.settingsUrl) windows.append(' ', h('a', { class: 'btn sn-btn', href: parts.settingsUrl, 'data-action': 'gpu-hint-settings', 'data-testid': 'gpu-hint-settings' }, t('gpuhint.openSettings')));
    body.append(windows);
    if (parts.fixWindowsMore) body.append(h('p', {}, parts.fixWindowsMore));
    body.append(status);
    const out: HTMLElement[] = [body, h('button', { type: 'button', class: 'btn sn-btn', 'data-action': 'gpu-hint-ok', onclick: close }, t('gpuhint.ok'))];
    if (never) {
        out.push(
            h(
                'button',
                {
                    type: 'button',
                    class: 'btn sn-btn',
                    'data-action': 'gpu-hint-never',
                    onclick: () => {
                        never();
                        close();
                    }
                },
                t('gpuhint.never')
            )
        );
    }
    return out;
}

/**
 * The line that stays, with its warning and the button that opens the note in place (the start screen, the pause menu).
 * null when there is nothing to say: no name and no hint.
 */
export function graphicsBlock(r: GpuHintReading, note: GpuNote | null, s: Pick<GpuHintSignals, 'userAgent' | 'platform'>, where: 'start' | 'menu'): HTMLElement | null {
    if (!r.name && !note) return null;
    const el = h('div', { class: `gpu-line gpu-line-${where}${note ? ' warn' : ''}`, 'data-testid': 'gpu-line', 'data-kind': r.kind, 'data-note': note ?? '' }, h('span', { class: 'gl-text', 'data-testid': 'gpu-line-text' }, graphicsLineText(r)));
    if (!note) return el;
    el.append(h('span', { class: 'gl-warn', 'data-testid': 'gpu-line-warn' }, t(`gpuhint.warn.${note}`)));
    let more: HTMLElement | null = null;
    const how = h('button', { type: 'button', class: 'btn gl-how', 'data-action': 'gpu-line-how', 'aria-expanded': 'false' }, t(note === 'software' ? 'gpuhint.howFix' : 'gpuhint.how'));
    const close = (): void => {
        more?.remove();
        more = null;
        how.setAttribute('aria-expanded', 'false');
    };
    how.addEventListener('click', () => {
        if (more) return close();
        more = h('div', { class: 'gl-more gpu-hint interactive', role: 'note', 'data-testid': 'gpu-line-note' }, ...noteBody(partsFor(note, r, s), close, note === 'software' ? null : markGpuHintSeen));
        el.append(more);
        how.setAttribute('aria-expanded', 'true');
    });
    el.append(how);
    return el;
}

interface AdapterLike {
    info?: { vendor?: string; architecture?: string; device?: string; description?: string; isFallbackAdapter?: boolean };
    isFallbackAdapter?: boolean;
    limits?: { maxBufferSize?: number };
}

let startReading: Promise<{ reading: GpuHintReading; signals: GpuHintSignals }> | null = null;
/**
 * Before a flight there is no renderer: the adapter the browser would give the engine is asked for the same way
 * (`powerPreference: 'high-performance'`), once per page.
 */
function readAtStart(): Promise<{ reading: GpuHintReading; signals: GpuHintSignals }> {
    startReading ??= (async () => {
        let webgpu = false;
        let gpu: GpuInfo | null = null;
        try {
            // (the adapter read as the fields this file uses: `isFallbackAdapter` sits on the adapter in some browsers, in its info in others)
            const api = (navigator as unknown as { gpu?: { requestAdapter(o?: { powerPreference?: string }): Promise<AdapterLike | null> } }).gpu;
            const a = await api?.requestAdapter({ powerPreference: 'high-performance' });
            if (a) {
                const i = a.info ?? {};
                webgpu = true;
                gpu = { vendor: i.vendor ?? '', architecture: i.architecture ?? '', device: i.device ?? '', description: i.description ?? '', isFallback: a.isFallbackAdapter === true || i.isFallbackAdapter === true, maxBufferSize: a.limits?.maxBufferSize ?? 0 };
            }
        } catch {
            /* no adapter */
        }
        const signals = graphicsSignals(webgpu, gpu);
        return { reading: gpuSwitchHintDue(signals), signals };
    })();
    return startReading;
}

/**
 * The start screen's line (app/boot.ts gives the scan picker's root): what the browser draws on, under the title, with the
 * warning and the way out when a hint is due. It also keeps the browser's memory: on a faster card "Do not show again" ends.
 */
export function graphicsOnStart(root: HTMLElement): void {
    void readAtStart().then(({ reading, signals }) => {
        if (!root.isConnected) return;
        const plan = planGpuHint(reading, gpuHintMemory(), { shownThisVisit: true, paused: false });
        if (plan.rememberFast) noteFastGraphics();
        const el = graphicsBlock(reading, plan.note, signals, 'start');
        if (!el) return;
        const title = root.querySelector('h1');
        if (title) title.after(el);
        else root.prepend(el);
    });
}

export const gpuHint: Feature = {
    id: 'gpu-hint',
    install(ctx: FlightContext) {
        let noteEl: HTMLElement | null = null;
        let noteOff: (() => void) | null = null;
        const isOpen = (): boolean => noteEl !== null && noteEl.isConnected;
        const takeOff = (): void => {
            noteOff?.();
            noteOff = null;
            noteEl = null;
        };

        /** The note over the flight, and (in Fly by Sound) the line a helper hears. */
        const show = (note: GpuNote, r: GpuHintReading, s: GpuHintSignals): boolean => {
            if (isOpen()) return false;
            takeOff();
            const el = h('div', { class: 'gpu-hint interactive', role: 'note', 'data-testid': 'gpu-hint', 'data-note': note }, ...noteBody(partsFor(note, r, s), takeOff, note === 'software' ? null : markGpuHintSeen));
            noteEl = el;
            noteOff = addSceneNote(ctx.ui, el, GPU_NOTE_MS);
            shownThisVisit = true;
            // Fly by Sound: a helper at the keyboard hears it (queued behind the lesson's own lines, the engine's one voice)
            const sonic = ctx.sonic;
            if (sonic) void sonic.engine.say({ key: note === 'software' ? 'sonic.say.gpuSoftware' : 'sonic.say.gpuHint' }, { interrupt: false }).catch(() => undefined);
            return true;
        };

        const check = (over?: Partial<GpuHintSignals>, o: { force?: boolean } = {}): GpuHintResult => {
            const s = graphicsSignals(ctx.renderer.isWebGPU, ctx.renderer.gpuInfo, over);
            const reading = gpuSwitchHintDue(s);
            const plan = planGpuHint(reading, gpuHintMemory(), { shownThisVisit, paused: ctx.session.paused, force: o.force });
            // the page's own reading only: a test that asks "as an NVIDIA PC would" must not write this browser's memory
            if (plan.rememberFast && !over) noteFastGraphics();
            return { ...reading, note: plan.note, shown: plan.show && plan.note !== null ? show(plan.note, reading, s) : false };
        };

        // when the flight runs: after a screen or a picker closes, and once the page has settled for a flight that never pauses
        const offPause = ctx.events.on('pause', ({ on }) => {
            if (!on) check();
        });
        const timer = window.setTimeout(() => check(), 1500);

        // the pause menu's row: the line that stays, with the note behind its button
        const offRow = ctx.menu instanceof PauseMenu
            ? ctx.menu.addRow(() => {
                const s = graphicsSignals(ctx.renderer.isWebGPU, ctx.renderer.gpuInfo);
                const reading = gpuSwitchHintDue(s);
                const block = graphicsBlock(reading, planGpuHint(reading, gpuHintMemory(), { shownThisVisit: true, paused: true }).note, s, 'menu');
                return block ? h('section', { class: 'sum-row gpu-row', role: 'group', 'aria-label': graphicsLineText(reading), 'data-testid': 'gpu-row' }, block) : null;
            })
            : () => undefined;

        ctx.hook.gpuHint = {
            check,
            seen: () => gpuHintSeen(),
            memory: () => gpuHintMemory(),
            reset: () => {
                forgetGpuHint();
                takeOff();
                shownThisVisit = false;
            },
            open: isOpen
        };
        return () => {
            clearTimeout(timer);
            offPause();
            offRow();
            takeOff();
            delete ctx.hook.gpuHint;
        };
    }
};

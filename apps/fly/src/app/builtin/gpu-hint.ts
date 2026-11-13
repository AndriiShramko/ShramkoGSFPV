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
//     Render Driver) gets its own note: why this usually happens and how to fix it. No switch helps there. It has its own
//     "Do not show again", which ends when the page is seen on real graphics again.
// The rule is render-pc's gpuSwitchHintDue; the words are the dictionary's (locales/fly/gpuhint); the pieces that need no page
// (words, addresses, the browser's memory, the plan) are sonic/gpu-hint.ts. In Fly by Sound the engine says it aloud: a helper
// at the keyboard hears what the computer draws on and what to do, in full the first time this browser has it to say and as
// a short reminder on later visits (the note stays for whoever can see it). It changes nothing in the flight: the page
// cannot pick the GPU, only say how to.
import { gpuSwitchHintDue, isWindows } from '@gsfpv/render-pc';
import type { GpuHintReading, GpuHintSignals, GpuInfo, SplatRenderer } from '@gsfpv/render-pc';
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { forgetGpuHint, gpuHintMemory, gpuHintParts, gpuHintSaid, gpuHintSeen, gpuSoftHintOff, markGpuHintSaid, markGpuHintSeen, markGpuSoftHintOff, noteFastGraphics, noteHardwareGraphics, planGpuHint, spokenLineKey } from '../../sonic/gpu-hint';
import type { GpuHintMemory, GpuHintParts, GpuNote } from '../../sonic/gpu-hint';
import { deviceSignals } from '../drawing';
import { setGraphicsReader } from '../graphics-report';
import type { GraphicsReport } from '../graphics-report';
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
         * `reset` forgets everything, takes the note off and makes this visit new again; `again` does the same but keeps what
         * the browser remembers (the next visit, without a reload); `open` says whether the note is up.
         */
        gpuHint?: {
            check(over?: Partial<GpuHintSignals>, o?: { force?: boolean }): GpuHintResult;
            seen(): boolean;
            memory(): GpuHintMemory;
            reset(): void;
            again(): void;
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
            const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '').trim();
            // a browser that hides the graphics answers with its own name ("Mozilla", "WebKit WebGL"): that is not a name of graphics
            glName = /^(mozilla|webkit webgl|webkit|generic renderer)$/i.test(name) ? '' : name;
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
export function graphicsReport(renderer: SplatRenderer): GraphicsReport {
    const r = graphicsReading(renderer);
    return { name: r.name, approx: r.approx, kind: r.kind, hint: r.hint, due: r.due, reason: r.reason, memory: gpuHintMemory(), webgl: glRenderer() };
}
// the report (app/diagnostics.ts) asks through app/graphics-report.ts: it must load where this module cannot (no page)
setGraphicsReader(graphicsReport);

/** The adapter's name as the page shows it: a family name the browser rounded is said to be one ("... or similar"). */
function shownName(r: Pick<GpuHintReading, 'name' | 'approx'>): string {
    return r.name && r.approx ? t('gpuhint.nameSimilar', { name: r.name }) : r.name;
}

/** "Graphics: Intel(R) UHD Graphics (integrated)": the line that stays. */
export function graphicsLineText(r: Pick<GpuHintReading, 'kind' | 'name' | 'approx'>): string {
    const name = shownName(r) || t('gpuhint.unnamed');
    return t(r.kind === 'integrated' ? 'gpuhint.line.integrated' : r.kind === 'software' ? 'gpuhint.line.software' : 'gpuhint.line', { name });
}

/** The words of a note for this reading (the pilot's own browser decides the addresses). */
function partsFor(note: GpuNote, r: GpuHintReading, s: Pick<GpuHintSignals, 'userAgent' | 'platform'>): GpuHintParts {
    return gpuHintParts(navigator.userAgent, (k) => t(k), { note, name: shownName(r), windows: isWindows(s.userAgent, s.platform) });
}

/**
 * The body of a note: the lead, the browser's way with its address and a copy button, Windows' way with its link, what the
 * switch costs and how to undo it, then "Got it" and "Do not show again". `close` takes the note away; `never` is called
 * first when the pilot does not want it again.
 */
function noteBody(parts: GpuHintParts, close: () => void, never: () => void): HTMLElement[] {
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
    if (parts.cost) body.append(h('p', { class: 'gh-cost', 'data-testid': 'gpu-hint-cost' }, parts.cost));
    body.append(status);
    return [
        body,
        h('button', { type: 'button', class: 'btn sn-btn', 'data-action': 'gpu-hint-ok', onclick: close }, t('gpuhint.ok')),
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
    ];
}

/** "Do not show again" for a note: the software note keeps its own choice, apart from the switch notes'. */
const neverFor = (note: GpuNote): (() => void) => (note === 'software' ? () => markGpuSoftHintOff() : () => markGpuHintSeen());

/**
 * The line that stays, with its warning and the button that opens the note in place (the start screen, the pause menu).
 * null when there is nothing to say: no name and no hint.
 */
export function graphicsBlock(r: GpuHintReading, note: GpuNote | null, s: Pick<GpuHintSignals, 'userAgent' | 'platform'>, where: 'start' | 'menu'): HTMLElement | null {
    if (!r.name && !note) return null;
    const el = h('div', { class: `gpu-line gpu-line-${where}${note ? ' gl-due' : ''}`, 'data-testid': 'gpu-line', 'data-kind': r.kind, 'data-note': note ?? '' }, h('span', { class: 'gl-text', 'data-testid': 'gpu-line-text' }, graphicsLineText(r)));
    if (!note) return el;
    el.append(h('span', { class: 'gl-warn', 'data-testid': 'gpu-line-warn' }, t(`gpuhint.warn.${note}`)));
    let more: HTMLElement | null = null;
    const how = h('button', { type: 'button', class: 'btn gl-how', 'data-action': 'gpu-line-how', 'aria-expanded': 'false' }, t(note === 'software' ? 'gpuhint.howFix' : 'gpuhint.how'));
    const close = (): void => {
        // the keyboard focus was on a button of the note: it goes back to the button that opened it, not to nowhere
        const held = more?.contains(document.activeElement) ?? false;
        more?.remove();
        more = null;
        how.setAttribute('aria-expanded', 'false');
        if (held) how.focus({ preventScroll: true });
    };
    how.addEventListener('click', () => {
        if (more) return close();
        more = h('div', { class: 'gl-more gpu-hint interactive', role: 'note', 'data-testid': 'gpu-line-note' }, ...noteBody(partsFor(note, r, s), close, neverFor(note)));
        el.append(more);
        how.setAttribute('aria-expanded', 'true');
        // read here on purpose: the same note does not also come by itself over the flight of this visit
        shownThisVisit = true;
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
    // the line's place is kept from the first paint (the adapter is asked for asynchronously), so the picker under it does
    // not jump when the line comes
    const slot = h('div', { class: 'gpu-line gpu-line-start', 'aria-hidden': 'true' });
    const title = root.querySelector('h1');
    if (title) title.after(slot);
    else root.prepend(slot);
    void readAtStart().then(({ reading, signals }) => {
        if (!root.isConnected) return;
        const plan = planGpuHint(reading, gpuHintMemory(), { shownThisVisit: true, paused: false });
        remember(plan);
        const el = graphicsBlock(reading, plan.note, signals, 'start');
        if (el) slot.replaceWith(el);
    });
}

/** What a reading of this computer's own graphics leaves in the browser's memory (never a reading asked "as another computer"). */
function remember(plan: { rememberFast: boolean; hardware: boolean }): void {
    if (plan.rememberFast) noteFastGraphics();
    if (plan.hardware) noteHardwareGraphics();
}

export const gpuHint: Feature = {
    id: 'gpu-hint',
    install(ctx: FlightContext) {
        let noteEl: HTMLElement | null = null;
        let noteOff: (() => void) | null = null;
        const isOpen = (): boolean => noteEl !== null && noteEl.isConnected;
        const takeOff = (): void => {
            const held = noteEl?.contains(document.activeElement) ?? false;
            noteOff?.();
            noteOff = null;
            noteEl = null;
            // the note went with the keyboard focus on one of its buttons: in Fly by Sound the focus goes back to the flight
            // (the region a screen reader passes the keys through); the plain simulator's keys work from anywhere
            if (held) document.querySelector<HTMLElement>('[data-testid="sonic-flight"]')?.focus({ preventScroll: true });
        };

        /**
         * The note over the flight, and (in Fly by Sound) the line a helper hears. `own`: the reading is this computer's own,
         * so what was said is remembered (a reading asked "as another computer" writes nothing).
         */
        const show = (note: GpuNote, r: GpuHintReading, s: GpuHintSignals, own: boolean): boolean => {
            if (isOpen()) return false;
            takeOff();
            const el = h('div', { class: 'gpu-hint interactive', role: 'note', 'data-testid': 'gpu-hint', 'data-note': note }, ...noteBody(partsFor(note, r, s), takeOff, neverFor(note)));
            noteEl = el;
            noteOff = addSceneNote(ctx.ui, el, GPU_NOTE_MS);
            shownThisVisit = true;
            // Fly by Sound: a helper at the keyboard hears it (queued behind the lesson's own lines, the engine's one voice):
            // the long line the first time this browser has this note to say, the short reminder on later visits
            const sonic = ctx.sonic;
            if (sonic) {
                const key = spokenLineKey(note, gpuHintSaid());
                if (own) markGpuHintSaid(note);
                void sonic.engine.say({ key }, { interrupt: false }).catch(() => undefined);
            }
            return true;
        };

        const check = (over?: Partial<GpuHintSignals>, o: { force?: boolean } = {}): GpuHintResult => {
            const s = graphicsSignals(ctx.renderer.isWebGPU, ctx.renderer.gpuInfo, over);
            const reading = gpuSwitchHintDue(s);
            const plan = planGpuHint(reading, gpuHintMemory(), { shownThisVisit, paused: ctx.session.paused, force: o.force, softOff: gpuSoftHintOff() });
            // the page's own reading only: a test that asks "as an NVIDIA PC would" must not write this browser's memory
            if (!over) remember(plan);
            return { ...reading, note: plan.note, shown: plan.show && plan.note !== null ? show(plan.note, reading, s, !over) : false };
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
            again: () => {
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

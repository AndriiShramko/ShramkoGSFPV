// What a bug report carries when the pilot ticks "attach technical details" (builtin/feedback.ts),
// and nothing of it without that tick. The list here is the list the dialog shows (DIAG_ITEMS): the
// release, the browser and GPU, the display and frame rates, the scene and its size, the walls and
// voxel grid, the explicit settings, the page's recent errors, the frame stats, the current life's
// flight log (format /2, bounded) and, if asked for, a small picture of the view. No cookies, no
// storage dumps, no query values (test switches are named, their values are not).
import type { SplatRenderer } from '@gsfpv/render-pc';
import { droneOf } from './prefs';
import { savedFlight } from './logs';
import { q } from './env';
import type { FlightContext } from './context';

/** The items listed beside the consent box, in that order (fly feedback namespace: fb.diag.<item>). */
export const DIAG_ITEMS = ['release', 'browser', 'scene', 'walls', 'settings', 'errors', 'frames', 'log'] as const;

/** The flight log is left out above this (base64 records of a long life): the report must stay under 512 KB. */
export const LOG_MAX_CHARS = 300_000;
const ERRORS_KEPT = 20;
const ERROR_CHARS = 400;

const errors: string[] = [];

/** One error line: no query strings or fragments (a URL may carry a scene link's details), bounded. */
function clean(s: string): string {
    return s.replace(/(https?:\/\/[^\s?#'")]+)[?#][^\s'")]*/g, '$1').slice(0, ERROR_CHARS);
}

function keep(kind: string, text: string): void {
    errors.push(`${new Date().toISOString().slice(11, 19)} ${kind}: ${clean(text)}`);
    if (errors.length > ERRORS_KEPT) errors.shift();
}

function describe(v: unknown): string {
    if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? ` @ ${v.stack.split('\n').slice(1, 3).map((l) => l.trim()).join(' < ')}` : ''}`;
    try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); }
}

// from the first import on (features.ts is imported at boot): uncaught errors, rejected promises and
// the app's own console.error lines (it logs what it survives: a summary row, a panel)
addEventListener('error', (e) => keep('error', e.error ? describe(e.error) : `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
addEventListener('unhandledrejection', (e) => keep('rejection', describe(e.reason)));
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]): void => {
    keep('console', args.map(describe).join(' '));
    consoleError(...args);
};

/** The page's recent errors, oldest first (at most 20). */
export function recentErrors(): string[] {
    return [...errors];
}

/** The release the page came from (release.json of the static release; 'dev' on the dev server). */
async function release(): Promise<{ sha: string; built?: string }> {
    try {
        const r = await fetch('/release.json', { cache: 'no-store' });
        if (r.ok) {
            const j = (await r.json()) as { sha?: unknown; built?: unknown };
            if (typeof j.sha === 'string') return { sha: j.sha, built: typeof j.built === 'string' ? j.built : undefined };
        }
    } catch { /* offline, dev server */ }
    return { sha: 'dev' };
}

/** The release id alone, for the report's `release` field (also without consent: it names no one). */
export async function releaseId(): Promise<string> {
    return (await release()).sha;
}

interface GpuInfo { vendor?: string; architecture?: string; device?: string; description?: string }

async function gpu(renderer: SplatRenderer): Promise<{ api: string; adapter?: GpuInfo }> {
    const api = renderer.isWebGPU ? 'webgpu' : 'webgl2';
    try {
        const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: GpuInfo } | null> } };
        const a = await nav.gpu?.requestAdapter();
        if (a?.info) return { api, adapter: { vendor: a.info.vendor, architecture: a.info.architecture, device: a.info.device, description: a.info.description } };
    } catch { /* no adapter */ }
    return { api };
}

/**
 * The view as it is now, drawn into a canvas of w x h (the frame cropped to fill it): the engine draws
 * one frame on purpose (also while paused) and the canvas is read in that frame's 'frameend', the only
 * moment a WebGPU canvas still holds its picture (cinema.ts reads it the same way). Null when no frame
 * comes within 2 s (a hidden tab).
 */
export function grabView(renderer: SplatRenderer, canvas: HTMLCanvasElement, w: number, h: number): Promise<HTMLCanvasElement | null> {
    return new Promise((resolve) => {
        const app = renderer.app;
        const done = (c: HTMLCanvasElement | null): void => {
            clearTimeout(timer);
            app.off('frameend', onEnd);
            resolve(c);
        };
        const onEnd = (): void => {
            try {
                const out = document.createElement('canvas');
                out.width = w;
                out.height = h;
                const g = out.getContext('2d');
                if (!g || !canvas.width || !canvas.height) return done(null);
                const s = Math.max(w / canvas.width, h / canvas.height);
                const sw = w / s, sh = h / s;
                g.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, 0, 0, w, h);
                done(out);
            } catch (e) {
                console.error('grab view', e);
                done(null);
            }
        };
        const timer = setTimeout(() => done(null), 2000);
        app.on('frameend', onEnd);
        renderer.renderOnce();
    });
}

/** Everything DIAG_ITEMS names, gathered now; `picture` adds a 480 px JPEG of the view. */
export async function collectDiagnostics(ctx: FlightContext, picture: boolean): Promise<Record<string, unknown>> {
    const s = ctx.session;
    const store = ctx.prefs;
    const at = { drone: droneOf(store), scene: ctx.scene.id };
    const fs = s.frameStats();
    const flight = savedFlight(s, 'bug report', { currentOnly: true });
    const logText = JSON.stringify(flight);
    const shot = picture ? await grabView(ctx.renderer, ctx.canvas, 480, Math.max(2, Math.round((480 * ctx.canvas.height) / Math.max(1, ctx.canvas.width)))) : null;
    const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean }; deviceMemory?: number };
    return {
        release: await release(),
        page: { path: location.pathname, switches: [...q.keys()].slice(0, 20), at: new Date().toISOString() },
        browser: {
            userAgent: navigator.userAgent,
            platform: nav.userAgentData?.platform ?? navigator.platform,
            mobile: nav.userAgentData?.mobile,
            languages: navigator.languages?.slice(0, 4),
            cores: navigator.hardwareConcurrency,
            memoryGb: nav.deviceMemory,
            gpu: await gpu(ctx.renderer),
            screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
            canvas: { w: ctx.canvas.width, h: ctx.canvas.height },
            input: ctx.controls.source
        },
        scene: { id: ctx.scene.id, version: s.scene?.version, title: ctx.scene.meta?.title, author: ctx.scene.meta?.author, transform: s.transform, rendererTransform: ctx.renderer.sceneTransform },
        walls: { has: ctx.walls.has(), on: ctx.walls.on(), adminOff: ctx.walls.adminOff, voxels: ctx.voxels.stats() },
        settings: store.explicitList(at),
        errors: recentErrors(),
        frames: { renderHz: Math.round(fs.hz * 10) / 10, p50ms: Math.round(fs.p50 * 10) / 10, p99ms: Math.round(fs.p99 * 10) / 10, held: ctx.renderer.framesHeld },
        flightLog: logText.length <= LOG_MAX_CHARS ? flight : { omitted: 'too long', chars: logText.length, records: flight.records },
        screenshot: shot ? shot.toDataURL('image/jpeg', 0.7) : null
    };
}

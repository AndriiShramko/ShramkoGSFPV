// Why a scan does not open, in one plain line with what to do next (lane n-scan; the owner's wish 5 of 2026-11-20:
// "the scan does not open ... every scan like it must open"). Every failure of a scene load is one of four reasons,
// each the locale line `scene.open.<kind>` (fly locale, en/es/pl/ru):
//   'too-large'      the scan holds more splats than this device can (deviceSplatLimit); a streamed scan never is:
//                    its coarse levels are the lighter version, the engine streams only what the budget allows;
//   'gone'           SuperSplat or its CDN answers 404/410 for the scene or its file;
//   'unknown-format' the file is in a format the engine does not read (a newer SOG version, render-pc
//                    UnsupportedFormatError) or the engine read no splat from it (render-pc NoSplatsError);
//   'network'        the servers did not answer.
// Lines of their own stay: an invalid link, a scene removed at its author's request, GSAF ('unsupported'), a
// damaged file ('broken'). openCheck reads a single SOG's meta.json before anything loads, also with ?render=off,
// so a scan too large or in a newer version says so at once instead of an endless loader; a heavy single file that
// will open (no lighter level) returns an OpenNotice, said before its download of minutes. Pure: no DOM, no engine.
import { SceneError } from '@gsfpv/scenes';
import type { ResolvedScene } from '@gsfpv/scenes';
import { sogVersionProblem } from '@gsfpv/render-pc/lod';

export const OPEN_ERROR_KINDS = ['too-large', 'gone', 'unknown-format', 'network'] as const;
export type OpenErrorKind = (typeof OPEN_ERROR_KINDS)[number];

/** A scan that cannot open, with its reason; the message keeps the technical detail (the test hook, a bug report). */
export class OpenError extends Error {
    readonly kind: OpenErrorKind;
    constructor(kind: OpenErrorKind, message: string) {
        super(message);
        this.kind = kind;
        this.name = 'OpenError';
    }
}

/** The locale key of a reason's line. */
export function openLineKey(kind: OpenErrorKind): `scene.open.${OpenErrorKind}` {
    return `scene.open.${kind}`;
}

function isOpenKind(code: string): code is OpenErrorKind {
    return (OPEN_ERROR_KINDS as readonly string[]).includes(code);
}

/** The reason of any error a scene load ends with, or null when it has a line of its own (or is not known). */
export function openErrorOf(e: unknown): OpenErrorKind | null {
    if (e instanceof OpenError) return e.kind;
    if (e instanceof SceneError) return e.code === 'not-found' ? 'gone' : e.code === 'network' ? 'network' : null;
    const name = (e as { name?: unknown } | null)?.name;
    if (name === 'UnsupportedFormatError' || name === 'NoSplatsError') return 'unknown-format';
    const msg = String((e as { message?: unknown } | null)?.message ?? e ?? '');
    if (/HTTP (404|410)\b/.test(msg)) return 'gone';
    if (/HTTP 5\d\d\b|Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'network';
    return null;
}

/**
 * The code a failed load is recorded and shown with: a reason of this file, else the SceneError's own code
 * ('invalid-link', 'blocked', 'unsupported', 'broken'), else 'generic'.
 */
export function failureCode(e: unknown): string {
    const kind = openErrorOf(e);
    if (kind) return kind;
    return e instanceof SceneError ? e.code : 'generic';
}

/** The line the scene list shows for a failure code (ui/scenes.ts showError): one plain line with what to do next. */
export function failureText(code: string, msg: string, say: (key: string, vars?: Record<string, string>) => string): string {
    if (isOpenKind(code)) return say(openLineKey(code));
    // a scene in a format we cannot open yet is not "missing": its text lives with the picker
    if (code === 'unsupported') return say('scenes.unsupported');
    return say(`error.${code}`, { msg });
}

/**
 * The flight view's line for a failed scene switch (ui/messages.ts tell: a problem that stays to be read), or null when
 * the failure is none of the four reasons (the page's "did not load" line says it).
 */
export function openMessage(code: string, say: (key: string) => string): { kind: 'problem'; text: string; key: string; from: string } | null {
    return isOpenKind(code) ? { kind: 'problem', text: say(openLineKey(code)), key: 'scene.open', from: 'scene' } : null;
}

/** What a device holds: its largest texture side (the engine keeps splat data in square textures) and its memory. */
export interface DeviceRoom {
    maxTextureSize: number;
    /** navigator.deviceMemory (GB, Chrome caps it at 8); undefined where the browser does not say */
    memoryGB?: number;
}

/** Splats one GB of the device's memory holds while flown (textures, sort and work buffers; conservative). */
export const SPLATS_PER_GB = 3_000_000;

/** The most splats a single file may have on this device. */
export function deviceSplatLimit(d: DeviceRoom): number {
    const tex = d.maxTextureSize > 0 ? d.maxTextureSize * d.maxTextureSize : Infinity;
    const mem = typeof d.memoryGB === 'number' && d.memoryGB > 0 ? d.memoryGB * SPLATS_PER_GB : 8 * SPLATS_PER_GB;
    return Math.min(tex, mem);
}

/**
 * A single file this heavy downloads for minutes (it has no lighter level): the pilot is told why before it starts.
 * 100 MB is about 3.5 min at the 0.47 MB/s the SuperSplat CDN gave n-scan's acceptance run (2026-11-21).
 */
export const HEAVY_BYTES = 100_000_000;
/** Bytes per splat of a single SOG (5c0f892e: 190 936 688 bytes for 14 128 571 splats, recorded 2026-11-21). */
export const SOG_BYTES_PER_SPLAT = 13.5;

/** Said before a scan loads that will open, but slowly: one large file, its size in MB. */
export interface OpenNotice {
    kind: 'heavy';
    mb: number;
}

/** The notice of a single file of `bytes`, or null when it is not heavy. */
export function heavyNotice(bytes: number): OpenNotice | null {
    return bytes > HEAVY_BYTES ? { kind: 'heavy', mb: Math.round(bytes / 1_000_000) } : null;
}

/** The flight view's line of a notice (ui/messages.ts tell): stays to be read, says what to do. */
export function noticeMessage(n: OpenNotice, say: (key: string, vars?: Record<string, string>) => string): { kind: 'info'; text: string; key: string; from: string } {
    return { kind: 'info', text: say('scene.open.heavy', { mb: String(n.mb) }), key: 'scene.open', from: 'scene' };
}

/** How openCheck asks the CDN: a GET for meta.json, a HEAD for a PLY's size. */
export type OpenGet = (url: string, init?: { method?: 'GET' | 'HEAD' }) => Promise<Response>;

/**
 * Before a scan loads: a single SOG (meta.json) is read and refused at once when its SOG version is one the engine
 * does not read ('unknown-format'), its splat count is above `limit` ('too-large'), or the file is gone (404/410).
 * A single SOG or PLY that will open but is heavy (heavyNotice) returns its notice: the caller says it before the
 * long download. A streamed scan (lod-meta.json) is left to the renderer's own checks: it opens at its coarse level
 * whatever the device. A server that does not answer is left to the load itself (it may answer then).
 */
export async function openCheck(scene: Pick<ResolvedScene, 'id' | 'contentUrl' | 'contentKind'>, get: OpenGet, limit: number): Promise<OpenNotice | null> {
    if (scene.contentKind !== 'meta' && scene.contentKind !== 'ply') return null;
    const ply = scene.contentKind === 'ply';
    let r: Response;
    try {
        r = await get(scene.contentUrl, ply ? { method: 'HEAD' } : undefined);
    } catch {
        return null;
    }
    if (r.status === 404 || r.status === 410) throw new OpenError('gone', `scene ${scene.id}: ${scene.contentUrl}: HTTP ${r.status}`);
    if (!r.ok) return null;
    // a PLY's size is its Content-Length (the CDN's gzip length: what crosses the network)
    if (ply) return heavyNotice(Number(r.headers.get('content-length') ?? 0) || 0);
    let meta: unknown;
    try {
        meta = await r.json();
    } catch {
        return null; // a damaged file: the renderer names it 'broken'
    }
    const version = sogVersionProblem(meta);
    if (version) throw new OpenError('unknown-format', `scene ${scene.id}: meta.json is ${version}`);
    const count = (meta as { count?: unknown } | null)?.count;
    if (typeof count !== 'number') return null;
    if (count > limit) throw new OpenError('too-large', `scene ${scene.id}: ${count} splats, this device holds ${limit}`);
    return heavyNotice(count * SOG_BYTES_PER_SPLAT);
}

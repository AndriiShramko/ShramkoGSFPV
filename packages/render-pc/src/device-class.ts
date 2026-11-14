// Which kind of device is this? (v0.10 lane R, the owner's item 3: "the site must recognise the device and start OUR
// default presets for that kind of device".) Pure: the browser's answers go in as plain numbers and strings
// (app/device.ts reads them), a class comes out, with the reasons, so a test, F3 and the settings screen can say why.
//
// Four classes, each with its own drawing preset (presets.ts; the owner edits them in the admin):
//   phone          a handheld (isHandheld) that is phone-sized: an iPhone or iPod, an Android with "Mobile" in its
//                  user agent, or any handheld whose shorter screen side is under 600 CSS pixels; also a phone-sized
//                  touch screen behind a desktop user agent ("Request desktop site", isSmallTouchScreen)
//   tablet         any other handheld: an iPad (also iPadOS, whose Safari says "Macintosh" but has touch points),
//                  an Android tablet (no "Mobile"), a large foldable
//   desktop-weak   a desktop or laptop browser whose graphics are probably not up to the full picture: no WebGPU
//                  (the engine's CPU-sort renderer), a fallback (software) adapter, an Intel integrated GPU (Arc
//                  and Xe-HPG are discrete and count as strong), or two of the weak hints below
//   desktop-strong every other desktop: WebGPU on a real adapter (NVIDIA, AMD, Apple, Intel Arc) with nothing weak
// Why no WebGPU alone is weak: the site tells such a browser that flying needs WebGPU (banner.noWebgpu), so it only looks
// at the scan, on the engine's CPU-sort renderer, whose cost no GPU hint can see. Nobody measured a strong GPU behind a
// browser without WebGPU, so it starts cautious (the weak preset); the pilot's own Splat budget goes above the preset
// there (drawing.ts), and the Device class setting names the class outright.
// Weak hints (two of three make it weak): navigator.deviceMemory at most 4 GB (the browser rounds it down and caps it
// at 8), at most 4 logical cores, a WebGPU adapter whose buffer limits are under 1 GiB.
// What this cannot see: an AMD APU ("Radeon Graphics") or a Qualcomm laptop looks like any other adapter when the
// browser hides its name (this PC's Chrome reports vendor, architecture and an empty description), so it falls on the
// hints alone; and a GPU busy with something else. Wrong guesses are cheap: the quality governor lowers the budget and
// the resolution from the preset when frames are missed, and the pilot can name the class himself (Settings, Display).

/** The classes of device, in the order the admin lists them. */
export const DEVICE_CLASSES = ['desktop-strong', 'desktop-weak', 'tablet', 'phone'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** What the WebGPU adapter says about itself (GPUAdapter.info and .limits) or the renderer could read of it. */
export interface GpuInfo {
    /** "nvidia", "amd", "intel", "apple", "qualcomm", ...; empty when the browser hides it */
    vendor: string;
    /** "lovelace", "rdna-3", "gen-12lp", "xe-hpg", "common-3", ...; empty when hidden */
    architecture: string;
    device: string;
    description: string;
    /** a software (fallback) adapter */
    isFallback: boolean;
    /** GPUSupportedLimits.maxBufferSize, bytes; 0 when unknown */
    maxBufferSize: number;
}

/** Everything classifyDevice reads. */
export interface DeviceSignals {
    userAgent: string;
    maxTouchPoints: number;
    /** User-Agent Client Hints `mobile`, when the browser has them */
    uaMobile?: boolean;
    /** the shorter side of the screen in CSS pixels (screen.width, screen.height); 0 when unknown */
    screenShortSide: number;
    /** the renderer really runs on WebGPU (not the WebGL fallback) */
    webgpu: boolean;
    gpu?: GpuInfo | null;
    /** navigator.deviceMemory, GB (0.25 to 8); undefined when the browser has none */
    memoryGb?: number;
    /** navigator.hardwareConcurrency */
    cores?: number;
}

export interface DeviceReading {
    cls: DeviceClass;
    /** short codes of what decided it (DEVICE_REASONS), for tests, F3 and the settings line */
    reasons: DeviceReason[];
}

export type DeviceReason =
    | 'phone' | 'tablet' | 'small-touch-screen'
    | 'no-webgpu' | 'fallback-adapter' | 'intel-integrated'
    | 'little-memory' | 'few-cores' | 'small-buffers'
    | 'strong';

/** A phone or a tablet, from what the browser says (moved here from drawing.ts, which re-exports it): Client Hints' `mobile`; Android, iPhone, iPad, iPod or "Mobile" in the user agent; or iPadOS, whose Safari presents as a Mac with touch points. A Windows laptop with a touch screen is a desktop. */
export function isHandheld(userAgent: string, maxTouchPoints: number, uaDataMobile?: boolean): boolean {
    if (uaDataMobile === true) return true;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true;
    return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** A touch screen with a short side under this many CSS pixels is a phone's (a tablet starts near 600, a Windows or Linux touch laptop at 700 and up). */
export const PHONE_SHORT_SIDE = 600;

/**
 * A phone-sized touch screen behind a user agent that does not say handheld: "Request desktop site" in Android Chrome and some Samsung
 * modes send a desktop user agent and Client Hints `mobile: false`, but the screen is still a phone's (more than one touch point, the
 * shorter side under PHONE_SHORT_SIDE CSS pixels; `screen`, not the window, which the desktop-site mode widens). A touch laptop is far
 * bigger. Not looked for: a tablet in desktop mode (a Linux user agent with touch points looks like a Linux touch laptop; the pilot
 * can name the class in Settings).
 */
export function isSmallTouchScreen(s: Pick<DeviceSignals, 'maxTouchPoints' | 'screenShortSide'>): boolean {
    return s.maxTouchPoints > 1 && s.screenShortSide > 0 && s.screenShortSide < PHONE_SHORT_SIDE;
}

/** A phone or a tablet by everything the browser says: isHandheld, or a phone-sized touch screen under a desktop user agent (isSmallTouchScreen). */
export function looksHandheld(s: Pick<DeviceSignals, 'userAgent' | 'maxTouchPoints' | 'uaMobile' | 'screenShortSide'>): boolean {
    return isHandheld(s.userAgent, s.maxTouchPoints, s.uaMobile) || isSmallTouchScreen(s);
}

/** A handheld that is phone-sized. */
export function isPhoneSized(s: Pick<DeviceSignals, 'userAgent' | 'screenShortSide'>): boolean {
    const ua = s.userAgent;
    if (/iPhone|iPod/i.test(ua)) return true;
    if (/iPad|Macintosh/i.test(ua)) return false;
    if (/Android/i.test(ua)) return /Mobile/i.test(ua) || (s.screenShortSide > 0 && s.screenShortSide < 600);
    return s.screenShortSide > 0 && s.screenShortSide < 600;
}

/**
 * Intel Arc and Xe-HPG are discrete GPUs: not the integrated class of weakness. Chrome and Edge hide the adapter's model, so
 * there the architecture alone says it, in the words of their WebGPU layer (Dawn): "gen-12hp" is the Arc A series and "xe-2hpg"
 * the B series, while "gen-12lp", "xe-lpg", "xe-2lpg" and "xe-3lpg" are chips built into a processor (lane gpu-select: read
 * from the strings of a Dawn build; no Arc card was at hand to measure).
 */
const INTEL_DISCRETE = /gen-?12-?hp\b|xe[-_ ]?\d?[-_ ]?hpg|alchemist|battlemage|\barc\b/i;

/** An Intel integrated GPU: vendor Intel, and not Arc or Xe-HPG (discrete). The one place this is decided: the class and the GPU hint both read it. */
export function isIntelIntegrated(g: GpuInfo | null | undefined): boolean {
    return !!g && g.vendor.toLowerCase() === 'intel' && !INTEL_DISCRETE.test(`${g.architecture} ${g.description} ${g.device}`);
}

/** GPUs below this many bytes of maxBufferSize are a weak hint (a stock WebGPU adapter reports 256 MiB to 4 GiB). */
export const SMALL_BUFFER_BYTES = 1024 ** 3;

/** The class of a device, and why (see the header for the rule). */
export function classifyDevice(s: DeviceSignals): DeviceReading {
    if (looksHandheld(s)) {
        if (!isPhoneSized(s)) return { cls: 'tablet', reasons: ['tablet'] };
        return { cls: 'phone', reasons: [isHandheld(s.userAgent, s.maxTouchPoints, s.uaMobile) ? 'phone' : 'small-touch-screen'] };
    }
    const hard: DeviceReason[] = [];
    if (!s.webgpu) hard.push('no-webgpu');
    const g = s.gpu;
    if (g?.isFallback) hard.push('fallback-adapter');
    if (isIntelIntegrated(g)) hard.push('intel-integrated');
    const soft: DeviceReason[] = [];
    if (s.memoryGb !== undefined && s.memoryGb > 0 && s.memoryGb <= 4) soft.push('little-memory');
    if (s.cores !== undefined && s.cores > 0 && s.cores <= 4) soft.push('few-cores');
    if (g && g.maxBufferSize > 0 && g.maxBufferSize < SMALL_BUFFER_BYTES) soft.push('small-buffers');
    if (hard.length) return { cls: 'desktop-weak', reasons: [...hard, ...soft] };
    if (soft.length >= 2) return { cls: 'desktop-weak', reasons: soft };
    return { cls: 'desktop-strong', reasons: ['strong'] };
}

/** The class a bare set of flags implies (for callers that know only these; the built-in preset of it is used). */
export function impliedClass(d: { webgpu: boolean; handheld: boolean; mobile: boolean }): DeviceClass {
    if (d.handheld) return d.mobile ? 'phone' : 'tablet';
    return d.webgpu ? 'desktop-strong' : 'desktop-weak';
}

/** A short name for the GPU for the settings line: "nvidia lovelace", or "" when the browser says nothing. */
export function gpuName(g: GpuInfo | null | undefined): string {
    if (!g) return '';
    return [g.vendor, g.architecture || g.device].filter(Boolean).join(' ').trim();
}

// ---------------------------------------------------------------------------------------------------------------------
// The GPU hint (v0.12, lane v12-flight, docs/wip/v12-plan.md 2.12): a laptop with an Intel integrated GPU next to an NVIDIA (or
// AMD) one runs the page on the weaker chip. The renderer asks for the other (`powerPreference: 'high-performance'`,
// renderer.ts), but Chrome on Windows ignores that request: it uses the GPU Windows gives the browser, the integrated one on
// a hybrid-graphics laptop. Two things switch it: Chrome's flag chrome://flags/#force-high-performance-gpu, or Windows
// Settings > System > Display > Graphics > the browser > Options > High performance. A page cannot link to a chrome:// address
// (it can only show the text to copy). The page cannot see the second GPU (the adapter is the one in use), so the rule is the
// combination that makes the hint worth saying: Windows, WebGPU, a real integrated adapter. (v0.12 showed it once per browser;
// since lane gpu-select the page shows it on every visit until the pilot says "Do not show again": apps/fly/src/sonic/gpu-hint.ts.)
//   not due: a handheld; any system but Windows (macOS honours the request, Linux has its own switch); no WebGPU (the
//   engine's other renderer); an adapter nothing is known about; a software (fallback) adapter, which no switch would
//   change; a card (NVIDIA, Qualcomm, an AMD adapter that is not one of AMD's integrated chips by name: what the hint wants
//   the page on); Intel Arc and Xe-HPG, which are discrete GPUs.
//
// Lane gpu-select (docs/wip/gpu-select.md; measured on a hybrid laptop, Chrome 140 and Edge 157: the page gets one adapter
// whatever powerPreference it asks for, the integrated one until the browser is switched) adds four things to the reading:
//   - kind and name: what the page draws on, in words a pilot can check against his computer. The name comes from WebGL's
//     unmasked renderer when the page read one (`glRenderer`): Chrome hides the WebGPU adapter's model, and on the WebGL
//     path it is the only name there is.
//   - the software case: a browser that draws on the processor (hardware acceleration off, or the graphics driver disabled
//     or missing) has no WebGPU adapter at all in Chrome 140, and WebGL names SwiftShader or Microsoft Basic Render Driver.
//     No switch helps there, so `due` stays false, and `hint` says 'software': the page tells the pilot why it is slow.
//   - AMD's integrated chips, by the name WebGL gives them ("AMD Radeon(TM) Graphics", "... Vega 8 Graphics", "Radeon 780M"):
//     a laptop with one next to an NVIDIA card is in the same place as an Intel one. Read from the names only; no AMD laptop
//     was at hand to measure.
//   - a browser that hides its WebGPU adapter (Firefox 160: every field empty) and rounds WebGL's name to a family
//     ("Intel(R) HD Graphics, or similar" for the laptop's UHD chip). Only what such a name can carry is believed: an Intel
//     name without the word Arc is an integrated chip (due; measured, Firefox drew on the Intel chip whatever was asked), an
//     NVIDIA name is a card. An Arc name can be a card or a chip of a Core Ultra processor, Firefox's Radeon names are old
//     card names for every Radeon, and a name of no known maker ("Mozilla", "Generic Renderer") says nothing: for those
//     nothing is claimed (`unknown-adapter`), so nothing is shown and nothing is remembered. `approx` marks a rounded name.

/** What the hint reads: the device's signals and the operating system as Client Hints name it. */
export interface GpuHintSignals extends DeviceSignals {
    /** navigator.userAgentData.platform ("Windows", "macOS", "Linux", ...), when the browser has it */
    platform?: string;
    /**
     * WebGL's name for the graphics (WEBGL_debug_renderer_info UNMASKED_RENDERER_WEBGL, e.g.
     * "ANGLE (Intel, Intel(R) UHD Graphics (0x00009A60) Direct3D11 vs_5_0 ps_5_0, D3D11)"), when the page read one
     */
    glRenderer?: string;
    /** the display's refresh rate the page measured (Hz, from requestAnimationFrame: refreshFromIntervals), when it measured one */
    refreshHz?: number;
}

/**
 * 'no-second-card' (the owner, 2026-11-14): an integrated chip draws the page, and nothing says this computer has a faster
 * card next to it; telling such a pilot to switch would make him look for a card he does not have, so nothing is said.
 */
export type GpuHintReason = 'due' | 'no-second-card' | 'handheld' | 'not-windows' | 'no-webgpu' | 'unknown-adapter' | 'fallback-adapter' | 'not-intel' | 'intel-discrete';

/** What says a faster card sits next to the integrated chip (a page is never told so: the browser hides it). */
export type SecondCardSign = 'refresh' | 'chip';

/**
 * A screen at least this fast (Hz) on an integrated chip is a gaming laptop's, and gaming laptops are built with a second card.
 * Ultrabooks without one go up to 120 Hz, so 120 does not count. [reference: what laptops sell with; not a measured rate]
 */
export const SECOND_CARD_HZ = 140;

/**
 * Intel's integrated chips that are only made for laptops with a second card: Tiger Lake-H's "UHD Graphics" (the 8-core H
 * die has only this small chip; PCI ids 0x9A60, 0x9A68, 0x9A70, the i915 driver's TGL GT1). This laptop's is 0x9A60. Chips
 * that also sit alone in a laptop or a desktop (Iris Xe, the U and P series, the desktop dies that the HX parts share) are not
 * listed: a wrong "you have a faster card" misleads the pilot. [reference]
 */
const PAIRED_INTEL_IDS: ReadonlySet<number> = new Set([0x9a60, 0x9a68, 0x9a70]);

/** The PCI device id in WebGL's name ("... UHD Graphics (0x00009A60) Direct3D11 ..."), or null. */
export function glDeviceId(gl: string): number | null {
    const m = /\(0x([0-9a-f]{4,8})\)/i.exec(gl);
    return m ? parseInt(m[1] as string, 16) : null;
}

/**
 * The display's refresh rate (Hz) from requestAnimationFrame's intervals (ms): the 20th percentile of them, so frames the
 * page was slow to draw do not pull it down; 0 with fewer than 20 usable intervals.
 */
export function refreshFromIntervals(ms: readonly number[]): number {
    const v = ms.filter((x) => x > 1 && x < 250).sort((a, b) => a - b);
    if (v.length < 20) return 0;
    return 1000 / (v[Math.floor(v.length * 0.2)] as number);
}

/** The rates screens are sold with (Hz): a measured rate within 4 % of one is said as that one (this laptop's 165 Hz measures 167). */
const SCREEN_RATES = [60, 75, 90, 100, 120, 144, 165, 170, 180, 200, 240, 280, 300, 360, 480];

/** A measured refresh rate as the pilot knows his screen's: the nearest rate screens are sold with, else the whole number. */
export function screenRate(hz: number): number {
    let best = Math.round(hz);
    let gap = Infinity;
    for (const r of SCREEN_RATES) {
        const d = Math.abs(hz - r) / r;
        if (d <= 0.04 && d < gap) {
            best = r;
            gap = d;
        }
    }
    return best;
}

/** What the page draws on: the processor, a chip built into the processor, or anything else (a card, or nothing known). */
export type GraphicsKind = 'software' | 'integrated' | 'other';

export interface GpuHintReading {
    /** the switch hint is due: an integrated chip draws the page where a faster card may sit unused */
    due: boolean;
    /** why: 'due', or the first thing that rules the switch hint out */
    reason: GpuHintReason;
    kind: GraphicsKind;
    /** what the page should tell the pilot: how to switch to the faster card, why the processor is drawing, or nothing */
    hint: 'switch' | 'software' | null;
    /** the adapter's name for the pilot ("Intel(R) UHD Graphics", else "intel gen-12lp"); '' when the browser names nothing */
    name: string;
    /** the name is the chip's family as the browser rounds it, not its model (Firefox ends WebGL's words with ", or similar") */
    approx: boolean;
    /** when due: what says a faster card is there (the note says it to the pilot); else null */
    card: SecondCardSign | null;
    /** the refresh rate behind card 'refresh' (Hz, whole); else null */
    refreshHz: number | null;
}

/** Windows: Client Hints' platform when there is one, else the user agent (Chrome keeps "Windows NT 10.0; Win64; x64" for every Windows). */
export function isWindows(userAgent: string, platform?: string): boolean {
    if (platform !== undefined && platform !== '') return /^windows$/i.test(platform);
    return /Windows NT|Win64|Win32/i.test(userAgent) && !/Windows Phone/i.test(userAgent);
}

/** Names of graphics that the processor draws: Chrome's SwiftShader, Mesa's llvmpipe and softpipe, Windows' Basic Render Driver (WARP). */
const SOFTWARE_GRAPHICS = /swiftshader|llvmpipe|softpipe|software rasterizer|basic render driver|\bwarp\b/i;

/** Firefox ends WebGL's renderer string with this when the name is a family it rounded the real model to. */
const OR_SIMILAR = /,\s*or similar\s*$/i;

/** An Intel Arc CARD by its model ("Arc(TM) A770", "Arc B580", "Arc Pro A60"); "Intel(R) Arc(TM) Graphics" is a chip of a Core Ultra processor. */
const INTEL_ARC_CARD = /\barc(?:\(tm\))?\s+(?:pro\s+)?[ab]\d{2,3}/i;

/** NVIDIA's cards by WebGL's words ("NVIDIA GeForce RTX 3070 Laptop GPU", Firefox's family names "GeForce GTX 980"). */
const NVIDIA_NAME = /\bnvidia\b|geforce|quadro/i;

/** The words a maker's graphics go by in WebGL's string, per adapter vendor as WebGPU names it (glOf). */
const GL_BRANDS: Record<string, RegExp> = {
    intel: /\bintel\b/i,
    nvidia: NVIDIA_NAME,
    amd: /\bamd\b|radeon|\bati\b/i,
    qualcomm: /qualcomm|adreno/i,
    arm: /\barm\b|mali/i,
    apple: /apple/i,
    'img-tec': /powervr|imagination/i,
    samsung: /samsung|xclipse/i
};

/**
 * The model in WebGL's renderer string, as a pilot would read it in his computer's settings:
 * "ANGLE (Intel, Intel(R) UHD Graphics (0x00009A60) Direct3D11 vs_5_0 ps_5_0, D3D11)" is "Intel(R) UHD Graphics",
 * "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)" is "SwiftShader",
 * "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)" is "Apple M1 Pro",
 * "ANGLE (Intel, Vulkan 1.3.255 (Intel(R) UHD Graphics 620 (KBL GT2) (0x00005917)), Intel open-source Mesa driver)" is
 * "Intel(R) UHD Graphics 620 (KBL GT2)"; a string that is not ANGLE's ("Mali-G78", "Apple GPU") stays as it is. Firefox's
 * ", or similar" at the end is taken off every string (the reading's `approx` keeps that fact). '' for an empty one.
 */
export function glRendererName(renderer: string): string {
    let s = renderer.trim().replace(OR_SIMILAR, '');
    const angle = /^ANGLE \((.*)\)$/.exec(s);
    if (angle) {
        // "vendor, model, driver": split at the commas outside brackets (a model may hold some)
        const parts: string[] = [];
        let depth = 0;
        let from = 0;
        const inner = angle[1] as string;
        for (let i = 0; i < inner.length; i++) {
            const c = inner[i];
            if (c === '(') depth++;
            else if (c === ')') depth--;
            else if (c === ',' && depth === 0) {
                parts.push(inner.slice(from, i).trim());
                from = i + 1;
            }
        }
        parts.push(inner.slice(from).trim());
        s = parts[1] ?? parts[0] ?? s;
    }
    if (/swiftshader/i.test(s)) return 'SwiftShader';
    // ANGLE over Vulkan wraps the model: "Vulkan 1.3.255 (<model> (0x....))"
    const vulkan = /^Vulkan \d+(?:\.\d+)* \((.*)\)$/.exec(s);
    if (vulkan) s = vulkan[1] as string;
    return s
        .replace(/^ANGLE Metal Renderer: /, '')
        .replace(/\s+Direct3D\d*.*$/, '')
        .replace(/,?\s+OpenGL.*$/, '')
        .replace(/\/PCIe\/SSE2\s*$/i, '')
        .replace(/\s+\(0x[0-9A-Fa-f]{4,8}\)\s*$/, '')
        .trim();
}

/**
 * AMD's integrated chips by their names: "AMD Radeon(TM) Graphics", "Radeon(TM) Vega 8 Graphics", "Radeon(TM) RX Vega 10
 * Graphics", "Radeon 780M", "Radeon(TM) R7 Graphics". A card says RX and four digits, Pro, or a desktop Vega without
 * the word Graphics ("Radeon RX Vega 64"): those are not matched.
 */
const AMD_INTEGRATED = /radeon(?:\s*\(tm\))?\s+(?:graphics\b|(?:rx\s+)?vega\s*\d+\s+(?:mobile\s+)?graphics\b|\d{3}m\b|r[357]\s+graphics\b)/i;

/** Is this the name of one of AMD's integrated chips? (See AMD_INTEGRATED.) */
export function isAmdIntegrated(name: string): boolean {
    return AMD_INTEGRATED.test(name);
}

/** The WebGL name when it can be trusted to be about the adapter in `g`: the same maker, or no adapter to compare with. */
function glOf(s: Pick<GpuHintSignals, 'gpu' | 'glRenderer'>): string {
    const gl = s.glRenderer?.trim() ?? '';
    const vendor = s.gpu?.vendor.trim().toLowerCase() ?? '';
    if (!gl || !vendor) return gl;
    // Firefox draws WebGL and WebGPU through different stacks: a WebGL name of another maker is not this adapter's. A name
    // may carry the maker's brand without the maker's word ("GeForce GTX 980", "Radeon R9 200 Series", "Adreno (TM) 740")
    return (GL_BRANDS[vendor]?.test(gl) ?? false) || gl.toLowerCase().includes(vendor) ? gl : '';
}

/** Does the browser name its WebGPU adapter? (Firefox gives an adapter with every field empty.) */
const isNamed = (g: GpuInfo | null | undefined): boolean => !!g && g.vendor.trim() !== '';

/**
 * Is the processor drawing the page? A fallback adapter, a software name on the adapter, or a software name on WebGL where
 * WebGL's word is the only one there is (no WebGPU, or an adapter the browser does not name).
 */
export function isSoftwareGraphics(s: Pick<GpuHintSignals, 'webgpu' | 'gpu' | 'glRenderer'>): boolean {
    const g = s.gpu;
    if (g?.isFallback) return true;
    if (g && SOFTWARE_GRAPHICS.test(`${g.vendor} ${g.architecture} ${g.device} ${g.description}`)) return true;
    // with WebGPU on an adapter that names itself the page is not on WebGL's path, and WebGL's software name says nothing
    return !!s.glRenderer && SOFTWARE_GRAPHICS.test(s.glRenderer) && (!s.webgpu || !isNamed(g));
}

/** What the page draws on (GraphicsKind): software first, then an integrated chip of Intel or AMD, else 'other'. */
export function graphicsKind(s: Pick<GpuHintSignals, 'webgpu' | 'gpu' | 'glRenderer'>): GraphicsKind {
    if (isSoftwareGraphics(s)) return 'software';
    const g = s.gpu;
    const gl = glOf(s);
    // a named Intel adapter: its architecture decides, and a WebGL model that is an Arc card overrules an unknown word
    if (isIntelIntegrated(g)) return INTEL_ARC_CARD.test(gl) ? 'other' : 'integrated';
    if (g && g.vendor.toLowerCase() === 'amd' && isAmdIntegrated(`${g.description} ${g.device} ${gl}`)) return 'integrated';
    // no adapter to ask (WebGL, or a browser that hides it): WebGL's name alone. A full model name tells an Arc card from the
    // Arc chip of a processor; a rounded one (", or similar") that says Arc may stand for either, and is not called integrated
    if (!isNamed(g) && gl) {
        if (/\bintel\b/i.test(gl) && !(OR_SIMILAR.test(gl) ? /\barc\b/i : INTEL_ARC_CARD).test(gl)) return 'integrated';
        if (isAmdIntegrated(gl)) return 'integrated';
    }
    return 'other';
}

/** The adapter's name for the pilot: WebGL's model when it is this adapter's, else the adapter's own words; '' when there are none. */
export function graphicsName(s: Pick<GpuHintSignals, 'gpu' | 'glRenderer'>): string {
    const gl = glOf(s);
    if (gl) return glRendererName(gl);
    const g = s.gpu;
    if (!g) return '';
    return (g.description.trim() || gpuName(g)).trim();
}

/**
 * Should the page tell this pilot how to put the browser on the high-performance GPU (`due`), and what is it drawing on
 * (`kind`, `name`, and `hint`: 'switch' when due, 'software' when the processor draws on a desktop, else null)?
 * The section header above is the rule.
 */
export function gpuSwitchHintDue(s: GpuHintSignals): GpuHintReading {
    const kind = graphicsKind(s);
    const name = graphicsName(s);
    const approx = OR_SIMILAR.test(glOf(s));
    const handheld = looksHandheld(s);
    const out = (due: boolean, reason: GpuHintReason, card: SecondCardSign | null = null): GpuHintReading => ({
        due, reason, kind, hint: due ? 'switch' : kind === 'software' && !handheld ? 'software' : null, name, approx, card,
        refreshHz: card === 'refresh' ? screenRate(s.refreshHz ?? 0) : null
    });
    // an integrated chip: due only where something says a faster card is there (the owner: no note that sends a pilot
    // looking for a card he does not have); the browser's memory of a faster card is the app's (sonic/gpu-hint.ts planGpuHint)
    const integrated = (): GpuHintReading => {
        const card = secondCardSign(s);
        return card ? out(true, 'due', card) : out(false, 'no-second-card');
    };
    if (handheld) return out(false, 'handheld');
    if (!isWindows(s.userAgent, s.platform)) return out(false, 'not-windows');
    if (!s.webgpu) return out(false, 'no-webgpu');
    const g = s.gpu;
    if (!g || !isNamed(g)) {
        // A browser that hides its WebGPU adapter (Firefox 160: every field empty) still names the graphics through WebGL, and
        // on the laptop both drew on the same chip whatever powerPreference was asked (the counters, docs/wip/gpu-select.md):
        // WebGL's name then stands in for the adapter's, as far as such a name can be believed (the header's last point).
        const gl = glOf(s);
        if (!gl) return out(false, 'unknown-adapter');
        if (g?.isFallback || kind === 'software') return out(false, 'fallback-adapter');
        if (kind === 'integrated') return integrated();
        return out(false, NVIDIA_NAME.test(gl) ? 'not-intel' : 'unknown-adapter');
    }
    if (g.isFallback || kind === 'software') return out(false, 'fallback-adapter');
    const vendor = g.vendor.toLowerCase();
    if (vendor === 'intel') return kind === 'integrated' ? integrated() : out(false, 'intel-discrete');
    // an AMD chip built into the processor, next to which a card may sit unused (the name is WebGL's: see the header)
    if (vendor === 'amd' && kind === 'integrated') return integrated();
    return out(false, 'not-intel');
}

/**
 * What says a faster card sits next to the integrated chip that draws: a screen of SECOND_CARD_HZ or more, or an Intel chip
 * that is only made for laptops with a card (PAIRED_INTEL_IDS, by WebGL's name when it is this adapter's); null: nothing.
 */
export function secondCardSign(s: Pick<GpuHintSignals, 'refreshHz' | 'gpu' | 'glRenderer'>): SecondCardSign | null {
    if ((s.refreshHz ?? 0) >= SECOND_CARD_HZ) return 'refresh';
    const gl = glOf(s);
    const id = /\bintel\b/i.test(gl) ? glDeviceId(gl) : null;
    return id !== null && PAIRED_INTEL_IDS.has(id) ? 'chip' : null;
}

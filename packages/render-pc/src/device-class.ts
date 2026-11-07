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

/** Intel Arc and Xe-HPG are discrete GPUs: not the integrated class of weakness. */
const INTEL_DISCRETE = /xe[-_ ]?hpg|alchemist|battlemage|\barc\b/i;

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
// combination that makes the hint worth saying: Windows, WebGPU, a real Intel integrated adapter. The page shows it once.
//   not due: a handheld; any system but Windows (macOS honours the request, Linux has its own switch); no WebGPU (the
//   engine's other renderer); an adapter the browser does not name; a software (fallback) adapter, which no switch would
//   change; any vendor but Intel (NVIDIA, AMD and Qualcomm are what the hint wants the page on); Intel Arc and Xe-HPG, which
//   are discrete GPUs.

/** What the hint reads: the device's signals and the operating system as Client Hints name it. */
export interface GpuHintSignals extends DeviceSignals {
    /** navigator.userAgentData.platform ("Windows", "macOS", "Linux", ...), when the browser has it */
    platform?: string;
}

export type GpuHintReason = 'due' | 'handheld' | 'not-windows' | 'no-webgpu' | 'unknown-adapter' | 'fallback-adapter' | 'not-intel' | 'intel-discrete';

export interface GpuHintReading {
    due: boolean;
    /** why: 'due', or the first thing that rules the hint out */
    reason: GpuHintReason;
}

/** Windows: Client Hints' platform when there is one, else the user agent (Chrome keeps "Windows NT 10.0; Win64; x64" for every Windows). */
export function isWindows(userAgent: string, platform?: string): boolean {
    if (platform !== undefined && platform !== '') return /^windows$/i.test(platform);
    return /Windows NT|Win64|Win32/i.test(userAgent) && !/Windows Phone/i.test(userAgent);
}

/** Should the page tell this pilot how to put the browser on the high-performance GPU? (The section header above is the rule.) */
export function gpuSwitchHintDue(s: GpuHintSignals): GpuHintReading {
    const no = (reason: GpuHintReason): GpuHintReading => ({ due: false, reason });
    if (looksHandheld(s)) return no('handheld');
    if (!isWindows(s.userAgent, s.platform)) return no('not-windows');
    if (!s.webgpu) return no('no-webgpu');
    const g = s.gpu;
    if (!g || g.vendor.trim() === '') return no('unknown-adapter');
    if (g.isFallback) return no('fallback-adapter');
    if (g.vendor.toLowerCase() !== 'intel') return no('not-intel');
    if (!isIntelIntegrated(g)) return no('intel-discrete');
    return { due: true, reason: 'due' };
}

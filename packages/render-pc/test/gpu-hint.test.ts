// The GPU hint rule (v0.12 lane v12-flight step 11, docs/wip/v12-plan.md 2.12): when does the page tell a pilot how to put the browser on
// the high-performance GPU? On Windows, with WebGPU on a real Intel integrated adapter: a laptop with Intel graphics next to an NVIDIA
// card runs the page on the weaker chip because Chrome on Windows ignores the page's powerPreference. Every other device is left alone.
// A truth table on the browsers it is meant for (the owner's own PC among them: this PC's Chrome reports vendor "nvidia", architecture
// "lovelace", an empty description), and controls that must fail: a rule that says it for every Intel adapter on any system (macOS honours
// the page's request, Arc is discrete, a software adapter cannot be switched), one that forgets WebGPU, one that fires on an adapter the
// browser does not name. The class rule and this one read the same Intel test (isIntelIntegrated).
import { describe, it, expect } from 'vitest';
import { classifyDevice, gpuSwitchHintDue, isIntelIntegrated, isWindows } from '../src/device-class';
import type { GpuHintReason, GpuHintSignals, GpuInfo } from '../src/device-class';

const UA = {
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    windowsPhone: 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.15254',
    androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
};

const gpu = (o: Partial<GpuInfo> = {}): GpuInfo => ({ vendor: 'intel', architecture: 'gen-12lp', device: '', description: 'Intel(R) UHD Graphics', isFallback: false, maxBufferSize: 2 ** 31, ...o });
const sig = (o: Partial<GpuHintSignals> = {}): GpuHintSignals => ({ userAgent: UA.windows, platform: 'Windows', maxTouchPoints: 0, screenShortSide: 1080, webgpu: true, gpu: gpu(), memoryGb: 8, cores: 8, ...o });

/** A rule that says it for any Intel adapter, whatever the system and the chip: what the table must catch. */
const everyIntel = (s: GpuHintSignals): boolean => s.gpu?.vendor.toLowerCase() === 'intel';

interface Row {
    name: string;
    s: GpuHintSignals;
    due: boolean;
    reason: GpuHintReason;
}

const TABLE: Row[] = [
    { name: 'a Windows laptop on Intel UHD graphics (gen-12lp), WebGPU', s: sig(), due: true, reason: 'due' },
    { name: 'a Windows laptop on Intel Iris Xe (integrated: "Xe" alone is not Arc)', s: sig({ gpu: gpu({ architecture: 'gen-12lp', description: 'Intel(R) Iris(R) Xe Graphics' }) }), due: true, reason: 'due' },
    { name: 'an older Windows laptop on Intel HD graphics (gen-9), the vendor in capitals', s: sig({ gpu: gpu({ vendor: 'INTEL', architecture: 'gen-9', description: 'Intel(R) HD Graphics 620' }) }), due: true, reason: 'due' },
    { name: 'Microsoft Edge on the same Windows laptop (the Edge flag address, the same hint)', s: sig({ userAgent: UA.edge }), due: true, reason: 'due' },
    { name: 'no Client Hints (Safari-like): Windows named by the user agent alone', s: sig({ platform: undefined }), due: true, reason: 'due' },
    { name: 'the owner\'s PC: Windows, NVIDIA (lovelace), WebGPU', s: sig({ gpu: gpu({ vendor: 'nvidia', architecture: 'lovelace', description: '' }) }), due: false, reason: 'not-intel' },
    { name: 'Windows with an AMD adapter (rdna-3)', s: sig({ gpu: gpu({ vendor: 'amd', architecture: 'rdna-3', description: '' }) }), due: false, reason: 'not-intel' },
    { name: 'Windows on a Qualcomm laptop', s: sig({ gpu: gpu({ vendor: 'qualcomm', architecture: 'adreno-8', description: '' }) }), due: false, reason: 'not-intel' },
    { name: 'Windows with Intel Arc (A770: xe-hpg, discrete)', s: sig({ gpu: gpu({ architecture: 'xe-hpg', description: 'Intel(R) Arc(TM) A770 Graphics' }) }), due: false, reason: 'intel-discrete' },
    { name: 'Windows with Intel Arc B580 (battlemage, the browser names no description)', s: sig({ gpu: gpu({ architecture: 'battlemage', description: '' }) }), due: false, reason: 'intel-discrete' },
    { name: 'a MacBook with an Intel integrated GPU (macOS honours the page\'s request)', s: sig({ userAgent: UA.mac, platform: 'macOS', gpu: gpu({ architecture: 'gen-9', description: 'Intel(R) Iris(TM) Plus Graphics' }) }), due: false, reason: 'not-windows' },
    { name: 'a Mac named by its user agent alone', s: sig({ userAgent: UA.mac, platform: undefined }), due: false, reason: 'not-windows' },
    { name: 'Linux with Intel graphics (its own switch, not this hint)', s: sig({ userAgent: UA.linux, platform: 'Linux' }), due: false, reason: 'not-windows' },
    { name: 'Windows, WebGPU on a software (fallback) adapter: nothing to switch to', s: sig({ gpu: gpu({ vendor: 'google', architecture: 'swiftshader', description: 'SwiftShader', isFallback: true }) }), due: false, reason: 'fallback-adapter' },
    { name: 'Windows, a fallback adapter that names itself Intel: still software', s: sig({ gpu: gpu({ isFallback: true }) }), due: false, reason: 'fallback-adapter' },
    { name: 'Windows, no WebGPU (the engine\'s other renderer) on Intel graphics', s: sig({ webgpu: false }), due: false, reason: 'no-webgpu' },
    { name: 'Windows, WebGPU, but the browser names no adapter (empty vendor)', s: sig({ gpu: gpu({ vendor: '', architecture: '', description: '' }) }), due: false, reason: 'unknown-adapter' },
    { name: 'Windows, WebGPU, no adapter information at all', s: sig({ gpu: null }), due: false, reason: 'unknown-adapter' },
    { name: 'a Windows phone (a handheld)', s: sig({ userAgent: UA.windowsPhone, platform: undefined, maxTouchPoints: 5, screenShortSide: 360 }), due: false, reason: 'handheld' },
    { name: 'an Android phone', s: sig({ userAgent: UA.androidPhone, platform: 'Android', maxTouchPoints: 5, screenShortSide: 412 }), due: false, reason: 'handheld' },
    { name: 'Client Hints that say mobile', s: sig({ uaMobile: true }), due: false, reason: 'handheld' },
    { name: 'a Windows touch laptop (more than one touch point, a big screen) is a laptop: the hint applies', s: sig({ maxTouchPoints: 10, screenShortSide: 900 }), due: true, reason: 'due' }
];

describe('gpuSwitchHintDue: the truth table', () => {
    for (const row of TABLE) {
        it(`${row.due ? 'says it' : 'is quiet'}: ${row.name}`, () => {
            expect(gpuSwitchHintDue(row.s)).toEqual({ due: row.due, reason: row.reason });
        });
    }

    it('is due for exactly the rows that mean it: six of the table, and every reason has a row', () => {
        expect(TABLE.filter((r) => r.due).length).toBe(6);
        const reasons = new Set(TABLE.map((r) => r.reason));
        expect([...reasons].sort()).toEqual(['due', 'fallback-adapter', 'handheld', 'intel-discrete', 'no-webgpu', 'not-intel', 'not-windows', 'unknown-adapter']);
    });

    it('names the first thing that rules it out, in a fixed order (handheld, system, WebGPU, adapter, software, vendor, discrete)', () => {
        // a handheld on macOS with no WebGPU and no adapter: the handheld first
        expect(gpuSwitchHintDue(sig({ userAgent: UA.androidPhone, platform: 'Android', maxTouchPoints: 5, screenShortSide: 412, webgpu: false, gpu: null })).reason).toBe('handheld');
        // macOS with no WebGPU and an NVIDIA adapter: the system first
        expect(gpuSwitchHintDue(sig({ userAgent: UA.mac, platform: 'macOS', webgpu: false, gpu: gpu({ vendor: 'nvidia' }) })).reason).toBe('not-windows');
        // Windows with no WebGPU and no adapter: WebGPU first
        expect(gpuSwitchHintDue(sig({ webgpu: false, gpu: null })).reason).toBe('no-webgpu');
        // a software adapter that is not Intel: software before vendor
        expect(gpuSwitchHintDue(sig({ gpu: gpu({ vendor: 'google', isFallback: true }) })).reason).toBe('fallback-adapter');
    });

    it('the operating system is the one Client Hints name, else the user agent (the hint wins over a stale user agent)', () => {
        expect(isWindows(UA.windows)).toBe(true);
        expect(isWindows(UA.windows, 'Windows')).toBe(true);
        expect(isWindows(UA.windows, 'macOS')).toBe(false);
        expect(isWindows(UA.mac, 'Windows')).toBe(true);
        expect(isWindows(UA.mac)).toBe(false);
        expect(isWindows(UA.linux)).toBe(false);
        expect(isWindows(UA.windowsPhone)).toBe(false);
        expect(isWindows('')).toBe(false);
    });

    it('reads the same Intel test as the device class: an adapter the class calls Intel integrated is one the hint calls due, and the other way round', () => {
        const adapters: GpuInfo[] = [
            gpu(),
            gpu({ architecture: 'xe-hpg', description: 'Intel(R) Arc(TM) A750 Graphics' }),
            gpu({ architecture: 'alchemist', description: '' }),
            gpu({ vendor: 'nvidia', architecture: 'ada' }),
            gpu({ vendor: 'amd', architecture: 'rdna-2' }),
            gpu({ vendor: '', architecture: '' })
        ];
        for (const g of adapters) {
            const s = sig({ gpu: g });
            const integrated = isIntelIntegrated(g);
            expect(classifyDevice(s).reasons.includes('intel-integrated')).toBe(integrated);
            expect(gpuSwitchHintDue(s).due).toBe(integrated);
        }
        expect(isIntelIntegrated(null)).toBe(false);
        expect(isIntelIntegrated(undefined)).toBe(false);
    });
});

describe('the controls: wrong rules the table must catch', () => {
    it('a rule that says it for every Intel adapter disagrees with the table on Arc, macOS, Linux, a software adapter, no WebGPU and a phone (each row fails the wrong rule)', () => {
        const wrong = TABLE.filter((r) => everyIntel(r.s) !== r.due);
        const names = wrong.map((r) => r.reason).sort();
        // the table's rows with an Intel adapter that must stay quiet: Arc (2), macOS and Linux (3), a software adapter that names itself Intel, no WebGPU, a handheld (3)
        expect(names).toEqual(['fallback-adapter', 'handheld', 'handheld', 'handheld', 'intel-discrete', 'intel-discrete', 'no-webgpu', 'not-windows', 'not-windows', 'not-windows']);
        // and it is right where the hint is meant (so the table is not simply the opposite of it)
        expect(TABLE.filter((r) => r.due).every((r) => everyIntel(r.s))).toBe(true);
    });

    it('a rule that forgets WebGPU, one that fires on an unnamed adapter and one that forgets the system each fail a row of the table', () => {
        const noWebgpu = (s: GpuHintSignals): boolean => gpuSwitchHintDue({ ...s, webgpu: true }).due;
        expect(TABLE.some((r) => noWebgpu(r.s) !== r.due && r.reason === 'no-webgpu')).toBe(true);
        const unnamed = (s: GpuHintSignals): boolean => gpuSwitchHintDue({ ...s, gpu: s.gpu === null || s.gpu.vendor === '' ? gpu() : s.gpu }).due;
        expect(TABLE.some((r) => unnamed(r.s) !== r.due && r.reason === 'unknown-adapter')).toBe(true);
        const anySystem = (s: GpuHintSignals): boolean => gpuSwitchHintDue({ ...s, userAgent: UA.windows, platform: 'Windows' }).due;
        expect(TABLE.some((r) => anySystem(r.s) !== r.due && r.reason === 'not-windows')).toBe(true);
    });

    it('the owner\'s own PC (NVIDIA) never gets the hint: the control of the whole feature', () => {
        expect(gpuSwitchHintDue(sig({ gpu: gpu({ vendor: 'nvidia', architecture: 'lovelace', description: '' }) })).due).toBe(false);
    });
});

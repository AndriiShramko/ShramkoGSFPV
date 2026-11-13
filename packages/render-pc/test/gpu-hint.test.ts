// The GPU hint rule (v0.12 lane v12-flight step 11, docs/wip/v12-plan.md 2.12): when does the page tell a pilot how to put the browser on
// the high-performance GPU? On Windows, with WebGPU on a real Intel integrated adapter: a laptop with Intel graphics next to an NVIDIA
// card runs the page on the weaker chip because Chrome on Windows ignores the page's powerPreference. Every other device is left alone.
// A truth table on the browsers it is meant for (the owner's own PC among them: this PC's Chrome reports vendor "nvidia", architecture
// "lovelace", an empty description), and controls that must fail: a rule that says it for every Intel adapter on any system (macOS honours
// the page's request, Arc is discrete, a software adapter cannot be switched), one that forgets WebGPU, one that fires on an adapter the
// browser does not name. The class rule and this one read the same Intel test (isIntelIntegrated).
//
// Lane gpu-select (docs/wip/gpu-select.md): the reading also says WHAT the page draws on (kind, name) and which note is due
// (hint: 'switch', 'software' or null). The strings in the second half are the ones a hybrid laptop's browsers really gave
// (Chrome 140, Edge 157 and Firefox 142 on Intel UHD + NVIDIA RTX 3070, evidence/2026-11-13/gpu-select/*.json): the integrated
// chip by default, the NVIDIA card with the browser's switch on, and SwiftShader / Microsoft Basic Render Driver with no WebGPU
// adapter at all when the browser draws on the processor. Controls: WebGL's software name must not count while WebGPU draws on a
// real adapter, a WebGL name of another vendor is not this adapter's, a discrete AMD card is not an integrated chip.
import { describe, it, expect } from 'vitest';
import { classifyDevice, glRendererName, gpuSwitchHintDue, graphicsKind, graphicsName, isAmdIntegrated, isIntelIntegrated, isSoftwareGraphics, isWindows } from '../src/device-class';
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
            expect(gpuSwitchHintDue(row.s)).toMatchObject({ due: row.due, reason: row.reason });
            // the switch note exactly when due (lane gpu-select: the reading names the note)
            expect(gpuSwitchHintDue(row.s).hint === 'switch').toBe(row.due);
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

// ---- lane gpu-select: what the page draws on, by the words the laptop's browsers gave ----

/** WebGL's renderer strings as read on the hybrid laptop (evidence/2026-11-13/gpu-select). */
const GL = {
    intel: 'ANGLE (Intel, Intel(R) UHD Graphics (0x00009A60) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    nvidia: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x0000249D) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    swiftshader: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    warp: 'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    firefoxIntel: 'ANGLE (Intel, Intel(R) HD Graphics Direct3D11 vs_5_0 ps_5_0), or similar'
};
/** Chrome hides the adapter's model: vendor and architecture only (what the laptop's Chrome 140 and Edge 157 gave). */
const chromeIntel = gpu({ description: '' });
const chromeNvidia = gpu({ vendor: 'nvidia', architecture: 'ampere', description: '' });

describe('the reading says what the page draws on (lane gpu-select)', () => {
    it('the laptop as it was: Intel UHD by default, with its model from WebGL; the switch note is due', () => {
        const r = gpuSwitchHintDue(sig({ gpu: chromeIntel, glRenderer: GL.intel }));
        expect(r).toEqual({ due: true, reason: 'due', kind: 'integrated', hint: 'switch', name: 'Intel(R) UHD Graphics' });
    });

    it('the same laptop with the browser switched: NVIDIA, no note, the card named', () => {
        const r = gpuSwitchHintDue(sig({ gpu: chromeNvidia, glRenderer: GL.nvidia }));
        expect(r).toEqual({ due: false, reason: 'not-intel', kind: 'other', hint: null, name: 'NVIDIA GeForce RTX 3070 Laptop GPU' });
    });

    it('without WebGL\'s name the adapter\'s own words are the name (vendor and architecture where the browser hides the model)', () => {
        expect(gpuSwitchHintDue(sig({ gpu: chromeIntel })).name).toBe('intel gen-12lp');
        expect(gpuSwitchHintDue(sig({ gpu: gpu() })).name).toBe('Intel(R) UHD Graphics');
        expect(gpuSwitchHintDue(sig({ gpu: null, webgpu: false })).name).toBe('');
    });

    it('the browser draws on the processor (hardware acceleration off: no WebGPU adapter, WebGL is SwiftShader): the software note, not the switch', () => {
        const r = gpuSwitchHintDue(sig({ webgpu: false, gpu: null, glRenderer: GL.swiftshader }));
        expect(r).toEqual({ due: false, reason: 'no-webgpu', kind: 'software', hint: 'software', name: 'SwiftShader' });
    });

    it('the graphics driver disabled or missing (WebGL on Windows\' Basic Render Driver): the software note, named', () => {
        const r = gpuSwitchHintDue(sig({ webgpu: false, gpu: null, glRenderer: GL.warp }));
        expect(r).toEqual({ due: false, reason: 'no-webgpu', kind: 'software', hint: 'software', name: 'Microsoft Basic Render Driver' });
    });

    it('a fallback WebGPU adapter is software too, whatever it calls itself, on any desktop system; a handheld gets no note', () => {
        expect(gpuSwitchHintDue(sig({ gpu: gpu({ vendor: 'google', architecture: 'swiftshader', description: 'SwiftShader', isFallback: true }) }))).toMatchObject({ due: false, reason: 'fallback-adapter', kind: 'software', hint: 'software' });
        expect(gpuSwitchHintDue(sig({ gpu: gpu({ isFallback: true }) }))).toMatchObject({ due: false, reason: 'fallback-adapter', kind: 'software', hint: 'software' });
        expect(gpuSwitchHintDue(sig({ userAgent: UA.linux, platform: 'Linux', webgpu: false, gpu: null, glRenderer: 'ANGLE (Mesa, llvmpipe (LLVM 15.0.7 256 bits), OpenGL 4.5)' }))).toMatchObject({ due: false, reason: 'not-windows', kind: 'software', hint: 'software' });
        expect(gpuSwitchHintDue(sig({ userAgent: UA.androidPhone, platform: 'Android', maxTouchPoints: 5, screenShortSide: 412, webgpu: false, gpu: null, glRenderer: GL.swiftshader }))).toMatchObject({ reason: 'handheld', kind: 'software', hint: null });
    });

    it('an adapter that names itself as software without the fallback flag is still software (no switch would help)', () => {
        const r = gpuSwitchHintDue(sig({ gpu: gpu({ vendor: 'microsoft', architecture: '', description: 'Microsoft Basic Render Driver' }) }));
        expect(r).toMatchObject({ due: false, reason: 'fallback-adapter', kind: 'software', hint: 'software' });
    });

    it('control: WebGL\'s software name does not count while WebGPU draws on a real adapter (the page is not on that path)', () => {
        const s = sig({ gpu: chromeNvidia, glRenderer: GL.swiftshader });
        expect(isSoftwareGraphics(s)).toBe(false);
        expect(gpuSwitchHintDue(s)).toMatchObject({ kind: 'other', hint: null, reason: 'not-intel' });
        // and the other way round: with no adapter at all the same name is the only word there is
        expect(isSoftwareGraphics({ webgpu: false, gpu: null, glRenderer: GL.swiftshader })).toBe(true);
        expect(isSoftwareGraphics({ webgpu: false, gpu: null, glRenderer: GL.intel })).toBe(false);
        expect(isSoftwareGraphics({ webgpu: false, gpu: null })).toBe(false);
    });

    it('control: a WebGL name of another vendor is not this adapter\'s (Firefox draws WebGL and WebGPU through different stacks)', () => {
        const s = sig({ gpu: chromeNvidia, glRenderer: GL.intel });
        expect(graphicsName(s)).toBe('nvidia ampere');
        expect(graphicsKind(s)).toBe('other');
        // the same vendor: WebGL's model is the name
        expect(graphicsName(sig({ gpu: chromeNvidia, glRenderer: GL.nvidia }))).toBe('NVIDIA GeForce RTX 3070 Laptop GPU');
    });

    it('a browser that hides its WebGPU adapter (Firefox 142: every field empty): WebGL\'s name stands in, and the laptop on its Intel chip gets the note', () => {
        const hidden = gpu({ vendor: '', architecture: '', description: '' });
        const r = gpuSwitchHintDue(sig({ gpu: hidden, glRenderer: GL.firefoxIntel }));
        expect(r).toEqual({ due: true, reason: 'due', kind: 'integrated', hint: 'switch', name: 'Intel(R) HD Graphics' });
        // the same browser after the switch (WebGL names the card): quiet, and counted as a faster card
        expect(gpuSwitchHintDue(sig({ gpu: hidden, glRenderer: GL.nvidia }))).toEqual({ due: false, reason: 'not-intel', kind: 'other', hint: null, name: 'NVIDIA GeForce RTX 3070 Laptop GPU' });
        // Intel Arc by WebGL's name alone is a card, an AMD chip built into the processor is not
        expect(gpuSwitchHintDue(sig({ gpu: hidden, glRenderer: 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0), or similar' }))).toMatchObject({ due: false, reason: 'intel-discrete', kind: 'other' });
        expect(gpuSwitchHintDue(sig({ gpu: hidden, glRenderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0), or similar' }))).toMatchObject({ due: true, reason: 'due', kind: 'integrated' });
        // control: with no WebGL name either, nothing is known and the page stays quiet (the table's two rows)
        expect(gpuSwitchHintDue(sig({ gpu: hidden }))).toEqual({ due: false, reason: 'unknown-adapter', kind: 'other', hint: null, name: '' });
        expect(gpuSwitchHintDue(sig({ gpu: null }))).toMatchObject({ due: false, reason: 'unknown-adapter', hint: null });
        // control: an adapter that does name itself is never overruled by WebGL's words
        expect(gpuSwitchHintDue(sig({ gpu: chromeNvidia, glRenderer: GL.firefoxIntel }))).toMatchObject({ due: false, reason: 'not-intel' });
    });
});

describe('WebGL\'s renderer string as a name a pilot can check', () => {
    const cases: [string, string][] = [
        [GL.intel, 'Intel(R) UHD Graphics'],
        [GL.nvidia, 'NVIDIA GeForce RTX 3070 Laptop GPU'],
        [GL.swiftshader, 'SwiftShader'],
        [GL.warp, 'Microsoft Basic Render Driver'],
        [GL.firefoxIntel, 'Intel(R) HD Graphics'],
        ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'AMD Radeon(TM) Graphics'],
        ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)', 'Apple M1 Pro'],
        ['ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6 (Core Profile) Mesa 21.2.6)', 'Mesa Intel(R) UHD Graphics 620 (KBL GT2)'],
        ['Mali-G78', 'Mali-G78'],
        ['Apple GPU', 'Apple GPU'],
        ['', '']
    ];
    for (const [raw, name] of cases) {
        it(`${raw || '(empty)'} is "${name}"`, () => {
            expect(glRendererName(raw)).toBe(name);
        });
    }
});

describe('AMD\'s integrated chips, by name (not measured on AMD hardware: the names are the rule)', () => {
    const integrated = ['AMD Radeon(TM) Graphics', 'AMD Radeon(TM) Vega 8 Graphics', 'AMD Radeon(TM) RX Vega 10 Graphics', 'AMD Radeon 780M Graphics', 'AMD Radeon(TM) 680M', 'AMD Radeon(TM) R7 Graphics', 'AMD Radeon(TM) Vega 3 Mobile Graphics'];
    const cards = ['AMD Radeon RX 6600M', 'AMD Radeon RX 7900 XT', 'Radeon RX Vega 64', 'AMD Radeon Pro 5500M', 'Radeon RX 580 Series', 'AMD Radeon(TM) RX 6700M'];

    it('the names of the chips built into the processor are integrated; cards are not (controls)', () => {
        for (const n of integrated) expect(isAmdIntegrated(n), n).toBe(true);
        for (const n of cards) expect(isAmdIntegrated(n), n).toBe(false);
    });

    it('on Windows with WebGPU the switch note is due for an AMD chip built into the processor, and not for an AMD card or an AMD adapter with no name', () => {
        const amd = (model: string): GpuHintSignals => sig({ gpu: gpu({ vendor: 'amd', architecture: 'rdna-3', description: '' }), glRenderer: `ANGLE (AMD, ${model} (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)` });
        for (const n of integrated) expect(gpuSwitchHintDue(amd(n)), n).toMatchObject({ due: true, reason: 'due', kind: 'integrated', hint: 'switch', name: n });
        for (const n of cards) expect(gpuSwitchHintDue(amd(n)), n).toMatchObject({ due: false, reason: 'not-intel', kind: 'other', hint: null });
        expect(gpuSwitchHintDue(sig({ gpu: gpu({ vendor: 'amd', architecture: 'rdna-3', description: '' }) }))).toMatchObject({ due: false, reason: 'not-intel', kind: 'other' });
        // on macOS or with no WebGPU the same chip gets no switch note
        expect(gpuSwitchHintDue({ ...amd(integrated[0] as string), userAgent: UA.mac, platform: 'macOS' })).toMatchObject({ due: false, reason: 'not-windows', hint: null });
        expect(gpuSwitchHintDue({ ...amd(integrated[0] as string), webgpu: false })).toMatchObject({ due: false, reason: 'no-webgpu', hint: null });
    });

    it('the device class is not touched by any of this: an AMD chip is still classed by the hints alone (the hint part only)', () => {
        const s = sig({ gpu: gpu({ vendor: 'amd', architecture: 'rdna-3', description: '' }), glRenderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)' });
        expect(classifyDevice(s).cls).toBe('desktop-strong');
    });
});

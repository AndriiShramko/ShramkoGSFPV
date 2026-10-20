// Device classes (v0.10 lane R, the owner's item 3): which preset a device starts with is decided by its class, so the class
// rule is tested on the browsers it is meant for, the owner's own PC included (this PC's Chrome reports vendor "nvidia",
// architecture "lovelace", an empty description, deviceMemory 32 -> capped 8 by real browsers, 36 cores), and each rule has
// a control that must fail: a rule by touch points alone, a rule that calls every Intel GPU weak (Arc is discrete), a rule
// that ignores the WebGL fallback, one that needs a single weak hint instead of two.
import { describe, it, expect } from 'vitest';
import { classifyDevice, gpuName, impliedClass, isPhoneSized, DEVICE_CLASSES, SMALL_BUFFER_BYTES } from '../src/device-class';
import type { DeviceSignals, GpuInfo } from '../src/device-class';

const UA = {
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
};

const gpu = (o: Partial<GpuInfo> = {}): GpuInfo => ({ vendor: 'nvidia', architecture: 'lovelace', device: '', description: '', isFallback: false, maxBufferSize: 2 ** 31, ...o });
const sig = (o: Partial<DeviceSignals> = {}): DeviceSignals => ({ userAgent: UA.windows, maxTouchPoints: 0, screenShortSide: 1080, webgpu: true, gpu: gpu(), memoryGb: 8, cores: 16, ...o });

describe('classifyDevice: handhelds', () => {
    it('phones: iPhone, Android with Mobile, a small handheld', () => {
        expect(classifyDevice(sig({ userAgent: UA.iphone, maxTouchPoints: 5, screenShortSide: 390, gpu: null })).cls).toBe('phone');
        expect(classifyDevice(sig({ userAgent: UA.androidPhone, maxTouchPoints: 5, screenShortSide: 412, gpu: null })).cls).toBe('phone');
        // Client Hints say mobile on a user agent that does not: the screen decides phone or tablet
        expect(classifyDevice(sig({ userAgent: UA.linux, uaMobile: true, screenShortSide: 360 })).cls).toBe('phone');
        expect(classifyDevice(sig({ userAgent: UA.iphone, maxTouchPoints: 5, screenShortSide: 0 })).reasons).toEqual(['phone']);
    });

    it('tablets: iPad, iPadOS Safari that says Macintosh, Android without Mobile, a big handheld', () => {
        expect(classifyDevice(sig({ userAgent: UA.ipad, maxTouchPoints: 5, screenShortSide: 820 })).cls).toBe('tablet');
        expect(classifyDevice(sig({ userAgent: UA.ipadOS, maxTouchPoints: 5, screenShortSide: 820 })).cls).toBe('tablet');
        expect(classifyDevice(sig({ userAgent: UA.androidTablet, maxTouchPoints: 10, screenShortSide: 800 })).cls).toBe('tablet');
        expect(classifyDevice(sig({ userAgent: UA.linux, uaMobile: true, screenShortSide: 800 })).cls).toBe('tablet');
    });

    it('a handheld is never a desktop whatever its GPU says (the engine\'s WebGPU on a phone is still a phone)', () => {
        expect(classifyDevice(sig({ userAgent: UA.iphone, maxTouchPoints: 5, screenShortSide: 390, gpu: gpu({ vendor: 'apple', architecture: 'common-3' }) })).cls).toBe('phone');
    });

    it('control: a rule by touch points alone calls the Windows laptop with a touch screen a tablet; the real rule does not', () => {
        const byTouch = (s: DeviceSignals) => (s.maxTouchPoints > 0 ? 'tablet' : classifyDevice(s).cls);
        const laptop = sig({ maxTouchPoints: 10, screenShortSide: 900 });
        expect(byTouch(laptop)).toBe('tablet');
        expect(classifyDevice(laptop).cls).toBe('desktop-strong');
        // and a real Mac (no touch points) stays a desktop
        expect(classifyDevice(sig({ userAgent: UA.mac, gpu: gpu({ vendor: 'apple', architecture: 'metal-3' }) })).cls).toBe('desktop-strong');
    });

    it('isPhoneSized: the order of the rules', () => {
        expect(isPhoneSized({ userAgent: UA.ipad, screenShortSide: 300 })).toBe(false); // an iPad is not a phone whatever the window
        expect(isPhoneSized({ userAgent: UA.androidTablet, screenShortSide: 800 })).toBe(false);
        expect(isPhoneSized({ userAgent: UA.androidTablet, screenShortSide: 500 })).toBe(true); // a small Android without Mobile
        expect(isPhoneSized({ userAgent: UA.linux, screenShortSide: 0 })).toBe(false); // unknown screen: a tablet, not a phone
    });
});

describe('classifyDevice: desktops', () => {
    it('this PC (nvidia lovelace, empty description, plenty of memory and cores) is strong', () => {
        expect(classifyDevice(sig({ memoryGb: 8, cores: 36 }))).toEqual({ cls: 'desktop-strong', reasons: ['strong'] });
    });

    it('hard reasons make it weak on their own: no WebGPU, a software adapter, an Intel integrated GPU', () => {
        expect(classifyDevice(sig({ webgpu: false, gpu: null }))).toEqual({ cls: 'desktop-weak', reasons: ['no-webgpu'] });
        expect(classifyDevice(sig({ gpu: gpu({ isFallback: true, vendor: 'google', architecture: 'swiftshader' }) })).reasons).toEqual(['fallback-adapter']);
        expect(classifyDevice(sig({ gpu: gpu({ vendor: 'intel', architecture: 'gen-12lp' }) })).reasons).toEqual(['intel-integrated']);
        expect(classifyDevice(sig({ gpu: gpu({ vendor: 'Intel', architecture: 'gen-9', description: 'Intel(R) UHD Graphics 620' }) })).cls).toBe('desktop-weak');
    });

    it('Intel Arc and Xe-HPG are discrete: not weak by vendor', () => {
        expect(classifyDevice(sig({ gpu: gpu({ vendor: 'intel', architecture: 'xe-hpg' }) })).cls).toBe('desktop-strong');
        expect(classifyDevice(sig({ gpu: gpu({ vendor: 'intel', architecture: 'xe2-hpg', description: 'Intel(R) Arc(TM) B580' }) })).cls).toBe('desktop-strong');
        expect(classifyDevice(sig({ gpu: gpu({ vendor: 'intel', architecture: 'gen-12lp', description: 'Intel(R) Arc(TM) A370M Graphics' }) })).cls).toBe('desktop-strong');
        // control: a rule that calls every Intel GPU weak fails these three
        const everyIntel = (s: DeviceSignals) => (s.gpu?.vendor === 'intel' ? 'desktop-weak' : classifyDevice(s).cls);
        expect(everyIntel(sig({ gpu: gpu({ vendor: 'intel', architecture: 'xe-hpg' }) }))).toBe('desktop-weak');
    });

    it('soft hints need two: little memory, few cores, small buffers', () => {
        expect(classifyDevice(sig({ memoryGb: 4 })).cls).toBe('desktop-strong');
        expect(classifyDevice(sig({ cores: 4 })).cls).toBe('desktop-strong');
        expect(classifyDevice(sig({ gpu: gpu({ maxBufferSize: SMALL_BUFFER_BYTES - 1 }) })).cls).toBe('desktop-strong');
        expect(classifyDevice(sig({ memoryGb: 4, cores: 4 }))).toEqual({ cls: 'desktop-weak', reasons: ['little-memory', 'few-cores'] });
        expect(classifyDevice(sig({ cores: 2, gpu: gpu({ maxBufferSize: 256 * 1024 * 1024 }) })).reasons).toEqual(['few-cores', 'small-buffers']);
        // control: a rule that needs one hint calls these single-hint desktops weak
        const oneHint = (s: DeviceSignals) => ((s.memoryGb ?? 8) <= 4 || (s.cores ?? 16) <= 4 ? 'desktop-weak' : classifyDevice(s).cls);
        expect(oneHint(sig({ memoryGb: 4 }))).toBe('desktop-weak');
    });

    it('unknown signals count for nothing: a browser that hides the GPU, the memory and the cores is strong', () => {
        expect(classifyDevice({ userAgent: UA.windows, maxTouchPoints: 0, screenShortSide: 0, webgpu: true }).cls).toBe('desktop-strong');
        expect(classifyDevice(sig({ gpu: gpu({ vendor: '', architecture: '', maxBufferSize: 0 }), memoryGb: undefined, cores: undefined })).cls).toBe('desktop-strong');
        // a deviceMemory of 0 or a negative number is not "little memory"
        expect(classifyDevice(sig({ memoryGb: 0, cores: 0 })).cls).toBe('desktop-strong');
    });

    it('control: a rule that ignores the WebGL fallback calls a no-WebGPU desktop strong', () => {
        const ignoresFallback = (s: DeviceSignals) => classifyDevice({ ...s, webgpu: true });
        expect(ignoresFallback(sig({ webgpu: false, gpu: null })).cls).toBe('desktop-strong');
        expect(classifyDevice(sig({ webgpu: false, gpu: null })).cls).toBe('desktop-weak');
    });
});

describe('the class table', () => {
    it('four classes, in the order the admin lists them', () => {
        expect([...DEVICE_CLASSES]).toEqual(['desktop-strong', 'desktop-weak', 'tablet', 'phone']);
    });

    it('impliedClass: what a bare set of flags means (used when the page has not read the adapter)', () => {
        expect(impliedClass({ webgpu: true, handheld: false, mobile: false })).toBe('desktop-strong');
        expect(impliedClass({ webgpu: false, handheld: false, mobile: false })).toBe('desktop-weak');
        expect(impliedClass({ webgpu: true, handheld: true, mobile: true })).toBe('phone');
        expect(impliedClass({ webgpu: true, handheld: true, mobile: false })).toBe('tablet');
    });

    it('gpuName: vendor and architecture for the settings line, nothing when the browser hides both', () => {
        expect(gpuName(gpu())).toBe('nvidia lovelace');
        expect(gpuName(gpu({ architecture: '', device: 'RTX' }))).toBe('nvidia RTX');
        expect(gpuName(gpu({ vendor: '', architecture: '' }))).toBe('');
        expect(gpuName(null)).toBe('');
    });
});

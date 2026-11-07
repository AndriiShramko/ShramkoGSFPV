// v0.12 Fly by Sound, lane v12-flight step 6 (docs/wip/v12-plan.md 4.2): the helper's view of the lesson worlds in the
// real renderer. Opens apps/fly/lab/sonic-primitives.html on the Vite dev server (the page's own SplatRenderer and
// PrimitiveStage on the lesson background), puts the camera where a pilot flies and where a helper looks along the
// course, and takes a screenshot of each. Holds the GPU lock (C:/dev/.gpu-lock) while it draws.
//   cd apps/fly && npx vite --port 5342 --strictPort            (another shell)
//   cd tools/bench && LAB=http://localhost:5342 npx tsx src/sonic-primitives-shot.ts
// Writes evidence/<date>/sonic-primitives/*.png and evidence/<date>/sonic-primitives.json. Each shot is checked for
// content (a picture that is not one flat colour: luminance spread and the share of lit pixels), and every pose has a
// control: the same camera with the stage emptied, which must be flat (the content check can fail).
import { mkdirSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launch } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const LAB = (process.env.LAB ?? '').replace(/\/$/, '');
if (!LAB) throw new Error('LAB=http://localhost:<vite port> is needed');
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function lock(): Promise<void> {
    let waited = 0;
    for (;;) {
        try {
            mkdirSync(LOCK);
            return;
        } catch {
            try {
                if (Date.now() - statSync(LOCK).mtimeMs > 20 * 60 * 1000) {
                    rmdirSync(LOCK);
                    continue;
                }
            } catch {
                /* gone */
            }
            if (!waited++ || waited % 600 === 0) console.log('waiting for the GPU lock');
            await sleep(100);
        }
    }
}
const unlock = (): void => {
    try {
        rmdirSync(LOCK);
    } catch {
        /* not ours any more */
    }
};
process.on('SIGINT', () => {
    unlock();
    process.exit(130);
});

type Vec3 = [number, number, number];
interface Lab {
    ready: boolean;
    isWebGPU: boolean;
    frames: { n: number };
    look(pos: Vec3, yawDeg: number, pitchDeg?: number): void;
    showLesson(id: string): { prims: number; start: { pos: Vec3; yawDeg: number }; bounds: { min: Vec3; max: Vec3 }; landmarks: { id: string; pos: Vec3 }[]; objects: { id: string; pos: Vec3 }[] };
    showObjects(objects: unknown[]): number;
    setTarget(id: string | null): void;
    count(): number;
}

const OUT = join(REPO, 'evidence', today(), 'sonic-primitives');
mkdirSync(OUT, { recursive: true });

/** Luminance spread and the share of pixels that are not near the dark background, of a PNG decoded in a helper page. */
async function stats(helper: Page, png: Buffer): Promise<{ std: number; lit: number; mean: number }> {
    return helper.evaluate(async (b64) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        let s = 0, s2 = 0, n = 0, lit = 0;
        for (let i = 0; i < d.length; i += 16) {
            const L = (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255;
            s += L;
            s2 += L * L;
            n++;
            if (L > 0.08) lit++;
        }
        const mean = s / n;
        return { std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), lit: lit / n, mean };
    }, png.toString('base64'));
}

interface Shot {
    name: string;
    lesson: string;
    /** from the world: 'start' (where the pilot starts), or a landmark id, or an explicit pose */
    at: 'start' | string | { pos: Vec3; yawDeg: number };
    yawDeg?: number;
    pitchDeg?: number;
    /** height over the landmark / start, m (default: the start's own height) */
    height?: number;
    target?: string;
}

const SHOTS: Shot[] = [
    { name: 'hall-start', lesson: 'walls-hall', at: 'start' },
    { name: 'hall-corner', lesson: 'walls-hall', at: { pos: [-17, 9, 26], yawDeg: 28 }, pitchDeg: -12 },
    { name: 'corridor-start', lesson: 'corridor', at: 'start' },
    { name: 'corridor-obstacle', lesson: 'corridor', at: 'section-obstacle', yawDeg: 0 },
    { name: 'corridor-bends', lesson: 'corridor', at: 'section-bends', yawDeg: 90 },
    { name: 'corridor-jogs', lesson: 'corridor', at: 'section-jogs', yawDeg: 0, pitchDeg: 3 },
    { name: 'corridor-mixed', lesson: 'corridor', at: 'section-mixed', yawDeg: 90 },
    { name: 'rings-first', lesson: 'rings-first', at: 'start' },
    { name: 'rings-first-lit', lesson: 'rings-first', at: 'start', target: 'ring-1' },
    { name: 'rings-line', lesson: 'rings-line', at: 'start', pitchDeg: 2 },
    { name: 'rings-course', lesson: 'rings-course', at: 'start' },
    { name: 'rings-small', lesson: 'rings-small', at: 'start' },
    { name: 'square-start', lesson: 'shapes-square', at: 'start' },
    { name: 'cube-start', lesson: 'shapes-cube', at: 'start' },
    { name: 'pillar-start', lesson: 'walls-pillar', at: 'start' },
    { name: 'pillar-row', lesson: 'walls-row', at: 'start' },
    { name: 'zone-move-stop', lesson: 'move-stop', at: 'start' },
    { name: 'open-hover', lesson: 'hover-height', at: 'start' }
];

await lock();
const results: Record<string, unknown>[] = [];
try {
    const L = await launch({ width: 1280, height: 720 });
    const helper = await L.context.newPage();
    const page = L.page;
    const notFound: string[] = [];
    page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });
    await page.goto(`${LAB}/fly/lab/sonic-primitives.html`);
    await page.waitForFunction(() => (window as unknown as { __sonicLab?: Lab }).__sonicLab?.ready === true, undefined, { timeout: 60000 });
    const webgpu = await page.evaluate(() => (window as unknown as { __sonicLab: Lab }).__sonicLab.isWebGPU);
    const frame = async (n = 6): Promise<void> => {
        const f0 = await page.evaluate(() => (window as unknown as { __sonicLab: Lab }).__sonicLab.frames.n);
        for (let i = 0; i < 200; i++) {
            const f = await page.evaluate(() => (window as unknown as { __sonicLab: Lab }).__sonicLab.frames.n);
            if (f >= f0 + n) return;
            await sleep(20);
        }
        throw new Error('the lab page draws no frames');
    };
    for (const s of SHOTS) {
        const info = await page.evaluate((id) => (window as unknown as { __sonicLab: Lab }).__sonicLab.showLesson(id), s.lesson);
        let pos: Vec3;
        let yaw: number;
        if (typeof s.at === 'object') {
            pos = s.at.pos;
            yaw = s.at.yawDeg;
        } else if (s.at === 'start') {
            pos = info.start.pos as Vec3;
            yaw = info.start.yawDeg;
        } else {
            const m = info.landmarks.find((x) => x.id === s.at);
            if (!m) throw new Error(`${s.lesson} has no landmark ${s.at}`);
            pos = [...m.pos] as Vec3;
            yaw = 0;
        }
        if (s.height !== undefined) pos = [pos[0], s.height, pos[2]];
        if (s.yawDeg !== undefined && typeof s.at !== 'object') yaw = s.yawDeg;
        await page.evaluate(([p, y, pt, tg]) => {
            const lab = (window as unknown as { __sonicLab: Lab }).__sonicLab;
            lab.look(p as Vec3, y as number, pt as number);
            lab.setTarget(tg as string | null);
        }, [pos, yaw, s.pitchDeg ?? 0, s.target ?? null] as const);
        await frame();
        const png = await page.screenshot({ type: 'png' });
        writeFileSync(join(OUT, `${s.name}.png`), png);
        const st = await stats(helper, png);
        // control: the same camera, nothing on the stage
        await page.evaluate(() => (window as unknown as { __sonicLab: Lab }).__sonicLab.showObjects([]));
        await frame();
        const empty = await stats(helper, await page.screenshot({ type: 'png' }));
        const pass = st.std > 0.03 && st.lit > 0.05 && empty.std < 0.005 && empty.lit < 0.005;
        results.push({ shot: s.name, lesson: s.lesson, prims: info.prims, pos, yawDeg: yaw, pitchDeg: s.pitchDeg ?? 0, target: s.target ?? null, picture: st, control: empty, pass });
        console.log(`${s.name.padEnd(18)} prims ${String(info.prims).padStart(3)}  std ${st.std.toFixed(3)} lit ${st.lit.toFixed(3)}  | control std ${empty.std.toFixed(4)} lit ${empty.lit.toFixed(4)}  ${pass ? 'PASS' : 'FAIL'}`);
    }
    // a browser asks for /favicon.ico by itself; any other missing file is a fault
    const missing = notFound.filter((u) => !/\/favicon\.ico$/.test(u));
    const errors = L.console.filter((l) => /^(error|pageerror)/i.test(l) && !(/404/.test(l) && missing.length === 0));
    const file = writeEvidence('sonic-primitives', {
        step: 'v12-flight 6: the helper\'s view of the lesson worlds (primitives.ts) in the page\'s own renderer',
        page: 'apps/fly/lab/sonic-primitives.html (Vite dev server)',
        webgpu,
        viewport: [1280, 720],
        shots: results,
        consoleErrors: errors,
        notFound,
        pass: results.every((r) => r.pass === true) && errors.length === 0
    });
    console.log(`evidence ${file}; ${results.filter((r) => r.pass).length}/${results.length} shots pass; console errors ${errors.length}`);
    await L.browser.close();
} finally {
    unlock();
}

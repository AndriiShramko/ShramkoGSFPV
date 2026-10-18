// Screenshots of the 3D drone models from the lab page (apps/fly/lab/drones3d.html, dev server) while the models are
// being made (v0.9 lane D). Takes the GPU lock (C:/dev/.gpu-lock) while it draws. The evidence shots of the finished
// feature come from the real drone picker (accept-v09-drones3d.ts), not from here.
//   cd apps/fly && npx vite --port <port> --strictPort      (another shell)
//   cd tools/bench && LAB=http://localhost:<port> OUT=<dir> npx tsx src/drones3d-shots.ts [drone ids...] [-- yaw=.. pitch=.. dist=.. payload=..]
import { mkdirSync, rmdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './browser';

const LAB = (process.env.LAB ?? '').replace(/\/$/, '');
if (!LAB) throw new Error('LAB=http://localhost:<vite port> is needed');
const OUT = process.env.OUT ?? 'C:/dev/gsfpv-v09-d-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const cut = args.indexOf('--');
const ids = (cut < 0 ? args : args.slice(0, cut)).filter(Boolean);
const extra = cut < 0 ? [] : args.slice(cut + 1);
const ALL = ['pavo20pro-3s', 'pavo20pro2-3s', 'pavo20pro2-4s', 'pavopico-2s', 'meteor65pro-1s', 'air65-1s', 'nazgulf5v3-6s', 'machr5sport-6s', 'taurusx8-komodo-6s'];
const LOCK = 'C:/dev/.gpu-lock';

let waited = 0;
async function lock(): Promise<void> {
    for (;;) {
        try { mkdirSync(LOCK); return; } catch {
            try { if (Date.now() - statSync(LOCK).mtimeMs > 20 * 60 * 1000) { rmdirSync(LOCK); continue; } } catch { /* gone */ }
            if (!waited++ || waited % 600 === 0) console.log('waiting for the GPU lock');
            await sleep(100);
        }
    }
}
const unlock = (): void => { try { rmdirSync(LOCK); } catch { /* */ } };
process.on('SIGINT', () => { unlock(); process.exit(130); });

await lock();
try {
    const L = await launch({ width: 1100, height: 720 });
    // VIEWS="yaw:pitch:dist;..." takes several pictures of each drone (the default: the first view only)
    const views = (process.env.VIEWS ?? '').split(';').filter(Boolean).map((v) => v.split(':'));
    for (const id of ids.length ? ids : ALL) {
        for (const [vi, view] of (views.length ? views : [[]]).entries()) {
            const vq = view.length ? `&yaw=${view[0]}&pitch=${view[1]}&dist=${view[2] ?? 2.25}` : '';
            const url = `${LAB}/fly/lab/drones3d.html?drone=${id}${vq}${extra.length ? '&' + extra.join('&') : ''}`;
            await L.page.goto(url);
            await L.page.waitForFunction(() => (window as unknown as { __lab?: { ready: boolean; studio: { frames: number } } }).__lab?.ready && (window as unknown as { __lab: { studio: { frames: number } } }).__lab.studio.frames > 20, undefined, { timeout: 60000 });
            await sleep(600);
            const tally = await L.page.evaluate(() => (window as unknown as { __lab: { tally(): unknown } }).__lab.tally());
            await L.page.screenshot({ path: join(OUT, `${id}${views.length ? `-v${vi}` : ''}${extra.length ? '-' + extra.join('-').replace(/[^\w=.-]/g, '') : ''}.png`) });
            console.log(id, vi, JSON.stringify(tally), L.console.filter((l) => /error|warn/i.test(l)).slice(-3).join(' | '));
            L.console.length = 0;
        }
    }
    await L.browser.close();
} finally {
    unlock();
}

// The lead's eyes on a deployed site: two pilots in one room, a screenshot from B while A's drone and name tag are in
// B's view. Not a check with a verdict (train1-live.ts measures); it only keeps pictures.
//   cd tools/bench && SITE=https://gsfpv.flyreelstudio.eu SHOTS=<dir> npx tsx src/rooms-shot-live.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launch, waitReady } from './browser';
import { lock, unlock } from './gpu-lock';

const SITE = (process.env.SITE ?? '').replace(/\/+$/, '');
const SCENE = process.env.ROOM_SCENE ?? '39e63ce9';
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'gsfpv-rooms-shot');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const rooms = <T>(p: Page, js: string): Promise<T> => p.evaluate(`(() => { const r = window.__gsfpv.rooms; ${js} })()`) as Promise<T>;

async function main(): Promise<void> {
    if (!/^https?:\/\//.test(SITE)) throw new Error('SITE is not set');
    mkdirSync(SHOTS, { recursive: true });
    await lock();
    const LA = await launch();
    const LB = await launch();
    try {
        const a = LA.page;
        await a.goto(`${SITE}/en/fly/?scene=${SCENE}&simradio=scenario&nowarn=1&rooms=1`);
        await waitReady(a, 240000);
        await sleep(1500);
        await a.keyboard.press('Shift+KeyL');
        await a.locator('[data-action=rooms-create]').click({ timeout: 15000 });
        for (let i = 0; i < 80 && !(await rooms<boolean>(a, "return r.state === 'joined' && !!r.link;").catch(() => false)); i++) await sleep(250);
        const link = await rooms<string>(a, 'return r.link;');
        writeFileSync(join(SHOTS, 'rooms-live-a-screen.png'), await a.screenshot());
        await a.keyboard.press('Escape').catch(() => undefined);
        const b = LB.page;
        await b.goto(`${link}&simradio=scenario&nowarn=1`);
        await waitReady(b, 240000);
        let kept = 0;
        const seen: unknown[] = [];
        for (let i = 0; i < 120 && kept < 3; i++) {
            const st = await rooms<{ tags: unknown[]; remotes: number; members: number }>(b, 'return { tags: r.tags || [], remotes: r.remotes.length, members: r.members.length };').catch(() => null);
            if (st && st.tags.length > 0) {
                writeFileSync(join(SHOTS, `rooms-live-b-tag-${++kept}.png`), await b.screenshot());
                seen.push(st);
                await sleep(1500);
            } else await sleep(250);
        }
        if (!kept) writeFileSync(join(SHOTS, 'rooms-live-b-no-tag.png'), await b.screenshot());
        console.log(JSON.stringify({ kept, seen: seen.slice(0, 3), shots: SHOTS }));
    } finally {
        await LA.browser.close().catch(() => undefined);
        await LB.browser.close().catch(() => undefined);
        unlock();
    }
}

await main();

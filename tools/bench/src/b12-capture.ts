// B12's negative control as the page flies it: open the control flight (a 0.5 * v_bounce dash into
// a wall, set.respawn.auto=0), wait for the scenario to end, save the page's own flight log (format
// /2, app/logs.ts) and its events. The log replays in Node (b12-replay.ts) tick for tick.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5322 npx tsx src/b12-capture.ts [out.json]
import { writeFileSync } from 'node:fs';
import { launch, waitReady } from './browser';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5322').replace(/\/$/, '');
const out = process.argv[2] ?? 'b12-flight.json';
const L = await launch();
try {
    const page = L.page;
    await page.goto(`${SITE}/fly/?scene=39e63ce9&simradio=scenario&nowarn=1&set.respawn.auto=0&cb=${Math.random().toString(36).slice(2)}`);
    await waitReady(page, 180000);
    const vBounce = (await page.evaluate('window.__gsfpv.session.params.vBounce')) as number;
    await page.goto(`${SITE}/fly/?scene=39e63ce9&simradio=scenario&nowarn=1&dash=${0.5 * vBounce}&set.respawn.auto=0&cb=${Math.random().toString(36).slice(2)}`);
    await waitReady(page, 180000);
    const t0 = Date.now();
    let phase = '';
    while (Date.now() - t0 < 120000) {
        phase = (await page.evaluate('window.__gsfpv.scenario.phase')) as string;
        if (phase === 'done' || phase === 'rest') break;
        await page.waitForTimeout(300);
    }
    const r = (await page.evaluate(`(() => { const h = window.__gsfpv; const e = h.saveLog('b12-control');
        return { phase: h.scenario.phase, scenario: h.scenario.log, events: h.events.filter((x) => x.type !== 'contact'),
            contacts: h.events.filter((x) => x.type === 'contact').length,
            bot: { task: h.scenario.bot.task, dashRestarts: h.scenario.bot.dashRestarts }, plan: h.scenario.plan, flight: e.flight }; })()`)) as Record<string, unknown>;
    writeFileSync(out, JSON.stringify({ vBounce, ...r }));
    const ev = r.events as { type: string; tick: number; speed?: number }[];
    console.log('phase', r.phase, 'contacts', r.contacts, 'bot', JSON.stringify(r.bot), 'events', JSON.stringify(ev.slice(-6)), '->', out);
} finally {
    await L.browser.close();
}

// Scratch probe (lane C): which page error does a logic-only flight raise, and does the base build raise it too?
//   node tools/bench/scripts/serve-csp.mjs <dist> <port>   (another shell)
//   SITE=http://localhost:<port> npx tsx src/probe-v09-c-errors.ts
import { launchChrome, waitReady } from './browser';

const SITE = (process.env.SITE ?? 'http://localhost:5870').replace(/\/$/, '');
const { browser } = await launchChrome({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
const errs: string[] = [];
p.on('pageerror', (e) => errs.push(`${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`));
await p.goto(`${SITE}/en/fly/?scene=${process.env.SCENE ?? '39e63ce9'}&nowarn=1&input=touch&render=off`);
const r = await waitReady(p, 180000);
if (process.env.FLOW === 'switch') await p.evaluate(`window.__gsfpv.scenes.load('${process.env.TO ?? '7a475d38'}', 'next')`);
await p.waitForTimeout(Number(process.env.WAIT ?? 4000));
console.log('status', r.status, 'errors', errs.length);
console.log(errs.slice(0, 2).join('\n---\n'));
await browser.close();

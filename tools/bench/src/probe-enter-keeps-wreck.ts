// Live probe (W4-5): Enter while the automatic-respawn toast counts down keeps the wreck: the crash
// panel shows and no respawn follows. Control: the same crash without Enter respawns by itself.
//   SITE=https://gsfpv.flyreelstudio.eu npx tsx src/probe-enter-keeps-wreck.ts
// Logic-only mode (?render=off). Evidence: evidence/<date>/v03-enter-keeps-wreck.json.
import { chromium } from 'playwright';
import { writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'https://gsfpv.flyreelstudio.eu').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const browser = await chromium.launch({ channel: 'chrome', headless: false });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
async function run(pressEnter: boolean): Promise<Any> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(fly('scene=39e63ce9&simradio=scenario&nowarn=1&render=off'));
    const state = 'return { status: h && h.status, toast: !!document.querySelector("[data-testid=crash-toast]"), panel: !!document.querySelector("[data-testid=crash-panel]"), crashed: s ? s.sim.crashed : null, lives: s && s.lives ? s.lives().length : 0 };';
    const ev = (body: string) => p.evaluate(`(() => { const h = window.__gsfpv; const s = h && h.session; ${body} })()`) as Promise<Any>;
    const until = async (ok: (v: Any) => boolean, ms: number) => { const t0 = Date.now(); let v = await ev(state); while (!ok(v) && Date.now() - t0 < ms) { await p.waitForTimeout(50); v = await ev(state); } return v; };
    await until((v) => v.status === 'ready', 180000);
    const atToast = await until((v) => v.toast, 120000);
    if (pressEnter) await p.keyboard.press('Enter');
    await p.waitForTimeout(4000); // the toast's delay is 2 s
    const after = await ev(state);
    await ctx.close();
    return { atToast, after };
}
const enter = await run(true);
const plain = await run(false);
await browser.close();
const pass = enter.atToast.toast && enter.after.panel && enter.after.crashed === true && enter.after.lives === enter.atToast.lives;
// the test pilot flies on after its respawn and may crash again: a new life and no crash panel is the respawn
const fired = plain.atToast.toast && !plain.after.panel && plain.after.lives > plain.atToast.lives;
const out = { site: SITE, pass: pass && fired, what: 'Enter during the respawn countdown keeps the wreck: the crash panel shows, still crashed 4 s later, no new life', enter, control: { what: 'the same crash without Enter: the drone respawns by itself (a new life, no crash panel)', plain, fired } };
console.log(pass && fired ? 'PASS' : 'FAIL', JSON.stringify({ enter: enter.after, plain: plain.after }));
console.log(writeEvidence('v03-enter-keeps-wreck', out));

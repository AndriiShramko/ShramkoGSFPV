// v0.9 lane R: the ways a person really writes the owner's address into OUR address bar, that are not the
// canonical /fly/?scene=<id>&budget=8&stochastic. SuperSplat says "add ?budget=8&stochastic to the URL"; on our
// page the URL already has ?scene=..., so the literal copy gives ...?scene=2f1ddf5f?budget=8&stochastic. Which
// of them open a scene, which end in the picker with "not a SuperSplat link"? No scan is drawn when the link is
// refused (only the picker), and no GPU lock is taken: forms that DO open are not waited for (the page is left
// as soon as the status says so).
//   SITE=http://127.0.0.1:5391 npx tsx src/probe-v09-r-badforms.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from './browser';
import { REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5391').replace(/\/$/, '');
const ID = '2f1ddf5f';
const FORMS: [string, string][] = [
    ['canonical deep link', `scene=${ID}&budget=8&stochastic`],
    ['second ? instead of & (SuperSplat\'s syntax copied literally)', `scene=${ID}?budget=8&stochastic`],
    ['the whole SuperSplat link, raw', `scene=https://superspl.at/scene/${ID}?budget=8&stochastic`],
    ['id then & (budget inside the scene value)', `scene=${ID}%26budget=8&stochastic`],
    ['the link wrapped as chat apps do', `scene=${encodeURIComponent(`<https://superspl.at/scene/${ID}?budget=8&stochastic>.`)}`],
    ['the viewer address form', `scene=${encodeURIComponent(`https://superspl.at/view?id=${ID}&budget=8&stochastic`)}`]
];

const { browser, which } = await launchChrome({ headless: true });
const rows: Record<string, unknown>[] = [];
try {
    for (const [name, qs] of FORMS) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
        await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
        const page = await ctx.newPage();
        await page.goto(`${SITE}/en/fly/?${qs}&nowarn=1&input=touch&render=off`);
        // render=off: logic only, no scan is downloaded or drawn (test-modes.ts); the status tells what the page did
        await page.waitForFunction(() => { const s = (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status; return s !== undefined && s !== 'loading'; }, null, { timeout: 60000 }).catch(() => undefined);
        const st = await page.evaluate(() => {
            const h = (window as unknown as { __gsfpv?: { status?: string; errorCode?: string; drawing?: { request?: unknown; budgetM?: number; stochastic?: boolean } } }).__gsfpv;
            return { status: h?.status ?? null, errorCode: h?.errorCode ?? null, request: h?.drawing?.request ?? null, budgetM: h?.drawing?.budgetM ?? null, stochastic: h?.drawing?.stochastic ?? null, pickerError: (document.querySelector('.scene-error') || {} as Element).textContent || '', search: location.search };
        });
        rows.push({ name, qs, ...st });
        console.log(JSON.stringify({ name, status: st.status, err: st.errorCode, pickerError: st.pickerError.slice(0, 40), request: st.request, budgetM: st.budgetM, search: st.search }));
        await ctx.close();
    }
} finally {
    await browser.close().catch(() => undefined);
}
const out = join(REPO, 'evidence', today(), `v09-r-badforms${process.env.TAG ? '-' + process.env.TAG : ''}.json`);
mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
writeFileSync(out, JSON.stringify({ site: SITE, browser: which, rows }, null, 2));
console.log('written', out);

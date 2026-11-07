// Fly by Sound, step 3: the recordings kept on this device, in a real browser (headless Chrome, a fake microphone, real OPFS, real DOM,
// real downloads, the live headers through serve-csp.mjs, no scan drawn: --disable-gpu, no GPU lock needed). The real helper's panel,
// registry and resume offer run on a stand-in context (the flight lane's runtime, samples and key router are not built yet).
//   E1 save     a recording ended by T, the panel opens on it, "Save to disk" downloads a .zip; the SAVED BYTES (not the download event)
//               are read back strictly and match what the page packed; control: one flipped byte is refused by the same reader
//   E2 picker   with a file picker (a stand-in: no automation can drive the real native dialog) the blob is written whole; a person who
//               closes the picker gets a cancelled message and no download
//   E3 resume   a tab killed mid-recording; at the next start the pilot is told how to keep it (rec.recover, key T), T keeps it, the panel
//               lists it, it saves and reads strictly as not complete; Delete asks first and then removes the folder
//   E4 helper   Start is disabled until the pilot's agreement is ticked, starts in the click, the pilot's answers (under 18, guardian,
//               nickname) survive a reload and are in the package; typing T in the nickname field is not a shortcut
//   E5 texts    the panel in all four languages shows no missing key; with the sound mode off nothing is drawn
//   npx tsx tools/bench/src/sonicrec-local.ts       evidence/<date>/sonicrec-local.json and sonicrec-panel.png
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import type { Plugin } from 'esbuild';
import type { BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO as EVIDENCE_REPO, today, writeEvidence } from './evidence';
import { REPO, makeDist, serveDist } from './sonicrec-serve';
import { readPackage } from '../../../packages/sonic-fpv/src';
import { packageFileName } from '../../../apps/fly/src/sonic-session/save';

const SHIM = join(REPO, 'tools', 'bench', 'test', 'sonicrec-i18n-shim.ts');
const shim: Plugin = { name: 'i18n-shim', setup: (b) => b.onResolve({ filter: /\/i18n$/ }, (a) => (a.importer.includes('sonic-session') ? { path: SHIM } : undefined)) };
const bundle = await build({ entryPoints: [join(REPO, 'tools', 'bench', 'test', 'sonicrec-local-page.ts')], outdir: 'out', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent', plugins: [shim] });
const out = (ext: string): string => bundle.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? '';
const dist = makeDist({
    'en/fly/index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sonicrec</title><link rel="stylesheet" href="/fly/assets/local.css"><style>body{background:#07080a;color:#e8eaed;font:15px system-ui}</style></head><body><main><p>The flight page stand-in.</p></main><script type="module" src="/fly/assets/local.js"></script></body></html>',
    'fly/assets/local.js': out('.js'),
    'fly/assets/local.css': out('.css')
});
const served = await serveDist(dist);
const { browser, which } = await launchChrome({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-gpu'] });

const call = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
    page.evaluate(([f, a]) => (window as unknown as { __loc: Record<string, (...x: unknown[]) => unknown> }).__loc[f as string]?.(...(a as unknown[])) as unknown, [fn, args] as const) as Promise<T>;
const state = (page: Page): Promise<Record<string, any>> => call(page, 'state'); // eslint-disable-line @typescript-eslint/no-explicit-any
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const tmp = join(EVIDENCE_REPO, '.cache', 'sonicrec-local');
mkdirSync(tmp, { recursive: true });
mkdirSync(join(EVIDENCE_REPO, 'evidence', today()), { recursive: true });

async function until(page: Page, what: string, pred: (s: Record<string, any>) => boolean, ms = 15000): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const t0 = Date.now();
    for (;;) {
        const s = await state(page);
        if (pred(s)) return s;
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}: ${JSON.stringify({ phase: s.phase, rows: s.rows, panelMessage: s.panelMessage })}`);
        await sleep(50);
    }
}

/** `initScript`: plain JavaScript text run before the page's own scripts (a function would be rewritten by the TypeScript runner and lose its helpers in the page). */
async function newContext(initScript?: string): Promise<BrowserContext> {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1100, height: 760 } });
    await ctx.grantPermissions(['microphone'], { origin: served.origin });
    if (initScript !== undefined) await ctx.addInitScript({ content: initScript });
    return ctx;
}

/** No file picker: the browser downloads, as every browser without the File System Access API does. */
const NO_PICKER = 'window.showSaveFilePicker = undefined;';

async function open(ctx: BrowserContext, init: { mode?: boolean } = {}, query = ''): Promise<Page> {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    await page.goto(`${served.origin}/en/fly/${query}`);
    await page.waitForFunction(() => (window as unknown as { __loc?: unknown }).__loc !== undefined);
    await page.bringToFront();
    await call(page, 'init', init);
    return page;
}

/** T, T with real key presses; resolves when the recording runs. */
async function recordWithKeys(page: Page): Promise<void> {
    await page.keyboard.press('KeyT');
    await until(page, 'the question', (s) => s.phase === 'asking');
    await page.keyboard.press('KeyT');
    await until(page, 'the recording', (s) => s.phase === 'recording');
}

const results: Record<string, unknown> = {};
const checks: Record<string, boolean> = {};

/** Clicks Save on the first row that has it and returns the bytes the browser SAVED (not the event: the file). */
async function downloadFirst(page: Page): Promise<{ bytes: Uint8Array; name: string }> {
    let download;
    try {
        [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Save to disk' }).first().click({ timeout: 10000 })]);
    } catch (e) {
        const st = await state(page);
        throw new Error(`no download: ${String(e).slice(0, 120)} panel message: ${st.panelMessage}; status: ${st.panelStatus}; rows: ${JSON.stringify(st.rows)}`);
    }
    const path = join(tmp, `dl-${Date.now()}.zip`);
    await download.saveAs(path);
    const bytes = new Uint8Array(readFileSync(path));
    log('downloaded', download.suggestedFilename(), bytes.length, 'bytes, failure:', await download.failure());
    return { bytes, name: download.suggestedFilename() };
}

try {
    log('browser up', which.version);

    // ---------------------------------------------------------------- E1: save by download, read back the saved bytes
    {
        const ctx = await newContext(NO_PICKER);
        const page = await open(ctx);
        await call(page, 'deleteAll');
        const idle = await until(page, 'the toggle button', (s) => s.panelBuilt === true && s.toggleHidden === false);
        checks['E1: with the sound mode on the toggle button is there, and the panel is closed'] = idle.toggleHidden === false && idle.panelOpen === false && idle.toggleText === 'Recording';
        await call(page, 'fly', true);
        await recordWithKeys(page);
        await sleep(5000);
        const rec = await state(page);
        await page.keyboard.press('KeyT');
        const done = await until(page, 'the panel to open on the recording', (s) => s.phase === 'idle' && s.panelOpen === true && s.rows.length === 1, 20000);
        await call(page, 'fly', false);
        const row = done.rows[0];
        log('E1: the panel shows', JSON.stringify(row));
        checks['E1: T, T, T records; the panel opens on the new recording with its state and a Save button'] = rec.phase === 'recording' && row.state.startsWith('Saved on this device') && row.buttons.includes('Save to disk') && row.buttons.includes('Delete') && row.line.includes('with voice');
        checks['E1: the panel says the recording is saved here and asks to save it to disk too (a live message)'] = done.panelMessage === 'The recording is saved on this device. Save it to disk too.';
        const saved = await downloadFirst(page);
        const after = await until(page, 'the row to say saved to disk', (s) => s.rows[0]?.state.includes('Saved to disk.'));
        const pkg = readPackage(saved.bytes); // strict: any problem throws
        const manifestId = pkg.manifest.id;
        results.e1 = { fileName: saved.name, bytes: saved.bytes.length, frames: pkg.frames.length, events: pkg.events.length, voiceBytes: pkg.voice?.length ?? 0, complete: pkg.manifest.complete, rowAfter: after.rows[0], panelMessageAfter: after.panelMessage };
        checks['E1: the downloaded file is a .zip named for the recording that reads strictly: frames, events, voice, complete'] = saved.name === packageFileName(pkg.manifest) && pkg.frames.length > 100 && (pkg.voice?.length ?? 0) > 5000 && pkg.manifest.complete && pkg.problems.length === 0 && saved.name.includes(manifestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8));
        checks['E1: the row remembers it was saved to disk, and the panel names the file'] = after.rows[0].state.includes('Saved to disk.') && after.panelMessage === `Saved as ${saved.name}.`;
        // control: the reader is not blind: one byte of the saved file flipped, it refuses
        const flipped = saved.bytes.slice();
        flipped[Math.floor(flipped.length / 2)] ^= 0xff;
        let refused = false;
        try { readPackage(flipped); } catch { refused = true; }
        checks['E1: control, the same file with one byte flipped is refused by the strict reader'] = refused;
        await call(page, 'deleteAll');
        await ctx.close();
    }

    // ---------------------------------------------------------------- E2: the file picker (a stand-in), and a person who closes it
    {
        const ctx = await newContext(`
            window.__picked = [];
            window.__pickerNames = [];
            window.__pickerMode = 'ok';
            window.showSaveFilePicker = async function (o) {
                window.__pickerNames.push(o.suggestedName);
                if (window.__pickerMode === 'abort') throw Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
                return { createWritable: async function () { return {
                    write: async function (b) { window.__picked.push(Array.from(new Uint8Array(await b.arrayBuffer()))); },
                    close: async function () {}
                }; } };
            };`);
        const page = await open(ctx);
        await call(page, 'deleteAll');
        let downloads = 0;
        page.on('download', () => void downloads++);
        await call(page, 'fly', true);
        await recordWithKeys(page);
        await sleep(3500);
        await page.keyboard.press('KeyT');
        await until(page, 'the recording', (s) => s.phase === 'idle' && s.rows.length === 1, 20000);
        await call(page, 'fly', false);
        await page.evaluate(() => { (window as unknown as { __pickerMode: string }).__pickerMode = 'abort'; });
        await page.getByRole('button', { name: 'Save to disk' }).first().click();
        const cancelled = await until(page, 'the cancelled message', (s) => s.panelMessage === 'Saving was cancelled.');
        const pickedWhenCancelled = (await call<number[][]>(page, 'picked')).length;
        const downloadsWhenCancelled = downloads;
        await page.evaluate(() => { (window as unknown as { __pickerMode: string }).__pickerMode = 'ok'; });
        await page.getByRole('button', { name: 'Save to disk' }).first().click();
        const saved = await until(page, 'the saved message', (s) => s.panelMessage.startsWith('Saved as '));
        const picked = await call<number[][]>(page, 'picked');
        log('E2: picked', picked.length, 'downloads', downloads, 'names', JSON.stringify(await page.evaluate(() => (window as unknown as { __pickerNames?: string[] }).__pickerNames)), 'msg', saved.panelMessage);
        const pkg = readPackage(new Uint8Array(picked[0] ?? []));
        results.e2 = { cancelledMessage: cancelled.panelMessage, savedMessage: saved.panelMessage, downloads, pickedFiles: picked.length, pickedBytes: picked[0]?.length ?? 0, frames: pkg.frames.length };
        checks['E2: a person who closes the picker gets "Saving was cancelled." and nothing is written or downloaded'] = cancelled.panelMessage === 'Saving was cancelled.' && pickedWhenCancelled === 0 && downloadsWhenCancelled === 0 && !cancelled.rows[0].state.includes('Saved to disk.');
        checks['E2: through the picker the whole zip is written and reads strictly; the browser downloaded nothing'] = picked.length === 1 && pkg.frames.length > 60 && pkg.problems.length === 0 && downloads === 0 && saved.rows[0].state.includes('Saved to disk.');
        await call(page, 'deleteAll');
        await ctx.close();
    }

    // ---------------------------------------------------------------- E3: a tab killed mid-recording, offered at the next start, kept, saved, deleted
    {
        const ctx = await newContext(NO_PICKER);
        const first = await open(ctx);
        await call(first, 'deleteAll');
        await call(first, 'fly', true);
        await recordWithKeys(first);
        await sleep(4500);
        const cdp = await ctx.newCDPSession(first);
        void cdp.send('Page.crash').catch(() => undefined);
        await sleep(500);
        await first.close().catch(() => undefined);

        const second = await open(ctx);
        const offered = await until(second, 'the offer', (s) => s.pending.length === 1);
        const spokenBefore = await call<{ key: string; params?: { key: string } }[]>(second, 'spoken');
        const entriesBefore = await call<{ state: string; complete: boolean }[]>(second, 'entries');
        checks['E3: at the next start the pilot is told how to keep the earlier recording: rec.recover with the key T'] = spokenBefore.length === 1 && spokenBefore[0]?.key === 'rec.recover' && spokenBefore[0]?.params?.key === 'T';
        checks['E3: until T is pressed the session is still just as the crash left it (unfinished): nothing is kept or deleted behind the pilot\'s back'] = entriesBefore.length === 1 && entriesBefore[0]?.state === 'unfinished' && entriesBefore[0]?.complete === false;
        await second.keyboard.press('KeyT'); // that T answers the offer, it does not start a recording
        const kept = await until(second, 'the session to be kept', (s) => s.pending.length === 0 && s.phase === 'idle');
        await sleep(300);
        const spokenAfter = await call<{ key: string }[]>(second, 'spoken');
        const entriesAfter = await call<{ state: string; complete: boolean; notes: { recoveredAt?: string } }[]>(second, 'entries');
        checks['E3: T keeps it (it did not start a new recording): the pilot hears rec.saved, the session is finished but not complete'] = kept.phase === 'idle' && spokenAfter.map((l) => l.key).join() === 'rec.recover,rec.saved' && entriesAfter[0]?.state === 'finished' && entriesAfter[0]?.complete === false && entriesAfter[0]?.notes.recoveredAt !== undefined;
        await second.locator('#sonicrec-toggle').click();
        const listed = await until(second, 'the panel list', (s) => s.panelOpen && s.rows.length === 1 && s.rows[0].buttons.includes('Save to disk'));
        await second.screenshot({ path: join(EVIDENCE_REPO, 'evidence', today(), 'sonicrec-panel.png') });
        const saved = await downloadFirst(second);
        const pkg = readPackage(saved.bytes);
        results.e3 = { offeredSpeech: spokenBefore, afterKeep: spokenAfter, rowAfterKeep: listed.rows[0], bytes: saved.bytes.length, frames: pkg.frames.length, voiceBytes: pkg.voice?.length ?? 0, complete: pkg.manifest.complete, recoveredEvent: pkg.events.some((e) => e.kind === 'session' && e.what === 'recovered') };
        checks['E3: the panel lists it as kept after an interruption, and saving gives a package that reads strictly: not complete, with its voice and its recovered event'] = listed.rows[0].state.startsWith('Kept after an interruption.') && pkg.frames.length > 60 && (pkg.voice?.length ?? 0) > 3000 && !pkg.manifest.complete && pkg.events.some((e) => e.kind === 'session' && e.what === 'recovered') && pkg.problems.length === 0;
        // Delete asks first, a second click removes it
        await second.getByRole('button', { name: 'Delete', exact: true }).click();
        const asked = await until(second, 'the question', (s) => s.rows[0]?.buttons.includes('Delete for good?'));
        await second.getByRole('button', { name: 'Delete for good?' }).click();
        const gone = await until(second, 'the row to go', (s) => s.rows.length === 0 || s.rows[0].line === '' || s.rows[0].buttons.length === 0);
        const left = await call<unknown[]>(second, 'entries');
        checks['E3: Delete asks "Delete for good?" first, and the second click removes the recording from storage'] = asked.rows.length === 1 && left.length === 0 && gone.panelMessage === 'Deleted.';
        await ctx.close();
    }

    // ---------------------------------------------------------------- E4: the helper starts it; the pilot's answers survive a reload
    {
        const ctx = await newContext(NO_PICKER);
        const page = await open(ctx);
        await call(page, 'deleteAll');
        await until(page, 'the toggle', (s) => s.panelBuilt === true);
        await page.locator('#sonicrec-toggle').click();
        const closed = await until(page, 'the panel', (s) => s.panelOpen);
        checks['E4: Start recording is disabled until the pilot\'s agreement is ticked'] = closed.startDisabled === true;
        // the pilot is under 18: the guardian box opens up; a nickname typed with a T in it is a letter, not the record key
        await page.getByLabel('The pilot is under 18').check();
        await page.getByLabel('A parent or guardian has signed the consent form, and I confirm it').check();
        await page.getByLabel('Nickname (optional, not a real name)').click();
        await page.keyboard.type('Tom'); // real key presses: the T is a letter here, not the record key
        await page.keyboard.press('Tab');
        await page.getByLabel('Headphones').selectOption('wired');
        const phaseAfterTyping = (await state(page)).phase;
        await page.getByLabel('The pilot agrees to this recording.').check();
        const ready = await state(page);
        await call(page, 'fly', true);
        await page.getByRole('button', { name: 'Start recording' }).click();
        await until(page, 'the recording', (s) => s.phase === 'recording');
        const spoken = await call<{ key: string }[]>(page, 'spoken');
        await sleep(2500);
        await page.getByRole('button', { name: 'Stop recording' }).click();
        const done = await until(page, 'the recording to end', (s) => s.phase === 'idle' && s.rows.length === 1, 20000);
        await call(page, 'fly', false);
        const saved = await downloadFirst(page);
        const pkg = readPackage(saved.bytes);
        // reload: the profile is back
        const stored = await call<string | null>(page, 'profileStored');
        await page.reload();
        await page.waitForFunction(() => (window as unknown as { __loc?: unknown }).__loc !== undefined);
        await call(page, 'init', {});
        await until(page, 'the toggle', (s) => s.panelBuilt === true);
        await page.locator('#sonicrec-toggle').click();
        await page.waitForTimeout(100);
        const reloaded = await state(page);
        results.e4 = { phaseAfterTyping, startEnabledWhenReady: ready.startDisabled === false, spokenOnHelperStart: spoken.map((l) => l.key), consent: pkg.manifest.consent, pilot: pkg.manifest.pilot, headphones: pkg.manifest.device.headphones, profileAfterReload: reloaded.profile };
        checks['E4: typing letters (a T among them) into the nickname field is not the record key'] = phaseAfterTyping === 'idle';
        checks['E4: with the agreement ticked Start is enabled, and the helper\'s click starts the recording at once without the pilot being asked aloud'] = ready.startDisabled === false && spoken.map((l) => l.key).join() === 'rec.started' && done.rows.length === 1;
        checks['E4: the package says the pilot is under 18 with the guardian confirmed, the nickname and the headphones, and never claims consent to send'] = pkg.manifest.consent.minor === true && pkg.manifest.consent.guardianConfirmed === true && pkg.manifest.consent.send === false && pkg.manifest.pilot.nickname === 'Tom' && pkg.manifest.device.headphones === 'wired' && pkg.problems.length === 0;
        checks['E4: after a reload the pilot\'s answers are still there'] = stored !== null && reloaded.profile?.minor === true && reloaded.profile?.guardianConfirmed === true && reloaded.profile?.nickname === 'Tom' && reloaded.profile?.headphones === 'wired';
        await call(page, 'deleteAll');
        await ctx.close();
    }

    // ---------------------------------------------------------------- E5: texts in four languages; nothing drawn with the mode off
    {
        const ctx = await newContext();
        const off = await open(ctx, { mode: false });
        await page2(off);
        const s = await state(off);
        checks['E5: with the sound mode off nothing is drawn: no panel, no button'] = s.panelBuilt === false && (await off.locator('.sonicrec-toggle').count()) === 0;
        await off.close();
        const langs: Record<string, string[]> = {};
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const page = await open(ctx, {}, `?lang=${lang}`);
            await until(page, 'the toggle', (st) => st.panelBuilt === true);
            await page.locator('.sonicrec-toggle').click();
            await page.waitForTimeout(150);
            const texts = await page.evaluate(() => [...document.querySelectorAll('.sonicrec-panel, .sonicrec-toggle')].flatMap((el) => [el.textContent ?? '', ...[...el.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label') ?? ''), ...[...el.querySelectorAll('option')].map((o) => o.textContent ?? '')]).join(' '));
            langs[lang] = [texts.includes('sonicrec.') ? 'MISSING KEY' : 'ok', texts.slice(0, 60)];
            await page.close();
        }
        results.e5 = langs;
        checks['E5: the panel in English, Spanish, Polish and Russian shows no missing key'] = Object.values(langs).every((v) => v[0] === 'ok');
        await ctx.close();
    }
} finally {
    await browser.close();
    await served.stop();
    rmSync(dist, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
}

async function page2(p: Page): Promise<void> {
    await p.waitForTimeout(400); // a few frames of the page's loop go by with the mode off
}

const pass = Object.values(checks).every(Boolean);
writeEvidence('sonicrec-local', {
    pass,
    checks,
    results,
    note: 'headless Chrome, a fake microphone, real OPFS, DOM and downloads; the file picker is a stand-in (no automation drives the native dialog); the sound runtime, samples and key router are stand-ins until the flight lane lands. The downloaded files are read back from disk and read strictly.'
});
console.log(JSON.stringify({ checks }, null, 1));
console.log(pass ? 'sonicrec-local PASS' : 'sonicrec-local FAIL');
process.exit(pass ? 0 : 1);

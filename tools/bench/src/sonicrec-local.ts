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
//   E6 survey   after a stop the survey is offered, answered by keys and by clicks, open answers by voice into the recording that is still
//               running, every other key swallowed meanwhile; first flight, returning pilot and child variants; survey.json in the package
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
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}: ${JSON.stringify({ phase: s.phase, rows: s.rows, panelMessage: s.panelMessage, panelStatus: s.panelStatus, error: s.status?.error })}`);
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

/** The survey that follows a stop is offered; the pilot says no (the keys of a pilot who has heard "Press 1 for yes, 2 for no"). */
async function declineSurvey(page: Page): Promise<void> {
    await until(page, 'the survey offer', (s) => s.surveyOpen === true);
    await page.keyboard.press('Digit2');
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
        await declineSurvey(page);
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
        await declineSurvey(page);
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
        await declineSurvey(page);
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

    // ---------------------------------------------------------------- E6: the survey after a stop
    {
        const ctx = await newContext(NO_PICKER);
        const page = await open(ctx);
        await call(page, 'deleteAll');
        await until(page, 'the toggle', (s) => s.panelBuilt === true);
        const voiceMsOf = (bytes: Uint8Array): Promise<number> => page.evaluate(async (b) => {
            const ac = new OfflineAudioContext(1, 1, 48000);
            const buf = await ac.decodeAudioData(new Uint8Array(b).buffer);
            return buf.duration * 1000;
        }, Array.from(bytes));
        const questionN = (n: number, total: number) => (s: Record<string, any>) => s.surveyProgress === `Question ${n} of ${total}.`; // eslint-disable-line @typescript-eslint/no-explicit-any
        const recordAndStop = async (seconds: number): Promise<void> => {
            await call(page, 'fly', true);
            await recordWithKeys(page);
            await sleep(seconds * 1000);
            await page.keyboard.press('KeyT');
            await until(page, 'the survey offer', (st) => st.surveyOpen === true);
            await call(page, 'fly', false);
        };
        const finished = async (): Promise<void> => void (await until(page, 'the survey to close and the recording to end', (st) => st.surveyOpen === false && st.phase === 'idle', 25000));

        // ---- E6a: the first flight's survey, by keys, with two open answers (one spoken, one skipped)
        await recordAndStop(4);
        const offer = await state(page);
        const dialog = await page.locator('.sonicrec-survey').evaluate((el) => ({ role: el.getAttribute('role'), modal: el.getAttribute('aria-modal'), title: document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent ?? null }));
        const seenBefore = (await state(page)).keysSeen.length;
        for (const k of ['KeyW', 'KeyA', 'KeyR', 'KeyT', 'Space']) await page.keyboard.press(k);
        const swallowed = await state(page);
        await page.keyboard.press('Digit1');
        const plan = ['Digit4', 'Digit7', 'Digit2', 'Digit0', 'Digit1', 'Digit3'];
        for (let i = 0; i < plan.length; i++) {
            await until(page, `question ${i + 1}`, questionN(i + 1, 9));
            if (i === 0) await page.screenshot({ path: join(EVIDENCE_REPO, 'evidence', today(), 'sonicrec-survey.png') });
            await sleep(400);
            await page.keyboard.press(plan[i] as string);
        }
        await until(page, 'question 7', (st) => questionN(7, 9)(st) && st.surveyListening !== '');
        const listening = (await state(page)).surveyListening;
        await sleep(1700); // the pilot talks: the voice keeps recording
        await page.keyboard.press('Enter');
        await until(page, 'question 8', (st) => questionN(8, 9)(st) && st.surveyListening !== '');
        await sleep(1200);
        await page.keyboard.press('Escape'); // skip the second open question
        await until(page, 'question 9', questionN(9, 9));
        await sleep(400);
        await page.keyboard.press('Digit1');
        await finished();
        await page.keyboard.press('KeyW');
        const keysAfter = (await state(page)).keysSeen.length;
        await until(page, 'the list to show the recording', (st) => st.rows.length === 1 && st.panelOpen === true);
        const first = await downloadFirst(page);
        const pkgA = readPackage(first.bytes);
        const voiceMs = await voiceMsOf(pkgA.voice as Uint8Array);
        const sA = pkgA.survey;
        const profileA = JSON.parse((await call<string | null>(page, 'profileStored')) ?? '{}') as { surveysSeen?: string[] };
        results.e6a = { offerQuestion: offer.surveyQuestion, dialog, swallowedKeys: swallowed.keysSeen.length - seenBefore, listening, answers: sA?.answers, voiceMs: Math.round(voiceMs), lastAnswerT: sA?.answers[8]?.t, surveysSeen: profileA.surveysSeen };
        checks['E6a: after the stop the survey is offered in a dialog named for it, with the package\'s own question, and the keys are the survey\'s'] = offer.surveyOpen === true && offer.phase === 'closing' && offer.surveyQuestion === 'Do you want to answer a few questions? Press 1 for yes, 2 for no.' && dialog.role === 'dialog' && dialog.modal === 'true' && dialog.title === 'Fly by Sound: a few questions';
        checks['E6a: while it runs W, A, R, T and Space reach nothing in the page (swallowed before the key router and keyboard flying), the recording is still closing, and a key after it flows again'] = swallowed.keysSeen.length === seenBefore && swallowed.phase === 'closing' && keysAfter === swallowed.keysSeen.length + 1;
        checks['E6a: nine answers as given: numbers by key (0 is an answer), one open answer by voice, one skipped, a choice by number'] = sA !== null && sA !== undefined && sA.surveyId === 'first-flight' && sA.skipped === false && JSON.stringify(sA.answers.map((a) => [a.item, a.value, a.via])) === JSON.stringify([['fun', 4, 'key'], ['mental', 7, 'key'], ['frustration', 2, 'key'], ['fear', 0, 'key'], ['up-direction', 1, 'key'], ['ears-tired', 3, 'key'], ['helped', null, 'voice'], ['annoyed', null, 'skip'], ['again', 1, 'key']]);
        checks['E6a: the open question showed that it was listening, and its answer is stamped where its voice window opened (before the press that ended it)'] = listening.startsWith('Listening: say your answer out loud, then press Enter') && (sA?.answers[6]?.t ?? 0) < (sA?.answers[7]?.t ?? 0) - 1500 && (sA?.answers[6]?.t ?? 0) >= (sA?.answers[5]?.t ?? 0);
        checks['E6a: the voice went on recording through the survey: it is as long as the whole recording, past the last answer'] = voiceMs + 250 >= (sA?.answers[8]?.t ?? Infinity) && voiceMs > 4000 + 5000;
        checks['E6a: no survey answer is written as an answer event (the replay would call it missing); the package reads strictly with survey.json listed'] = pkgA.events.every((e) => e.kind !== 'answer') && pkgA.problems.length === 0 && pkgA.manifest.files.some((f) => f.name === 'survey.json');
        checks['E6a: an answered first-flight survey is remembered, so the next one is the returning pilot\'s'] = (profileA.surveysSeen ?? []).includes('first-flight');

        // ---- E6b: the returning pilot's survey, every question skipped
        await recordAndStop(2);
        await page.keyboard.press('Digit1');
        for (let i = 1; i <= 10; i++) {
            await until(page, `question ${i}`, questionN(i, 10));
            await sleep(380);
            await page.keyboard.press('Escape');
        }
        await finished();
        await until(page, 'the list to show the second recording', (st) => st.rows.length === 2);
        const second = readPackage((await downloadFirst(page)).bytes);
        results.e6b = { surveyId: second.survey?.surveyId, skipped: second.survey?.skipped, vias: second.survey?.answers.map((a) => a.via) };
        checks['E6b: the second recording gets the returning pilot\'s ten questions; all skipped makes a skipped survey'] = second.survey?.surveyId === 'returning-pilot' && second.survey.answers.length === 10 && second.survey.answers.every((a) => a.via === 'skip' && a.value === null) && second.survey.skipped === true;

        // ---- E6c: the helper clicks (a yes, a number, a skip, "hear it again"); the rest by Escape; the dialog's buttons are named
        await recordAndStop(2);
        const buttons = (await state(page)).surveyButtons as { text: string; label: string | null; digit: string | null; action: string | null }[];
        await page.locator('.sonicrec-survey [data-digit="1"]').click(); // Yes
        await until(page, 'question 1', questionN(1, 10));
        const q1 = await state(page);
        await sleep(380);
        const spokenBefore = (await call<{ key: string }[]>(page, 'spoken')).filter((l) => l.key === 'survey.item.mental').length;
        await page.locator('.sonicrec-survey [data-action="again"]').click();
        await sleep(100);
        const spokenAfter = (await call<{ key: string }[]>(page, 'spoken')).filter((l) => l.key === 'survey.item.mental').length;
        await page.locator('.sonicrec-survey [data-digit="5"]').click();
        await until(page, 'question 2', questionN(2, 10));
        await sleep(380);
        await page.locator('.sonicrec-survey [data-action="skip"]').click();
        for (let i = 3; i <= 10; i++) {
            await until(page, `question ${i}`, questionN(i, 10));
            await sleep(380);
            await page.keyboard.press('Escape');
        }
        await finished();
        await until(page, 'the list to show the third recording', (st) => st.rows.length === 3);
        const third = readPackage((await downloadFirst(page)).bytes);
        results.e6c = { offerButtons: buttons.map((b) => [b.text, b.label]), q1Buttons: q1.surveyButtons.map((b: { text: string; label: string | null }) => [b.text, b.label]), answers: third.survey?.answers.slice(0, 3), mentalSpokenBeforeAndAfterAgain: [spokenBefore, spokenAfter] };
        checks['E6c: the offer\'s buttons are named by their number and answer (1: Yes, 2: No)'] = buttons.some((b) => b.digit === '1' && b.label === '1: Yes') && buttons.some((b) => b.digit === '2' && b.label === '2: No');
        checks['E6c: a scale shows one button for every number (0 to 9), its two ends named'] = q1.surveyButtons.filter((b: { digit: string | null }) => b.digit !== null).length === 10 && q1.surveyButtons.some((b: { digit: string | null; label: string | null }) => b.digit === '0' && b.label === '0: Very easy') && q1.surveyButtons.some((b: { digit: string | null; label: string | null }) => b.digit === '9' && b.label === '9: Very hard');
        checks['E6c: the helper\'s clicks answer like keys: a number, a skip; "Hear the question again" says it once more and answers nothing'] = third.survey?.answers[0]?.item === 'mental' && third.survey.answers[0].value === 5 && third.survey.answers[1]?.via === 'skip' && spokenAfter === spokenBefore + 1;

        // ---- E6d: a minor gets the child survey (the panel opened by itself on the last recording: it is toggled only if closed)
        if (!(await state(page)).panelOpen) await page.locator('#sonicrec-toggle').click();
        await page.getByLabel('The pilot is under 18').check();
        await page.getByLabel('A parent or guardian has signed the consent form, and I confirm it').check();
        await page.locator('.sonicrec-x').click();
        await recordAndStop(2);
        await page.keyboard.press('Digit1');
        const child = ['Digit5', 'Digit1', 'Digit2', 'Digit3', 'Digit1'];
        for (let i = 0; i < child.length; i++) {
            await until(page, `question ${i + 1}`, questionN(i + 1, 6));
            await sleep(380);
            await page.keyboard.press(child[i] as string);
        }
        await until(page, 'the last question', (st) => questionN(6, 6)(st) && st.surveyListening !== '');
        await sleep(900);
        await page.keyboard.press('Enter');
        await finished();
        await until(page, 'the list to show the fourth recording', (st) => st.rows.length === 4);
        const kid = readPackage((await downloadFirst(page)).bytes);
        results.e6d = { surveyId: kid.survey?.surveyId, items: kid.survey?.answers.map((a) => [a.item, a.value, a.via]), consent: kid.manifest.consent };
        checks['E6d: a minor\'s recording gets the child survey, six questions, with its open question answered by voice'] = kid.survey?.surveyId === 'child-again-again' && kid.survey.answers.length === 6 && kid.survey.answers[0]?.value === 5 && kid.survey.answers[5]?.via === 'voice' && kid.manifest.consent.minor === true && kid.manifest.consent.send === false && kid.problems.length === 0;
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

// The ways out that the GPU hint names, tried on a normally started, VISIBLE browser with a throwaway profile
// (lane gpu-select, docs/wip/gpu-select.md). Nothing here changes a Windows setting or the pilot's own browser.
//
//   --mode flag-ui   The browser's own flag, the way a pilot sets it: open chrome://flags/#force-high-performance-gpu,
//                    read what the page says about the flag, choose Enabled in its list, close the browser, start it
//                    again with NO switch on the command line, and read which adapter it draws on now.
//   --mode link      Windows' graphics page as a link (ms-settings:display-advancedgraphics) on a page of ours:
//                    (a) a click on the link in a fresh profile: what the browser asks before it opens another
//                        program (read through Windows' UI Automation; nothing is pressed);
//                    (b) the same click in a profile where this origin is already allowed to open that kind of link
//                        (what "Always allow" stores): does Settings open, and on which page.
//   --mode webgpu    powerPreference with a real load: a WebGPU canvas asked for with 'high-performance' and then with
//                    'low-power', and Windows' GPU counters per adapter during each (a browser that hides adapter.info
//                    tells no other way which card it took).
//
//   node tools/bench/scripts/gpu-select-switch.mjs --mode flag-ui --browser chrome
//   node tools/bench/scripts/gpu-select-switch.mjs --mode link --browser edge
// Output: evidence/<date>/gpu-select/<label>.json. Windows only.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asciiJson, browserExe, gpuCountersAsync, gpuProcessPid, GPU_LOAD, mask, READ_ADAPTERS, startStockBrowser as startStock, systemInfo } from './gpu-select-probe.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Every browser this run started, so that a run stopped by hand (Ctrl+C) takes them and their profiles with it. */
const started = new Set();
const startStockBrowser = async (opts) => {
    const s = await startStock(opts);
    started.add(s);
    return s;
};
const FLAG = 'force-high-performance-gpu';
const SETTINGS = 'ms-settings:display-advancedgraphics';
const ASK_EXTRA = ['--force-renderer-accessibility'];

function parseArgs(argv) {
    const o = { mode: '', browser: 'chrome', label: '', seconds: 5, url: 'https://gsfpv.flyreelstudio.eu/en/fly/' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--mode') o.mode = argv[++i];
        else if (a === '--browser') o.browser = argv[++i];
        else if (a === '--label') o.label = argv[++i];
        else if (a === '--seconds') o.seconds = Number(argv[++i]);
        else if (a === '--url') o.url = argv[++i];
        else throw new Error(`unknown argument ${a}`);
    }
    if (!['flag-ui', 'link', 'webgpu'].includes(o.mode)) throw new Error('--mode flag-ui | link | webgpu');
    if (!o.label) o.label = `${o.browser}-${o.mode}`;
    return o;
}

function powershell(script, timeoutMs = 60000) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
    return { out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

// ---- flag-ui ----

/** In chrome://flags: the flag's own entry (the page keeps its parts inside shadow roots), what it says and its list. */
const FLAG_PAGE = (set) => `(() => {
    const all = [];
    const walk = (n) => { if (!n) return; if (n.nodeType === 1) { all.push(n); if (n.shadowRoot) walk(n.shadowRoot); } for (const c of n.childNodes || []) walk(c); };
    walk(document);
    const exp = all.find((e) => e.id === '${FLAG}' && /EXPERIMENT/.test(e.tagName)) || all.find((e) => e.id === '${FLAG}');
    if (!exp) return { found: false, experiments: all.filter((e) => /FLAGS-EXPERIMENT/.test(e.tagName)).length, title: document.title };
    const inside = [];
    const w2 = (n) => { if (n.nodeType === 1) { inside.push(n); if (n.shadowRoot) w2(n.shadowRoot); } for (const c of n.childNodes || []) w2(c); };
    w2(exp);
    const sel = inside.find((e) => e.tagName === 'SELECT');
    const text = (cls) => { const e = inside.find((x) => x.classList && x.classList.contains(cls)); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; };
    const out = { found: true, tag: exp.tagName, name: text('experiment-name'), description: text('description') || text('body'), platforms: text('platforms'), options: sel ? [...sel.options].map((o) => o.textContent.trim()) : null, value: sel ? sel.options[sel.selectedIndex].textContent.trim() : null };
    if (${set ? 'true' : 'false'} && sel) {
        const i = [...sel.options].findIndex((o) => /^enabled$/i.test(o.textContent.trim()));
        if (i >= 0) { sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true, composed: true })); out.set = 'Enabled'; }
    }
    return out;
})()`;

async function flagUi(o, exe, result) {
    // 1. the first start: the flags page, the way a pilot reaches it from the note's address
    let stock = await startStockBrowser({ exe, label: o.label });
    result.browser = stock.version;
    let set = false;
    try {
        const page = stock.page;
        await page.goto(`chrome://flags/#${FLAG}`, { waitUntil: 'load', timeout: 30000 });
        await sleep(2000);
        result.flagsPage = { address: page.url(), before: await page.evaluate(FLAG_PAGE(false)) };
        result.flagsPage.setting = await page.evaluate(FLAG_PAGE(true));
        await sleep(1200);
        result.flagsPage.after = await page.evaluate(FLAG_PAGE(false));
        // the page offers its own "Relaunch" button once a flag changed: its words, for the note's wording
        result.flagsPage.relaunchButton = await page.evaluate(`(() => { const all = []; const walk = (n) => { if (!n) return; if (n.nodeType === 1) { all.push(n); if (n.shadowRoot) walk(n.shadowRoot); } for (const c of n.childNodes || []) walk(c); }; walk(document); const b = all.filter((e) => e.tagName === 'BUTTON' || e.tagName === 'CR-BUTTON').map((e) => e.textContent.replace(/\\s+/g, ' ').trim()).filter(Boolean); return b; })()`);
        set = true;
    } finally {
        // the profile is kept for the second start only when the first half went through
        await stock.close(set ? { keepProfile: true } : false);
    }
    await sleep(1500);
    try {
        const state = JSON.parse(readFileSync(join(stock.profile, 'Local State'), 'utf8'));
        result.localState = { enabled_labs_experiments: state?.browser?.enabled_labs_experiments ?? null };
    } catch (e) {
        result.localState = { error: String(e.message ?? e) };
    }
    // 2. the second start of the SAME profile, nothing added to the command line: the flag alone
    stock = await startStockBrowser({ exe, label: o.label, keepProfile: true });
    try {
        const page = stock.page;
        await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(1500);
        result.afterRelaunch = { launch: stock.launch, page: await page.evaluate(READ_ADAPTERS), systemInfo: await systemInfo(stock.cdp) };
        const a = result.afterRelaunch.page.adapters?.high;
        result.verdict = { flagListed: result.flagsPage.before?.found === true, flagName: result.flagsPage.before?.name ?? null, options: result.flagsPage.before?.options ?? null, storedAfterSetting: result.localState.enabled_labs_experiments, commandLineAfterRelaunch: (result.afterRelaunch.systemInfo.commandLine.match(/--flag-switches-begin.*--flag-switches-end/) ?? [''])[0], adapterAfterRelaunch: a ? `${a.vendor} ${a.architecture}` : null, webglAfterRelaunch: result.afterRelaunch.page.webgl?.['high-performance'] ?? null };
    } finally {
        await stock.close();
    }
}

// ---- link ----

/** Names of the buttons, check boxes and texts in the windows of a process (Windows UI Automation; read only). */
function uiNames(pid, pattern) {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$root = $AE::RootElement
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, ${pid})))
$out = @()
foreach ($w in $wins) {
  $all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($e in $all) {
    $n = $e.Current.Name
    if ($n -and $n -match '${pattern}') { $out += [pscustomobject]@{ type = $e.Current.ControlType.ProgrammaticName -replace '^ControlType\\.', ''; name = $n.Substring(0, [Math]::Min(200, $n.Length)) } }
  }
}
@($out | Select-Object -First 40) | ConvertTo-Json -Compress
`;
    const r = powershell(script, 60000);
    try {
        const j = JSON.parse(r.out || '[]');
        return Array.isArray(j) ? j : [j];
    } catch {
        return [{ type: 'error', name: (r.err || r.out).slice(0, 200) }];
    }
}

/**
 * Windows' Settings window: is the program running, is a window of it on screen, and the trail of the page it shows (its first
 * three texts: on the graphics page "System", "Display", "Graphics"). Nothing below the trail is read: further down that page
 * lists the person's applications, and another page can hold an account name.
 */
export function settingsWindow() {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$p = Get-Process SystemSettings
# (Windows keeps the Settings program suspended in the background: only a window counts as "open")
$out = [pscustomobject]@{ running = [bool]$p; window = $null; texts = @() }
if ($p) {
  $root = $AE::RootElement
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $wins) {
    $mine = ($w.Current.ProcessId -eq $p[0].Id)
    if (-not $mine -and $w.Current.ClassName -eq 'ApplicationFrameWindow') {
      $inner = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $p[0].Id)))
      $mine = [bool]$inner
    }
    if (-not $mine) { continue }
    # (the hidden frame of the suspended program is not a window the person sees)
    if ($w.Current.IsOffscreen) { continue }
    $out.window = $w.Current.Name
    $all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)))
    foreach ($e in $all) { $n = $e.Current.Name; if ($n) { $out.texts += $n.Substring(0, [Math]::Min(60, $n.Length)) }; if ($out.texts.Count -ge 3) { break } }
  }
  $out.texts = @($out.texts | Select-Object -First 3)
}
$out | ConvertTo-Json -Compress -Depth 4
`;
    const r = powershell(script, 60000);
    try {
        return JSON.parse(r.out);
    } catch {
        return { running: null, error: (r.err || r.out).slice(0, 200) };
    }
}

async function link(o, exe, result) {
    const server = createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(`<!doctype html><meta charset="utf-8"><title>gpu-select link</title><body style="background:#111;color:#ddd;font:18px sans-serif;padding:40px"><p>The link the GPU hint carries:</p><p><a id="l" style="color:#7cf" href="${SETTINGS}">Open Windows graphics settings</a></p>`);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    result.page = `${origin}/ (a page of the probe with <a href="${SETTINGS}">)`;
    // with a Settings window already on screen this run could not tell what the click opened, and it would have to leave the
    // person's window on the page the click put it: it does not start
    const before = settingsWindow();
    result.settingsWindowOpenBefore = before.window !== null;
    if (before.window !== null) {
        server.close();
        throw new Error('a Settings window is open: close it and run again');
    }
    try {
        // (a) a fresh profile: the browser asks first. Chrome exposes its own dialogs to UI Automation only with its
        // accessibility switched on, which this switch does and nothing else (Edge has it on by itself).
        let stock = await startStockBrowser({ exe, label: `${o.label}-ask`, extra: ASK_EXTRA });
        result.browser = stock.version;
        try {
            await stock.page.goto(`${origin}/`, { waitUntil: 'load' });
            await stock.page.bringToFront();
            await stock.page.click('#l');
            await sleep(2500);
            const win = settingsWindow();
            // the browser's own question, read through UI Automation (asked up to three times: a browser may build its
            // accessibility tree only after the first request)
            let dialog = [];
            for (let i = 0; i < 3 && !dialog.some((x) => x.type === 'Button'); i++) {
                dialog = uiNames(stock.child.pid, 'Settings|settings|open|Open|Cancel|Always|allow');
                if (!dialog.some((x) => x.type === 'Button')) await sleep(1500);
            }
            result.ask = { dialog, accessibilityForced: ASK_EXTRA, settingsOpened: win.window !== null, settingsWindow: win.window };
        } finally {
            await stock.close();
        }
        // (b) this origin already allowed to open ms-settings links (what "Always allow" stores in the profile)
        stock = await startStockBrowser({ exe, label: `${o.label}-allowed`, prefs: { protocol_handler: { allowed_origin_protocol_pairs: { [origin]: { 'ms-settings': true } } } } });
        try {
            await stock.page.goto(`${origin}/`, { waitUntil: 'load' });
            await stock.page.bringToFront();
            await stock.page.click('#l');
            await sleep(4000);
            const win = settingsWindow();
            result.allowed = { settings: win, opened: win.window !== null, graphicsPage: Array.isArray(win.texts) && win.texts.some((t) => /Graphics/i.test(t)) };
        } finally {
            await stock.close();
        }
    } finally {
        server.close();
        // the Settings window this probe opened goes away again (none was open before, or the run would not have started)
        powershell(`Get-Process SystemSettings -ErrorAction SilentlyContinue | Stop-Process -Force`);
    }
    result.verdict = {
        asksFirst: (result.ask?.dialog ?? []).filter((x) => x.type !== 'error').map((x) => `${x.type}: ${x.name}`).slice(0, 12),
        opensWithoutConsent: result.ask?.settingsOpened ?? null,
        opensWhenAllowed: result.allowed?.opened ?? null,
        onGraphicsPage: result.allowed?.graphicsPage ?? null,
        settingsWindow: result.allowed?.settings?.window ?? null
    };
}

// ---- webgpu ----

async function webgpu(o, exe, result) {
    const stock = await startStockBrowser({ exe, label: o.label });
    result.browser = stock.version;
    try {
        const page = stock.page;
        await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(1500);
        await page.bringToFront();
        const gpuPid = await gpuProcessPid(stock.cdp);
        result.loads = {};
        for (const pp of ['high-performance', 'low-power']) {
            const run = page.evaluate(GPU_LOAD(pp, o.seconds * 1000 + 2500));
            await sleep(900);
            const counters = gpuPid ? await gpuCountersAsync(gpuPid, o.seconds) : null;
            result.loads[pp] = { load: await run, perAdapter: counters?.perAdapter ?? null };
        }
        const busy = (pp) => Object.entries(result.loads[pp].perAdapter ?? {}).sort((a, b) => b[1].max3d - a[1].max3d).map(([n, v]) => `${n} ${v.max3d} %`)[0] ?? null;
        result.verdict = { high: `${result.loads['high-performance'].load.vendor} ${result.loads['high-performance'].load.architecture}`.trim(), highBusiest: busy('high-performance'), low: `${result.loads['low-power'].load.vendor} ${result.loads['low-power'].load.architecture}`.trim(), lowBusiest: busy('low-power') };
    } finally {
        await stock.close();
    }
}

async function main() {
    const o = parseArgs(process.argv.slice(2));
    if (process.platform !== 'win32') throw new Error('gpu-select-switch: Windows only');
    const exe = browserExe(o.browser);
    if (!exe || !existsSync(exe)) throw new Error(`no executable for --browser ${o.browser}`);
    const outDir = join(REPO, 'evidence', new Date().toISOString().slice(0, 10), 'gpu-select');
    mkdirSync(outDir, { recursive: true });
    const result = { name: `gpu-select/${o.label}`, date: new Date().toISOString(), label: o.label, mode: o.mode, browserName: o.browser };
    process.on('SIGINT', () => {
        void (async () => {
            for (const s of started) await s.close(false).catch(() => {});
            process.exit(130);
        })();
    });
    try {
        if (o.mode === 'flag-ui') await flagUi(o, exe, result);
        else if (o.mode === 'link') await link(o, exe, result);
        else await webgpu(o, exe, result);
    } catch (e) {
        result.error = String(e?.stack ?? e).slice(0, 1500);
    }
    const file = join(outDir, `${o.label}.json`);
    writeFileSync(file, asciiJson(mask(JSON.stringify(result, null, 2))) + '\n');
    console.log(JSON.stringify({ file: file.replace(REPO, '.').replace(/\\/g, '/'), verdict: result.verdict ?? null, error: result.error ?? null }, null, 2));
    if (result.error) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) await main();

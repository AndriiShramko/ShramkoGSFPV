// Which graphics adapter a normally started, VISIBLE browser really draws on (lane gpu-select, docs/wip/gpu-select.md).
//
// A hybrid laptop (integrated + discrete GPU) hands a browser one adapter when its GPU process starts, and a page
// cannot change that afterwards. This probe starts the browser the way a person does (its own executable, a
// throwaway profile under .cache/, no Playwright launch flags, a real window), then attaches over the DevTools
// port and takes four independent readings:
//   1. the page: navigator.gpu.requestAdapter() with powerPreference high-performance / low-power / none, and the
//      WebGL renderer for the same three preferences;
//   2. the browser: SystemInfo.getInfo (the GPU list and the active one) and the text of chrome://gpu;
//   3. Windows: the per-process GPU counters of the browser's GPU process, per adapter (LUID), sampled while the
//      page draws a heavy WebGL frame, and the dedicated / shared GPU memory of that process per adapter;
//   4. the NVIDIA driver: nvidia-smi's process list (is the GPU process in it).
// Variants change only how the browser is started, never a Windows setting:
//   default     nothing added
//   force-hp    --force-high-performance-gpu (what chrome://flags/#force-high-performance-gpu adds)
//   shim        the environment variable SHIM_MCCOMPAT=0x800000001 (what "Run with graphics processor" sets)
//   headless    --headless=new (control: does a headless browser get another adapter than a visible one)
//
//   node tools/bench/scripts/gpu-select-probe.mjs --browser chrome --variant default --label chrome-default
//   node tools/bench/scripts/gpu-select-probe.mjs --browser edge --variant force-hp
//   node tools/bench/scripts/gpu-select-probe.mjs --browser "C:/path/to/browser.exe" --arg=--some-switch
//
// Output: evidence/<date>/gpu-select/<label>.json and <label>-gpu-page.txt. The user name is masked.
// Windows only (the counters and the registry map of adapters); it reads, it never writes a setting.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { chromium } from 'playwright';
import { systemChromePaths } from '../src/chrome.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const VARIANTS = {
    default: { args: [], env: {} },
    'force-hp': { args: ['--force-high-performance-gpu'], env: {} },
    shim: { args: [], env: { SHIM_MCCOMPAT: '0x800000001' } },
    headless: { args: ['--headless=new'], env: {} }
};

export function parseArgs(argv) {
    const o = { browser: 'chrome', variant: 'default', label: '', seconds: 6, url: 'https://gsfpv.flyreelstudio.eu/en/fly/', out: '', extra: [], keep: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--browser') o.browser = argv[++i];
        else if (a === '--variant') o.variant = argv[++i];
        else if (a === '--label') o.label = argv[++i];
        else if (a === '--seconds') o.seconds = Number(argv[++i]);
        else if (a === '--url') o.url = argv[++i];
        else if (a === '--out') o.out = argv[++i];
        else if (a === '--keep') o.keep = true;
        else if (a.startsWith('--arg=')) o.extra.push(a.slice(6));
        else throw new Error(`unknown argument ${a}`);
    }
    if (!VARIANTS[o.variant]) throw new Error(`unknown variant ${o.variant}: ${Object.keys(VARIANTS).join(' | ')}`);
    if (!o.label) o.label = `${/[\\/]/.test(o.browser) ? 'custom' : o.browser}-${o.variant}`;
    return o;
}

/** The executable of a browser name (chrome, edge) or the path itself. */
export function browserExe(name, env = process.env) {
    if (/[\\/]/.test(name)) return name;
    if (name === 'chrome') return systemChromePaths(env, 'win32').find((p) => existsSync(p)) ?? null;
    if (name === 'edge') {
        return [env['PROGRAMFILES(X86)'], env.PROGRAMFILES, env.LOCALAPPDATA].filter(Boolean).map((d) => join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find((p) => existsSync(p)) ?? null;
    }
    if (name === 'firefox') {
        return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).map((d) => join(d, 'Mozilla Firefox', 'firefox.exe')).find((p) => existsSync(p)) ?? null;
    }
    return null;
}

/** Every non-ASCII character as a unicode escape (the repository keeps ASCII outside locales/). */
export function asciiJson(json) {
    const BS = String.fromCharCode(92);
    let out = '';
    for (let i = 0; i < json.length; i++) {
        const c = json.charCodeAt(i);
        out += c < 128 ? json[i] : BS + 'u' + c.toString(16).padStart(4, '0');
    }
    return out;
}

/** The user's name and profile folder never reach a file: both forms of the path, then the bare name. */
export function mask(text, user = os.userInfo().username, home = os.homedir()) {
    let t = String(text);
    for (const h of [home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')]) t = t.split(h).join('%USERPROFILE%');
    if (user && user.length > 2) t = t.replace(new RegExp(`(?<![A-Za-z0-9])${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'gi'), '<user>');
    return t;
}

function powershell(script, timeoutMs = 60000) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
    return { out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), status: r.status };
}

/**
 * Windows' GPU counters of one process, per adapter. `seconds` one-second samples of every engine of the process;
 * an adapter the process has no engine on is an adapter it does not use. Read only.
 */
export function gpuCounters(pid, seconds) {
    const r = powershell(countersScript(pid, seconds), (seconds + 40) * 1000);
    return parseCounters(r.out, r.err, seconds);
}

/** The same reading without stopping this process: a page keeps being polled while Windows samples. */
export function gpuCountersAsync(pid, seconds) {
    return new Promise((res) => {
        const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(countersScript(pid, seconds), 'utf16le').toString('base64')], { windowsHide: true });
        let out = '';
        let err = '';
        p.stdout.on('data', (c) => { out += c; });
        p.stderr.on('data', (c) => { err += c; });
        const timer = setTimeout(() => p.kill(), (seconds + 40) * 1000);
        p.on('close', () => {
            clearTimeout(timer);
            res(parseCounters(out.trim(), err.trim(), seconds));
        });
        p.on('error', (e) => {
            clearTimeout(timer);
            res({ error: `counters: ${e.message}` });
        });
    });
}

function countersScript(pid, seconds) {
    return `
$ErrorActionPreference = 'SilentlyContinue'
$map = @{}
Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\DirectX' | ForEach-Object {
  $p = Get-ItemProperty $_.PSPath
  if ($p.Description) { $l = [uint64]$p.AdapterLuid; $map[('0x{0:x8}_0x{1:x8}' -f [uint32]($l -shr 32), [uint32]($l -band 0xFFFFFFFF))] = [string]$p.Description }
}
$s = Get-Counter '\\GPU Engine(pid_${pid}_*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples ${seconds}
$eng = @($s.CounterSamples | Group-Object InstanceName | ForEach-Object {
  $n = $_.Name
  $k = if ($n -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)') { $Matches[1] } else { '' }
  # a sample far above 100 % is a glitch of the counter (seen once: 1.8e14 %), not a reading: it is left out
  $g = @($_.Group | Where-Object { $_.CookedValue -le 200 })
  $mx = if ($g.Count) { ($g | Measure-Object CookedValue -Maximum).Maximum } else { 0 }
  $av = if ($g.Count) { ($g | Measure-Object CookedValue -Average).Average } else { 0 }
  [pscustomobject]@{ luid = $k; adapter = $map[$k]; engine = ($n -replace '^pid_\\d+_luid_0x[0-9a-f]+_0x[0-9a-f]+_phys_\\d+_', ''); max = [math]::Round($mx, 2); avg = [math]::Round($av, 2); dropped = (@($_.Group).Count - $g.Count) }
})
$m = Get-Counter '\\GPU Process Memory(pid_${pid}_*)\\Dedicated Usage', '\\GPU Process Memory(pid_${pid}_*)\\Shared Usage'
$mem = @($m.CounterSamples | ForEach-Object {
  $k = if ($_.InstanceName -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)') { $Matches[1] } else { '' }
  [pscustomobject]@{ luid = $k; adapter = $map[$k]; counter = ($_.Path -replace '.*\\\\', ''); mb = [math]::Round($_.CookedValue / 1MB, 1) }
})
[pscustomobject]@{ adapters = $map; engines = $eng; memory = $mem } | ConvertTo-Json -Depth 5 -Compress
`;
}

function parseCounters(out, err, seconds) {
    let raw = null;
    try {
        raw = JSON.parse(out);
    } catch {
        return { error: `counters: ${err || out || 'no output'}`.slice(0, 400) };
    }
    const engines = Array.isArray(raw.engines) ? raw.engines : raw.engines ? [raw.engines] : [];
    const memory = Array.isArray(raw.memory) ? raw.memory : raw.memory ? [raw.memory] : [];
    const perAdapter = {};
    for (const e of engines) {
        const a = (perAdapter[e.adapter ?? e.luid] ??= { engines: 0, max3d: 0, avg3d: 0, maxAny: 0, dedicatedMb: 0, sharedMb: 0 });
        a.engines++;
        a.maxAny = Math.max(a.maxAny, e.max);
        if (/engtype_3d$/i.test(e.engine)) {
            a.max3d = Math.max(a.max3d, e.max);
            a.avg3d = Math.max(a.avg3d, e.avg);
        }
    }
    for (const m of memory) {
        const a = (perAdapter[m.adapter ?? m.luid] ??= { engines: 0, max3d: 0, avg3d: 0, maxAny: 0, dedicatedMb: 0, sharedMb: 0 });
        if (/dedicated/i.test(m.counter)) a.dedicatedMb = m.mb;
        else a.sharedMb = m.mb;
    }
    return { seconds, adapters: raw.adapters, perAdapter, busyEngines: engines.filter((e) => e.max > 0) };
}

/** nvidia-smi's process table: the pids it lists (empty without the tool or without an NVIDIA card). */
export function nvidiaSmi() {
    const r = spawnSync('nvidia-smi', [], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    if (r.error || r.status !== 0) return { available: false, pids: [], rows: [] };
    const rows = [];
    for (const line of (r.stdout ?? '').split(/\r?\n/)) {
        const m = /^\|\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\S+)\s+(.*?)\s+(\S+)\s+\|$/.exec(line);
        if (m) rows.push({ pid: Number(m[1]), type: m[2], name: mask(m[3]).replace(/^.*[\\/]/, ''), memory: m[4] });
    }
    const q = spawnSync('nvidia-smi', ['--query-gpu=name,driver_version,memory.used,utilization.gpu', '--format=csv,noheader'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    return { available: true, gpu: (q.stdout ?? '').trim(), pids: rows.map((x) => x.pid), rows };
}

// In the page: every adapter the page can ask for, and the WebGL renderer for the same preferences.
export const READ_ADAPTERS = `(async () => {
    const pick = (a) => {
        if (!a) return null;
        const i = a.info || {};
        return { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description, isFallbackAdapter: (i.isFallbackAdapter ?? a.isFallbackAdapter ?? null), maxBufferSize: a.limits ? a.limits.maxBufferSize : null, maxTextureDimension2D: a.limits ? a.limits.maxTextureDimension2D : null, features: a.features ? a.features.size : null };
    };
    const out = { userAgent: navigator.userAgent, secure: isSecureContext, webgpu: !!navigator.gpu, cores: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null, dpr: devicePixelRatio, visibility: document.visibilityState, adapters: {}, webgl: {} };
    if (navigator.gpu) {
        for (const [k, opt] of [['high', { powerPreference: 'high-performance' }], ['low', { powerPreference: 'low-power' }], ['none', undefined], ['fallback', { forceFallbackAdapter: true }]]) {
            try { out.adapters[k] = pick(await navigator.gpu.requestAdapter(opt)); } catch (e) { out.adapters[k] = 'error: ' + e.message; }
        }
    }
    for (const pp of ['high-performance', 'low-power', 'default']) {
        const c = document.createElement('canvas');
        const g = c.getContext('webgl2', { powerPreference: pp });
        if (!g) { out.webgl[pp] = null; continue; }
        const e = g.getExtension('WEBGL_debug_renderer_info');
        out.webgl[pp] = String(g.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : g.RENDERER));
        const lose = g.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
    }
    return out;
})()`;

// In the page: a WebGL2 canvas that costs the GPU real work each frame (a loop in the fragment shader), so the
// Windows counters show WHICH adapter works. Returns the frames drawn and their interval.
const LOAD = (ms) => `(async () => {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    c.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px;z-index:99999';
    document.body.appendChild(c);
    const g = c.getContext('webgl2', { powerPreference: 'high-performance' });
    if (!g) return { error: 'no webgl2' };
    const sh = (t, s) => { const o = g.createShader(t); g.shaderSource(o, s); g.compileShader(o); return o; };
    const p = g.createProgram();
    g.attachShader(p, sh(g.VERTEX_SHADER, '#version 300 es\\nvoid main(){ vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0); }'));
    g.attachShader(p, sh(g.FRAGMENT_SHADER, '#version 300 es\\nprecision highp float; uniform float t; out vec4 o; void main(){ vec2 z = gl_FragCoord.xy / 720.0; float a = 0.0; for (int i = 0; i < 220; i++) { z = vec2(sin(z.x * 1.7 + t) + z.y, cos(z.y * 1.3 - t) + z.x) * 0.5; a += length(z); } o = vec4(fract(a), fract(a * 0.5), fract(a * 0.25), 1.0); }'));
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) return { error: 'link: ' + g.getProgramInfoLog(p) };
    g.useProgram(p);
    const u = g.getUniformLocation(p, 't');
    const t0 = performance.now();
    const gaps = [];
    let last = t0;
    await new Promise((done) => {
        const f = (now) => {
            g.uniform1f(u, (now - t0) / 1000);
            g.drawArrays(g.TRIANGLES, 0, 3);
            gaps.push(now - last);
            last = now;
            if (now - t0 < ${ms}) requestAnimationFrame(f); else done();
        };
        requestAnimationFrame(f);
    });
    const e = g.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(g.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : g.RENDERER));
    c.remove();
    gaps.shift();
    gaps.sort((a, b) => a - b);
    const q = (x) => gaps.length ? Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * x))] * 100) / 100 : null;
    return { renderer, frames: gaps.length, p50ms: q(0.5), p95ms: q(0.95), maxMs: q(1) };
})()`;

// In the page: a WebGPU canvas on the adapter asked for with `pp` ('high-performance', 'low-power' or '' for none), with the
// same heavy fragment loop. Windows' counters then show which card that powerPreference really gives: the only way to tell in a
// browser that hides adapter.info (Firefox). Returns the frames drawn and the adapter's own words.
export const GPU_LOAD = (pp, ms) => `(async () => {
    if (!navigator.gpu) return { error: 'no webgpu' };
    const adapter = await navigator.gpu.requestAdapter(${pp ? `{ powerPreference: '${pp}' }` : ''});
    if (!adapter) return { error: 'no adapter' };
    const device = await adapter.requestDevice();
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    c.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px;z-index:99999';
    document.body.appendChild(c);
    const ctx = c.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });
    const module = device.createShaderModule({ code: 'struct U { t: f32 }; @group(0) @binding(0) var<uniform> u: U; @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)); return vec4f(p[i], 0.0, 1.0); } @fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f { var z = pos.xy / 720.0; var a = 0.0; for (var i = 0; i < 220; i++) { z = vec2f(sin(z.x * 1.7 + u.t) + z.y, cos(z.y * 1.3 - u.t) + z.x) * 0.5; a += length(z); } return vec4f(fract(a), fract(a * 0.5), fract(a * 0.25), 1.0); }' });
    const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] } });
    const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    const t0 = performance.now();
    let frames = 0;
    await new Promise((done) => {
        const f = (now) => {
            device.queue.writeBuffer(buf, 0, new Float32Array([(now - t0) / 1000, 0, 0, 0]));
            const enc = device.createCommandEncoder();
            const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
            pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
            device.queue.submit([enc.finish()]);
            frames++;
            if (now - t0 < ${ms}) requestAnimationFrame(f); else done();
        };
        requestAnimationFrame(f);
    });
    const info = adapter.info || {};
    c.remove();
    device.destroy();
    return { frames, vendor: info.vendor || '', architecture: info.architecture || '', description: info.description || '' };
})()`;

// In chrome://gpu: the page keeps its text inside shadow roots, so walk them.
const DEEP_TEXT = `(() => {
    const out = [];
    const walk = (n) => {
        if (n.nodeType === 3) { const t = n.textContent.replace(/\\s+/g, ' ').trim(); if (t) out.push(t); return; }
        if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
        const tag = n.tagName || '';
        if (tag === 'SCRIPT' || tag === 'STYLE') return;
        if (n.shadowRoot) walk(n.shadowRoot);
        for (const c of n.childNodes) walk(c);
        if (/^(DIV|TR|LI|H1|H2|H3|H4|P|TABLE|UL|BR)$/.test(tag)) out.push('\\n');
    };
    walk(document);
    return out.join(' ').replace(/ *\\n */g, '\\n').replace(/\\n{2,}/g, '\\n');
})()`;

/** The lines of chrome://gpu that name adapters (GPU0, GPU1, ACTIVE, renderer, backends), for a quick look. */
export function gpuPageSummary(text) {
    return text.split('\n').filter((l) => /^(GPU\d|GL_RENDERER|GL_VENDOR|Display type|ANGLE commit|WebGPU Status)|\*ACTIVE\*|<(Discrete|Integrated|CPU) GPU>|Dawn Info|Canvas:|WebGL\d?:|WebGPU:|Rasterization:|Compositing:|Video Decode:/i.test(l)).map((l) => l.slice(0, 300));
}

/** The verdict of the readings, each on its own (the same shape for every browser). */
function verdict(result) {
    const names = Object.entries(result.counters?.perAdapter ?? {});
    const name = (a) => (a && typeof a === 'object' ? `${a.vendor} ${a.architecture}`.trim() : a ?? null);
    return {
        webgpuHigh: name(result.page?.adapters?.high),
        webgpuLow: name(result.page?.adapters?.low),
        webgpuNone: name(result.page?.adapters?.none),
        webgl: result.page?.webgl ?? null,
        loadRenderer: result.load?.renderer ?? null,
        busiestAdapter: names.sort((a, b) => b[1].max3d - a[1].max3d).map(([n, v]) => `${n}: 3D max ${v.max3d} %, dedicated ${v.dedicatedMb} MB, shared ${v.sharedMb} MB`),
        nvidiaSmiListsGpuProcess: result.nvidiaSmi?.gpuProcessListed ?? null,
        // a WebGPU canvas asked for with each powerPreference: the adapter's own words and the busiest adapter by Windows' counters
        webgpuLoad: result.webgpuLoad ? Object.fromEntries(Object.entries(result.webgpuLoad).map(([k, v]) => [k, { adapter: v.load && !v.load.error ? `${v.load.vendor} ${v.load.architecture}`.trim() : null, error: v.load?.error ?? null, frames: v.load?.frames ?? null, busiest: Object.entries(v.perAdapter ?? {}).sort((a, b) => b[1].max3d - a[1].max3d).map(([n, x]) => `${n} ${x.max3d} %`).slice(0, 2) }])) : null
    };
}

function smiRecord(gpuPid) {
    const smi = nvidiaSmi();
    // only the probe's own GPU process is written out. Everything else on the card is counted, never named: the person's own
    // browser and whatever else the person runs are not this probe's to record
    return { available: smi.available, gpu: smi.gpu ?? null, gpuProcessListed: gpuPid ? smi.pids.includes(gpuPid) : null, browserRows: gpuPid ? smi.rows.filter((r) => r.pid === gpuPid) : [], otherBrowserProcesses: smi.rows.filter((r) => /chrome|msedge|firefox/i.test(r.name) && r.pid !== gpuPid).length, otherPrograms: smi.rows.filter((r) => !/chrome|msedge|firefox/i.test(r.name)).length };
}

/** Every process under `rootPid` with its command line (Windows), to find a browser's GPU process. */
function descendants(rootPid) {
    const r = powershell(`$ErrorActionPreference = 'SilentlyContinue'; $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine; $want = @(${rootPid}); $out = @(); for ($i = 0; $i -lt 6; $i++) { $next = @($all | Where-Object { $want -contains $_.ParentProcessId -and ($out.ProcessId -notcontains $_.ProcessId) }); if (-not $next.Count) { break }; $out += $next; $want = @($next.ProcessId) }; @($out) | ConvertTo-Json -Compress`);
    try {
        const j = JSON.parse(r.out || '[]');
        return Array.isArray(j) ? j : [j];
    } catch {
        return [];
    }
}

/** The Firefox process that runs with OUR throwaway profile (its command line names the folder), or null. */
function firefoxMainPid(profile) {
    const r = powershell(`$ErrorActionPreference = 'SilentlyContinue'; $p = Get-CimInstance Win32_Process -Filter "Name='firefox.exe'" | Where-Object { $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' -and $_.CommandLine -notlike '*-contentproc*' } | Select-Object -First 1; if ($p) { $p.ProcessId }`);
    const n = Number(r.out);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Firefox has no DevTools port a plain script can use, so it opens a page of ours on localhost (a secure context,
 * so WebGPU is there) that takes the same readings and posts them back. Its own throwaway profile, a real window.
 */
async function firefoxRun(o, exe, outDir, result) {
    const profile = join(REPO, '.cache', 'gpu-select', `${o.label}-profile`);
    rmSync(profile, { recursive: true, force: true });
    mkdirSync(profile, { recursive: true });
    // no first-run pages, no default-browser question, no telemetry prompt: nothing else changes
    writeFileSync(join(profile, 'user.js'), ['browser.shell.checkDefaultBrowser', 'browser.aboutwelcome.enabled', 'datareporting.policy.dataSubmissionEnabled', 'toolkit.telemetry.reportingpolicy.firstRun', 'browser.tabs.warnOnClose', 'app.update.auto', 'app.update.enabled'].map((k) => `user_pref("${k}", false);`).join('\n') + '\nuser_pref("browser.startup.homepage_override.mstone", "ignore");\nuser_pref("startup.homepage_welcome_url", "");\nuser_pref("startup.homepage_welcome_url.additional", "");\n');
    // the page says what it is about to draw ("stage"), draws it for a fixed time while Windows' counters are read here, and
    // at the end posts everything ("result"): WebGL first, then WebGPU asked for with high-performance and with low-power
    const events = [];
    let wake = null;
    const next = async (ms, what) => {
        const t0 = Date.now();
        while (!events.length) {
            if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
            await new Promise((r) => { wake = r; setTimeout(r, 250); });
        }
        return events.shift();
    };
    const ms = o.seconds * 1000 + 4500;
    const html = `<!doctype html><meta charset="utf-8"><title>gpu-select probe</title><body style="background:#111;color:#ddd;font:16px sans-serif"><p id="o">measuring</p><script>
(async () => {
    const post = (path, body) => fetch(path, { method: 'POST', body: JSON.stringify(body) });
    try {
        const page = await ${READ_ADAPTERS};
        const loads = {};
        await post('/stage', { name: 'webgl', page });
        loads.webgl = await ${LOAD(ms)};
        await post('/stage', { name: 'webgpu-high-performance' });
        loads['webgpu-high-performance'] = await ${GPU_LOAD('high-performance', ms)}.catch((e) => ({ error: String(e && e.message || e) }));
        await post('/stage', { name: 'webgpu-low-power' });
        loads['webgpu-low-power'] = await ${GPU_LOAD('low-power', ms)}.catch((e) => ({ error: String(e && e.message || e) }));
        await post('/result', { page, loads });
        document.getElementById('o').textContent = 'done';
    } catch (e) {
        await post('/result', { error: String((e && e.stack) || e) });
    }
})();
</script>`;
    const server = createServer((req, res) => {
        if (req.method === 'POST') {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
                let j;
                try { j = JSON.parse(body); } catch { j = { error: 'bad json' }; }
                events.push({ kind: req.url === '/stage' ? 'stage' : 'result', ...j });
                wake?.();
                res.writeHead(204).end();
            });
            return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const variant = VARIANTS[o.variant];
    const child = spawn(exe, ['-no-remote', '-new-instance', '-profile', profile, ...o.extra, url], { env: { ...process.env, ...variant.env }, stdio: 'ignore', windowsHide: false });
    result.launch = { executable: mask(exe), added: [...o.extra], env: variant.env, profile: 'throwaway (.cache/gpu-select)', visible: true, how: 'a localhost page posts its readings back (no DevTools port)' };
    result.url = 'http://127.0.0.1:<port>/ (the probe page)';
    try {
        const stage = await next(90000, 'the page did not report in 90 s');
        if (stage.error) throw new Error(`page: ${stage.error}`);
        result.page = stage.page;
        result.browser = { product: (/Firefox\/[\d.]+/.exec(stage.page.userAgent) ?? [''])[0], userAgent: stage.page.userAgent };
        // Firefox's first process hands over to another one and exits: its id is ours only while it still runs (Windows gives
        // a freed id to the next program that starts)
        const mainPid = firefoxMainPid(profile) ?? (child.exitCode === null ? child.pid : null);
        if (!mainPid) throw new Error('the Firefox instance of the throwaway profile was not found');
        const tree = descendants(mainPid);
        const gpuProc = tree.find((p) => /\sgpu\s*$/.test(p.CommandLine ?? ''));
        result.gpuProcessPid = gpuProc?.ProcessId ?? null;
        result.processTree = { count: tree.length, kinds: tree.map((p) => (/\s(\w+)\s*$/.exec(p.CommandLine ?? '') ?? ['', '?'])[1]) };
        await sleep(700);
        // without a GPU process (Firefox can draw in its parent process) the busiest of its processes is read instead
        const pid = gpuProc?.ProcessId ?? mainPid;
        result.countersOfPid = pid;
        result.counters = await gpuCountersAsync(pid, o.seconds);
        // the two WebGPU loads, each with its own reading of the counters
        result.webgpuLoad = {};
        let done = null;
        for (;;) {
            const ev = await next(90000, 'the page stopped reporting');
            if (ev.kind === 'result') {
                done = ev;
                break;
            }
            await sleep(700);
            result.webgpuLoad[ev.name] = { perAdapter: (await gpuCountersAsync(pid, o.seconds)).perAdapter ?? null };
        }
        if (done.error) throw new Error(`page: ${done.error}`);
        result.load = done.loads.webgl;
        for (const [k, v] of Object.entries(done.loads)) if (k !== 'webgl') result.webgpuLoad[k] = { ...(result.webgpuLoad[k] ?? {}), load: v };
        result.nvidiaSmi = smiRecord(pid);
        result.gpuPage = { error: 'about:support is not read (no automation port in a stock Firefox)' };
        result.verdict = verdict(result);
    } finally {
        server.close();
        if (!o.keep) {
            // end the instance that holds OUR profile, found by the profile's path in its command line; the first process only
            // while it still runs (see above: never an id that may have gone to another program)
            for (const pid of [firefoxMainPid(profile), child.exitCode === null ? child.pid : null]) if (pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
            await sleep(2000);
            try {
                rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
            } catch {
                /* a file still held: the next run of this label clears it */
            }
        }
    }
}

/**
 * A browser started the way a person starts it: its own executable, a throwaway profile under .cache/, a real
 * window, no Playwright launch flags; then attached over its DevTools port. `variant` and `extra` are the only
 * things added. close() ends OUR process tree by pid (never a browser the person is using) and drops the profile.
 */
export async function startStockBrowser({ exe, label, variant = 'default', extra = [], maximized = false, keepProfile = false, prefs = null }) {
    const v = VARIANTS[variant];
    const profile = join(REPO, '.cache', 'gpu-select', `${label}-profile`);
    // keepProfile: the second start of a profile an earlier start prepared (a flag set in chrome://flags)
    if (!keepProfile) rmSync(profile, { recursive: true, force: true });
    mkdirSync(profile, { recursive: true });
    // prefs: what the profile holds before its first start (the browser reads it as its own Preferences file)
    if (prefs) {
        mkdirSync(join(profile, 'Default'), { recursive: true });
        writeFileSync(join(profile, 'Default', 'Preferences'), JSON.stringify(prefs));
    }
    const size = maximized ? ['--start-maximized'] : ['--window-position=40,40', '--window-size=1296,920'];
    const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', ...size, ...v.args, ...extra, 'about:blank'];
    const child = spawn(exe, args, { env: { ...process.env, ...v.env }, stdio: 'ignore', windowsHide: false });
    const launch = { executable: mask(exe), added: [...size, ...v.args, ...extra], env: v.env, profile: 'throwaway (.cache/gpu-select)', visible: !v.args.concat(extra).some((x) => x.startsWith('--headless')) };
    let browser = null;
    // close(true): leave the browser running; close({ keepProfile: true }): end it but keep its profile for a second start
    const close = async (o = false) => {
        if (o === true || o?.keepRunning === true) {
            if (browser) await browser.close().catch(() => {});
            return;
        }
        const keepFiles = o?.keepProfile === true;
        try {
            if (browser) await (await browser.newBrowserCDPSession()).send('Browser.close');
        } catch {
            /* already gone */
        }
        if (browser) await browser.close().catch(() => {});
        await sleep(1500);
        if (child.pid && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        await sleep(500);
        if (keepFiles) return;
        try {
            rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
        } catch {
            /* a file still held: the next run of this label clears it */
        }
    };
    try {
        const portFile = join(profile, 'DevToolsActivePort');
        const t0 = Date.now();
        while (!existsSync(portFile)) {
            if (Date.now() - t0 > 30000) throw new Error('the browser did not open its DevTools port in 30 s');
            await sleep(200);
        }
        await sleep(300);
        const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const cdp = await browser.newBrowserCDPSession();
        const ver = await cdp.send('Browser.getVersion');
        const context = browser.contexts()[0];
        const page = context.pages()[0] ?? (await context.newPage());
        return { child, browser, cdp, context, page, profile, launch, version: { product: ver.product, userAgent: ver.userAgent }, close };
    } catch (e) {
        await close(false);
        throw e;
    }
}

/** The browser's own account of its GPUs (the first device is the active one), with the command line masked. */
export async function systemInfo(cdp) {
    const info = await cdp.send('SystemInfo.getInfo');
    return { gpu: { devices: info.gpu?.devices ?? null, auxAttributes: info.gpu?.auxAttributes ?? null, driverBugWorkarounds: info.gpu?.driverBugWorkarounds ?? null }, modelName: info.modelName ?? null, commandLine: mask(info.commandLine ?? '') };
}

/** The pid of the browser's GPU process, or null (software compositing has none). */
export async function gpuProcessPid(cdp) {
    const procs = (await cdp.send('SystemInfo.getProcessInfo')).processInfo ?? [];
    return procs.find((p) => p.type === 'GPU')?.id ?? null;
}

/** chrome://gpu as text into <label>-gpu-page.txt, and its adapter lines. */
export async function gpuPageText(context, outDir, label) {
    const g = await context.newPage();
    try {
        await g.goto('chrome://gpu', { waitUntil: 'load', timeout: 30000 });
        await sleep(2500);
        const text = mask(await g.evaluate(DEEP_TEXT));
        writeFileSync(join(outDir, `${label}-gpu-page.txt`), asciiJson(text) + '\n');
        return { file: `${label}-gpu-page.txt`, chars: text.length, summary: gpuPageSummary(text) };
    } catch (e) {
        return { error: String(e.message ?? e).slice(0, 300) };
    } finally {
        await g.close().catch(() => {});
    }
}

async function main() {
    const o = parseArgs(process.argv.slice(2));
    if (process.platform !== 'win32') throw new Error('gpu-select-probe: Windows only');
    const exe = browserExe(o.browser);
    if (!exe || !existsSync(exe)) throw new Error(`no executable for --browser ${o.browser}`);
    const date = new Date().toISOString().slice(0, 10);
    const outDir = o.out || join(REPO, 'evidence', date, 'gpu-select');
    mkdirSync(outDir, { recursive: true });
    if (/firefox/i.test(exe)) {
        const result = { name: `gpu-select/${o.label}`, date: new Date().toISOString(), label: o.label, browserName: o.browser, variant: o.variant };
        try {
            await firefoxRun(o, exe, outDir, result);
        } catch (e) {
            result.error = String(e?.stack ?? e).slice(0, 1200);
        }
        const file = join(outDir, `${o.label}.json`);
        writeFileSync(file, asciiJson(mask(JSON.stringify(result, null, 2))) + '\n');
        console.log(JSON.stringify({ file: file.replace(REPO, '.').replace(/\\/g, '/'), verdict: result.verdict ?? null, error: result.error ?? null }, null, 2));
        if (result.error) process.exitCode = 1;
        return;
    }
    const result = { name: `gpu-select/${o.label}`, date: new Date().toISOString(), label: o.label, browserName: o.browser, variant: o.variant };
    let stock = null;
    // stopped by hand (Ctrl+C): the browser of this run and its profile go with it
    process.on('SIGINT', () => {
        void (async () => {
            try {
                if (stock) await stock.close(false);
            } catch {
                /* already gone */
            } finally {
                process.exit(130);
            }
        })();
    });
    try {
        stock = await startStockBrowser({ exe, label: o.label, variant: o.variant, extra: o.extra });
        const { cdp, context, page } = stock;
        result.launch = stock.launch;
        result.browser = stock.version;
        await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(1500);
        result.url = o.url;
        result.page = await page.evaluate(READ_ADAPTERS);
        // SystemInfo after the page asked for its adapters: the GPU process is up and has chosen
        result.systemInfo = await systemInfo(cdp);
        const gpuPid = await gpuProcessPid(cdp);
        result.gpuProcessPid = gpuPid;
        // the load and the counters at the same time
        await page.bringToFront();
        const load = page.evaluate(LOAD(o.seconds * 1000 + 1500));
        await sleep(700);
        result.counters = gpuPid ? await gpuCountersAsync(gpuPid, o.seconds) : { error: 'no GPU process in SystemInfo.getProcessInfo' };
        result.load = await load;
        result.nvidiaSmi = smiRecord(gpuPid);
        result.gpuPage = await gpuPageText(context, outDir, o.label);
        result.verdict = verdict(result);
    } catch (e) {
        result.error = String(e?.stack ?? e).slice(0, 1200);
    } finally {
        if (stock) await stock.close(o.keep);
    }
    const file = join(outDir, `${o.label}.json`);
    writeFileSync(file, asciiJson(mask(JSON.stringify(result, null, 2))) + '\n');
    console.log(JSON.stringify({ file: file.replace(REPO, '.').replace(/\\/g, '/'), verdict: result.verdict ?? null, error: result.error ?? null }, null, 2));
    if (result.error) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) await main();

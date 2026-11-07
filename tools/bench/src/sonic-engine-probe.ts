// v0.12 Fly by Sound, lane v12-flight step 7 (docs/wip/v12-plan.md 2.2 and 4.2): the sound engine in a real page.
// Opens apps/fly/lab/sonic-engine.html on the Vite dev server, clicks Start (a real user activation) and measures what
// the page does, with a tap in front of the AudioContext's destination (an init script: a gain node into an analyser
// and the real destination, so every sound of the page is seen whoever made it; headless Chrome runs muted, the graph
// still runs). Measured: how many AudioContexts the page made, that the context runs, the output level with the layers
// off, with a wall 3 m ahead closing at 3 m/s, and after setLayers({ on: [] }) (what the bridge sends when frames
// stop); the peak of a loud signal that enters through the engine's input node against the same signal straight at the
// destination (the limiter is in front of the first, not the second); the motor sound on the engine's input node; the
// captions region's live state against "my screen reader speaks". How any of it sounds is not judged here.
//   cd apps/fly && npx vite --port 5342 --strictPort            (another shell)
//   cd tools/bench && LAB=http://localhost:5342 npx tsx src/sonic-engine-probe.ts
// Writes evidence/<date>/sonic-engine.json. The page draws nothing, so no GPU lock.
import { launch } from './browser';
import { writeEvidence } from './evidence';

const LAB = (process.env.LAB ?? '').replace(/\/$/, '');
if (!LAB) throw new Error('LAB=http://localhost:<vite port> is needed');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Runs before the page: counts the AudioContexts and puts a tap in front of the destination of each. */
const TAP = `(() => {
  const Orig = window.AudioContext;
  window.__acCount = 0;
  window.__tapRead = null;
  class TapContext extends Orig {
    constructor(o) { super(o); window.__acCount++; window.__ac = this; }
    get destination() {
      if (!this.__tapIn) {
        const real = super.destination;
        const g = this.createGain();
        const an = this.createAnalyser();
        an.fftSize = 2048;
        g.connect(an);
        g.connect(real);
        this.__tapIn = g;
        const buf = new Float32Array(2048);
        window.__tapRead = () => {
          an.getFloatTimeDomainData(buf);
          let s = 0, p = 0;
          for (let i = 0; i < buf.length; i++) { const x = buf[i]; s += x * x; const a = Math.abs(x); if (a > p) p = a; }
          return { rms: Math.sqrt(s / buf.length), peak: p };
        };
      }
      return this.__tapIn;
    }
  }
  window.AudioContext = TapContext;
})();`;

interface Lab {
    state(): { engine: string; ac: string | null; currentTime: number | null; available: boolean; auxReady: boolean };
}

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value)}`);
};

const L = await launch({ width: 900, height: 600 });
await L.context.addInitScript(TAP);
const page = L.page;
const notFound: string[] = [];
page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });
const ev = <T>(fn: string): Promise<T> => page.evaluate(fn) as Promise<T>;

/** The output level over `ms`: the largest RMS and peak of the analyser's 2048-sample window, polled every 10 ms. */
async function level(ms: number): Promise<{ maxRms: number; peak: number; polls: number }> {
    return page.evaluate(
        (span) =>
            new Promise<{ maxRms: number; peak: number; polls: number }>((resolve) => {
                const read = (window as unknown as { __tapRead: (() => { rms: number; peak: number }) | null }).__tapRead;
                let maxRms = 0, peak = 0, polls = 0;
                const id = setInterval(() => {
                    const r = read ? read() : { rms: -1, peak: -1 };
                    maxRms = Math.max(maxRms, r.rms);
                    peak = Math.max(peak, r.peak);
                    polls++;
                }, 10);
                setTimeout(() => {
                    clearInterval(id);
                    resolve({ maxRms, peak, polls });
                }, span);
            }),
        ms
    );
}

try {
    await page.goto(`${LAB}/fly/lab/sonic-engine.html`);
    await page.waitForFunction(() => (window as unknown as { __engineLab?: { ready: boolean } }).__engineLab?.ready === true, undefined, { timeout: 60000 });
    const voices = await ev<number>('speechSynthesis.getVoices().length');

    // ---- before the press: no context at all
    check('no AudioContext before the press', (await ev<number>('window.__acCount')) === 0);
    check('engine idle before the press', (await ev<ReturnType<Lab['state']>>('window.__engineLab.state()')).engine === 'idle');

    // ---- the press
    await page.click('#start');
    await page.waitForFunction(() => (window as unknown as { __engineLab: { state(): { engine: string } } }).__engineLab.state().engine === 'running', undefined, { timeout: 15000 });
    const s1 = await ev<ReturnType<Lab['state']>>('window.__engineLab.state()');
    check('one AudioContext after the press', (await ev<number>('window.__acCount')) === 1, await ev<number>('window.__acCount'));
    check('the context runs and the engine runs', s1.ac === 'running' && s1.engine === 'running', s1);
    check('the engine\'s input node exists (the motor sound plugs in there)', s1.auxReady);
    await sleep(300);
    const s2 = await ev<ReturnType<Lab['state']>>('window.__engineLab.state()');
    check('the audio clock advances (the graph is being rendered)', (s2.currentTime ?? 0) > (s1.currentTime ?? 0) + 0.15, { t1: s1.currentTime, t2: s2.currentTime });

    // ---- the output level
    await page.evaluate(() => { const l = (window as any).__engineLab; l.setLayers({ on: [], heightBandM: null, hazardVoices: 0 }); l.frames(true); });
    await sleep(1400); // the 1 s fade-in is over
    const quiet = await level(1000);
    check('layers off, frames running: the output is silent (RMS under 1e-4)', quiet.polls > 50 && quiet.maxRms >= 0 && quiet.maxRms < 1e-4, quiet);

    await page.evaluate(() => (window as any).__engineLab.setLayers({ on: ['safety', 'voice'], heightBandM: null, hazardVoices: 2 }));
    await sleep(300);
    const wall = await level(2000);
    const cues = await ev<string[]>('window.__engineLab.activeCues()');
    check('a wall 3 m ahead closing at 3 m/s: the output has sound (RMS over 2e-3)', wall.maxRms > 2e-3, wall);
    check('the engine names an active safety cue', cues.some((c) => c.startsWith('safety.')), cues);
    check('the output holds the ceiling: peak at or under -6 dBFS (0.5012)', wall.peak <= 0.5013, wall.peak);

    // frames stop and the layers go off, as the bridge sends when the flight pauses
    await page.evaluate(() => { const l = (window as any).__engineLab; l.frames(false); l.setLayers({ on: [], heightBandM: null, hazardVoices: 0 }); });
    await sleep(900);
    const after = await level(1000);
    check('frames stopped and setLayers({ on: [] }): the output is silent again (RMS under 1e-4)', after.maxRms < 1e-4, after);

    // ---- the limiter is in front of the engine's input node and not in front of the destination
    await page.evaluate(() => (window as any).__engineLab.loud('aux'));
    await sleep(1300);
    const viaAux = await level(800);
    await page.evaluate(() => (window as any).__engineLab.loud('off'));
    await sleep(300);
    await page.evaluate(() => (window as any).__engineLab.loud('destination'));
    await sleep(300);
    const direct = await level(800);
    await page.evaluate(() => (window as any).__engineLab.loud('off'));
    check('a loud signal into the engine\'s input node comes out at or under the ceiling (peak <= 0.5013)', viaAux.peak > 0.05 && viaAux.peak <= 0.5013, viaAux);
    check('control: the same signal straight at the destination is not limited (peak over 0.9)', direct.peak > 0.9, direct);

    // ---- the motor sound plugged into the engine's input node
    await sleep(500);
    const preMotor = await level(500);
    await page.evaluate(() => (window as any).__engineLab.motor(true));
    await sleep(500);
    const motor = await level(1000);
    const acAfterMotor = (await ev<ReturnType<Lab['state']>>('window.__engineLab.state()')).ac;
    check('the motor sound on the engine\'s input node is heard (RMS over 1e-3, silent before)', preMotor.maxRms < 1e-4 && motor.maxRms > 1e-3, { before: preMotor, motor });
    check('and it stays under the ceiling (peak <= 0.5013)', motor.peak <= 0.5013, motor.peak);
    await page.evaluate(() => (window as any).__engineLab.motor(false));
    await sleep(600);
    const motorOff = await level(600);
    check('closing the motor sound leaves the context running and the output silent', (await ev<ReturnType<Lab['state']>>('window.__engineLab.state()')).ac === 'running' && acAfterMotor === 'running' && motorOff.maxRms < 1e-4, motorOff);
    check('still one AudioContext', (await ev<number>('window.__acCount')) === 1);

    // ---- speech and the captions
    await page.evaluate(() => (window as any).__engineLab.say({ key: 'fly.go' }, false));
    const lines1 = await ev<string[]>('window.__engineLab.captionLines()');
    const root1 = await ev<Record<string, unknown>>('window.__engineLab.captionRoot()');
    check('a spoken line is captioned (the engine\'s text, English)', lines1.length === 1 && /\S/.test(lines1[0] ?? ''), lines1);
    check('the engine speaks (default): the captions region is shown and not live, so a screen reader does not say it twice', root1.live === 'off' && root1.hidden === false && root1.role === 'log', root1);

    await page.evaluate(() => (window as any).__engineLab.update({ selfVoice: false }));
    const root2 = await ev<Record<string, unknown>>('window.__engineLab.captionRoot()');
    check('"my screen reader speaks": the region is a polite live region', root2.live === 'polite' && root2.hidden === false, root2);
    await page.evaluate(() => (window as any).__engineLab.say({ key: 'fly.paused' }, false));
    const lines2 = await ev<string[]>('window.__engineLab.captionLines()');
    check('the line is still captioned when the engine does not voice it', lines2.length === 2, lines2);

    await page.evaluate(() => (window as any).__engineLab.update({ captions: false }));
    const root3 = await ev<Record<string, unknown>>('window.__engineLab.captionRoot()');
    check('captions hidden from the eye but a screen reader still reads them: visually hidden, still live', root3.live === 'polite' && root3.srOnly === true && root3.hidden === false, root3);

    await page.evaluate(() => (window as any).__engineLab.update({ selfVoice: true }));
    const root4 = await ev<Record<string, unknown>>('window.__engineLab.captionRoot()');
    const lines4 = await ev<string[]>('window.__engineLab.captionLines()');
    check('the engine speaks and captions are off: nothing on the page, no line kept', root4.hidden === true && lines4.length === 0, { root4, lines4 });

    // ---- settings reach the engine
    const bad = await ev<{ ok: boolean }>('window.__engineLab.update({ speechRate: 9 })');
    check('a setting out of range is refused and changes nothing', bad.ok === false && (await ev<{ speechRate: number }>('window.__engineLab.prefs()')).speechRate === 1);

    // a browser asks for /favicon.ico by itself; any other missing file is a fault
    const missing = notFound.filter((u) => !/\/favicon\.ico$/.test(u));
    const errors = L.console.filter((l) => /^(error|pageerror)/i.test(l) && !(/404/.test(l) && missing.length === 0));
    check('no console errors, no missing file but the favicon', errors.length === 0 && missing.length === 0, { errors, notFound });

    const file = writeEvidence('sonic-engine', {
        step: 'v12-flight 7: the sound engine in a real page (SonicSetup, the one AudioContext from a click, the tap in front of the destination)',
        page: 'apps/fly/lab/sonic-engine.html (Vite dev server)',
        speechVoices: voices,
        note: 'headless Chrome runs muted (--mute-audio): the graph is rendered and measured, nothing is played; how it sounds is not judged here',
        checks,
        pass: checks.every((c) => c.pass)
    });
    console.log(`evidence ${file}; ${checks.filter((c) => c.pass).length}/${checks.length} checks pass`);
} finally {
    await L.browser.close();
}

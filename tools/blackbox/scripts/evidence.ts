// Writes evidence/<date>/v03-blackbox.json: the BetaFPV dump table (before / after this change),
// the decoder against the official blackbox_decode on public logs, and the fit on public logs and on
// the simulator's own log with its controls. Every number is computed here; never edit the output.
//
//   npx tsx tools/blackbox/scripts/evidence.ts --out evidence/2026-09-28/v03-blackbox.json \
//       [--baseline <old bfdiff.ts>] \
//       [--log <file.bbl> <official.csv> [<official.gps.csv>|-] <source note>]...
//
// --baseline: the parser before this change (git show 563d33e:packages/sim-core/src/bfdiff.ts with
// its import of ./rates pointed at the package), to count what parsed before.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseBetaflightDiff } from '@gsfpv/sim-core';
import type { PresetJson } from '@gsfpv/sim-core';
import { decodeBlackbox } from '../src/decode';
import { compareGpsWithOfficialCsv, compareWithOfficialCsv } from '../src/compare';
import { extractSignals } from '../src/signals';
import { fitLog, type FitReport } from '../src/fit';
import { synthLog, type SynthOptions } from '../test/synth';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

function args(): { out: string; baseline?: string; logs: { file: string; csv: string; gps: string | null; note: string }[] } {
    const a = process.argv.slice(2);
    const res: ReturnType<typeof args> = { out: '', logs: [] };
    for (let i = 0; i < a.length; i++) {
        if (a[i] === '--out') res.out = a[++i];
        else if (a[i] === '--baseline') res.baseline = a[++i];
        else if (a[i] === '--log') {
            res.logs.push({ file: a[i + 1], csv: a[i + 2], gps: a[i + 3] === '-' ? null : a[i + 3], note: a[i + 4] });
            i += 4;
        }
    }
    if (!res.out) throw new Error('--out is required');
    return res;
}

/** The fit report without the bulky parts, numbers rounded for reading. */
function summary(r: FitReport) {
    const round = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(4)) : null);
    return {
        log: r.log,
        estimates: Object.fromEntries(Object.entries(r.estimates).map(([k, e]) => [k, { value: round(e.value), se: round(e.se), unit: e.unit, confidence: e.confidence, basis: e.basis }])),
        rates: r.rates && { type: r.rates.config.type, maxDegS: r.rates.maxDegS, setpointErrDegS: r.rates.setpointErrDegS?.map(round), stickP995: r.rates.stickP995?.map(round) },
        notIdentified: r.notIdentified,
        preset: r.preset
    };
}

async function main(): Promise<void> {
    const a = args();
    const out: Record<string, unknown> = {
        generated: new Date().toISOString(),
        generator: 'tools/blackbox/scripts/evidence.ts',
        note: 'W4-3 (design H.3, H.4). Decoder and fit are ours (tools/blackbox); the official decoder is blackbox_decode built from github.com/betaflight/blackbox-tools master f832acf9cd9dbe5ad8220de1a5f4eb4021523d72.'
    };

    // ---- H.3: the BetaFPV dumps
    const dir = join(ROOT, 'packages', 'sim-core', 'test', 'fixtures', 'betafpv');
    const before = a.baseline ? ((await import(pathToFileURL(resolve(a.baseline)).href)) as { parseBetaflightDiff: typeof parseBetaflightDiff }).parseBetaflightDiff : null;
    const dumps = readdirSync(dir)
        .filter((f) => f.endsWith('.txt'))
        .sort()
        .map((f) => {
            const text = readFileSync(join(dir, f), 'utf8');
            const r = parseBetaflightDiff(text);
            const b = before ? before(text) : null;
            const v = r.firmware.version;
            return {
                file: f,
                sha256: sha(readFileSync(join(dir, f))),
                version: v ? `${v.major}.${v.minor}.${v.patch}` : null,
                semantics: r.firmware.semantics,
                releaseOfBuildHash: r.firmware.releaseOfHash,
                parsed: r.errors.length === 0,
                errors: r.errors,
                pid: r.pid,
                rates: r.rates && `${r.rates.type} ${r.rates.roll.rcRate}/${r.rates.roll.rate}/${r.rates.roll.expo}`,
                throttle: r.throttle,
                idle: r.idle,
                ignoredSettings: r.ignored.length,
                ignoredCommands: Object.values(r.ignoredCommands).reduce((s, n) => s + n, 0),
                warnings: r.warnings,
                before: b ? { parsed: b.errors.length === 0, errors: b.errors } : null
            };
        });
    out.betafpvDumps = {
        source: 'packages/sim-core/test/fixtures/betafpv/README.md',
        parsedAfter: `${dumps.filter((d) => d.parsed).length} of ${dumps.length}`,
        parsedBefore: before ? `${dumps.filter((d) => d.before?.parsed).length} of ${dumps.length}` : 'not run',
        idleImported: dumps.every((d) => d.idle !== null),
        dumps
    };

    // ---- H.4: decoder against the official CSV, and the fit, on public logs
    const logs = [];
    for (const l of a.logs) {
        const bytes = new Uint8Array(readFileSync(l.file));
        const t0 = Date.now();
        const decoded = decodeBlackbox(bytes);
        const ms = Date.now() - t0;
        const log = decoded[0];
        const main = compareWithOfficialCsv(log, readFileSync(l.csv, 'utf8'));
        const gps = l.gps ? compareGpsWithOfficialCsv(log, readFileSync(l.gps, 'utf8')) : null;
        const fit = fitLog(extractSignals(log));
        logs.push({
            source: l.note,
            sha256: sha(bytes),
            bytes: bytes.length,
            firmware: log.sys.firmware,
            decodeMs: ms,
            stats: log.stats,
            events: log.events.map((e) => e.kind),
            compare: { ...main, comparedColumns: main.comparedColumns.length },
            gps,
            fit: summary(fit)
        });
        console.log(`${l.file}: ${main.cells} cells, ${main.mismatchedCells} mismatched; ${main.onlyOurs} rows only ours (${main.onlyOursAfterEvent} after a disarm / flight-mode event)`);
    }
    out.publicLogs = logs;

    // ---- the fit on the simulator's own log, and its controls
    const preset = JSON.parse(readFileSync(join(ROOT, 'packages', 'sim-core', 'presets', 'pavo20pro-3s.json'), 'utf8')) as PresetJson;
    const synth = (o: SynthOptions, massG?: number) => {
        const { bytes, params } = synthLog(o);
        const r = fitLog(extractSignals(decodeBlackbox(bytes)[0]), { preset, massG });
        return { truth: { twr: params.twr, tauMs: params.tau * 1000, rotorInertia: params.rotorInertia, kappa: params.kappa, ductDrag: params.ductDrag, inertiaRollPitch: params.inertia[0], inertiaYaw: params.inertia[1] }, fit: summary(r) };
    };
    out.simulatorLog = {
        what: 'sim-core flies the H.4 flight script on pavo20pro-3s and writes a binary log (Betaflight 4.5 fields, gyro noise 1 deg/s, accelerometer 0.01 g, rpm 0.5 %, rpm one loop late); the fit must return the parameters the simulator used',
        base: synth({ attitudeDebug: true }, 151),
        controls: {
            rotorInertia0: synth({ attitudeDebug: true, overrides: { propInertia: 0 } }),
            ductDrag0: synth({ attitudeDebug: true, overrides: { ductDrag: 0 } }),
            tau30ms: synth({ attitudeDebug: false, overrides: { tauMs: 30 } }),
            noRpm: synth({ attitudeDebug: true, noRpm: true })
        }
    };
    mkdirSync(dirname(a.out), { recursive: true });
    writeFileSync(a.out, JSON.stringify(out, null, 1) + '\n');
    console.log(`-> ${a.out}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

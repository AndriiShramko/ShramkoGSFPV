// Blackbox tooling command line (Node only).
//
//   npx tsx tools/blackbox/src/cli.ts info    <log.bbl>
//   npx tsx tools/blackbox/src/cli.ts decode  <log.bbl> [--index N] [--out file.csv]
//   npx tsx tools/blackbox/src/cli.ts compare <log.bbl> <official.csv> [--gps official.gps.csv] [--index N]
//   npx tsx tools/blackbox/src/cli.ts fit     <log.bbl> [--index N] [--preset pavo20pro-3s] [--mass 151] [--json out.json]
//
// `compare` expects a CSV from the official decoder run as
//   blackbox_decode --unit-vbat raw --unit-amperage raw --unit-flags raw <log>

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PresetJson } from '@gsfpv/sim-core';
import { decodeBlackbox, type DecodedLog } from './decode';
import { compareGpsWithOfficialCsv, compareWithOfficialCsv } from './compare';
import { extractSignals } from './signals';
import { fitLog, presetHover } from './fit';
import { renderReport } from './report';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRESETS = join(HERE, '..', '..', '..', 'packages', 'sim-core', 'presets');

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function load(path: string): DecodedLog[] {
    return decodeBlackbox(new Uint8Array(readFileSync(path)));
}

function pick(logs: DecodedLog[]): DecodedLog[] {
    const i = arg('index');
    if (i === undefined) return logs;
    const l = logs[Number(i) - 1];
    if (!l) throw new Error(`log ${i} not in the file (it has ${logs.length})`);
    return [l];
}

export function toCsv(log: DecodedLog): string {
    const lines = [[...log.main.names, ...log.slow.names].join(',')];
    const cols = log.main.names.map((n) => log.main.col(n));
    for (let k = 0; k < log.main.length; k++) {
        const s = log.mainSlow[k] >= 0 ? log.slow.row(log.mainSlow[k]) : log.slow.names.map(() => 0);
        lines.push([...cols.map((c) => c[k]), ...s].join(','));
    }
    return lines.join('\n') + '\n';
}

function main(): void {
    const [cmd, file, second] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));
    if (!cmd || !file) {
        console.log('usage: cli.ts info|decode|compare|fit <log> [...]  (see the header of this file)');
        process.exit(2);
    }
    const logs = load(file);
    if (cmd === 'info') {
        for (const l of logs) {
            const s = l.stats;
            console.log(`log ${l.index}: ${l.sys.firmware} | ${l.main.length} main frames (I ${s.frames.I}, P ${s.frames.P}), S ${s.frames.S}, G ${s.frames.G}, E ${s.frames.E} | corrupt ${s.corrupt}, rejected ${s.rejectedMain}, clean end ${s.cleanEnd}`);
        }
        return;
    }
    if (cmd === 'decode') {
        for (const l of pick(logs)) {
            const out = arg('out') ?? file.replace(/\.[^.]+$/, `.${String(l.index).padStart(2, '0')}.gsfpv.csv`);
            writeFileSync(out, toCsv(l));
            console.log(`log ${l.index} -> ${out} (${l.main.length} rows)`);
        }
        return;
    }
    if (cmd === 'compare') {
        if (!second) throw new Error('compare needs the official CSV');
        const l = pick(logs)[0];
        const res = compareWithOfficialCsv(l, readFileSync(second, 'utf8'));
        const gpsFile = arg('gps');
        const gps = gpsFile ? compareGpsWithOfficialCsv(l, readFileSync(gpsFile, 'utf8')) : null;
        console.log(JSON.stringify({ log: l.index, firmware: l.sys.firmware, stats: l.stats, main: res, gps }, null, 1));
        return;
    }
    if (cmd === 'fit') {
        const presetId = arg('preset');
        const preset = presetId ? (JSON.parse(readFileSync(join(PRESETS, `${presetId}.json`), 'utf8')) as PresetJson) : undefined;
        const massG = arg('mass') ? Number(arg('mass')) : undefined;
        const reports = [];
        for (const l of pick(logs)) {
            const sig = extractSignals(l);
            if (sig.n < 1000) {
                console.log(`log ${l.index}: ${sig.n} frames, too short to fit`);
                continue;
            }
            const r = fitLog(sig, { preset, massG });
            reports.push({ index: l.index, report: r });
            console.log(renderReport(r, `${file} log ${l.index}`));
            if (preset) {
                const h = presetHover(preset);
                console.log(`  (the preset hovers today at motor output ${h.motor.toFixed(3)}, throttle stick ${h.throttlePct.toFixed(1)} %)`);
            }
            console.log('');
        }
        const json = arg('json');
        if (json) writeFileSync(json, JSON.stringify(reports, null, 1) + '\n');
        return;
    }
    throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

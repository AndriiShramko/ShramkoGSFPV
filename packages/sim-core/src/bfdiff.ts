// Import rates and PID gains from a Betaflight CLI `diff` / `diff all` dump.
//
// The format and every meaning below were read from Betaflight 4.3.2, 4.4.3, 4.5.1 and
// 2025.12.1 (GPL-3.0): src/main/cli/cli.c (printConfig, printVersion, cliDumpPidProfile,
// backupAndResetConfigs), src/main/cli/settings.c (valueTable, CLI ranges),
// src/main/fc/controlrate_profile.c (defaults, ratesSettingLimits), src/main/config/config.c
// (validateAndFixRatesSettings), src/main/flight/pid.h, pid.c and pid_init.c (PID defaults,
// the D boost), src/main/target/common_pre.h (profile counts) and src/main/build/version.h.
// Nothing was copied; see docs/PROVENANCE.md.
//
// A diff prints only values that differ from the defaults, so the parser starts from the
// defaults and overrides what it finds. A missing `roll_rc_rate` means "default", not
// "unknown". Anything a firmware-printed diff cannot contain (an out-of-range value, a
// profile index that does not exist, two version lines, a setting printed twice) is refused
// with an error instead of being guessed around: a wrong tune imported silently is worse
// than no import.

import type { AxisRates, RatesConfig, RatesType, ThrottleCurve } from './rates';
import { RATE_BOUNDS, SETPOINT_RATE_LIMIT } from './rates';

export type PidTriple = [number, number, number, number]; // [P, I, D(peak), F]

export interface BfVersion {
    major: number;
    minor: number;
    patch: number;
}

export interface BfDiffResult {
    firmware: {
        name: string | null; // "Betaflight"
        version: BfVersion | null;
        suffix: string | null; // 2025.12+ pre-release suffix, e.g. "RC1" from "2025.12.1-RC1"
        target: string | null; // MCU target, e.g. STM32F405
        boardId: string | null; // 4-char id in parentheses, e.g. S405
        mspApi: string | null;
        raw: string | null; // the version line as found
    };
    activePidProfile: number;
    activeRateProfile: number;
    rates: RatesConfig | null;
    /** Our convention: [P, I, D, F] with D = the peak (maximum) D the firmware can reach. */
    pid: { roll: PidTriple; pitch: PidTriple; yaw: PidTriple } | null;
    /** Resting D per axis (d_min in 4.x, d_<axis> in 2025.12+); equals D when there is no boost. */
    dBase: { roll: number; pitch: number; yaw: number } | null;
    throttle: ThrottleCurve | null;
    warnings: string[];
    errors: string[];
}

type Axis = 'roll' | 'pitch' | 'yaw';
const AXES: Axis[] = ['roll', 'pitch', 'yaw'];

// A real `diff all` is 10-30 KB; anything far larger is not one and would only cost time.
const MAX_INPUT_CHARS = 256 * 1024;
// The version line is about 110 chars; the regex never runs on longer '#' lines.
const MAX_VERSION_LINE = 300;

// Indices a selector line may carry at all; the per-version count is checked after the
// version line is known. 2025.12 lets a target raise CONTROL_RATE_PROFILE_COUNT to 6.
const MAX_PROFILE_INDEX = 5;

// lookupTableRatesType (cli/settings.c), identical in 4.3.2, 4.4.3, 4.5.1 and 2025.12.1.
const BF_RATES_TYPES = ['BETAFLIGHT', 'RACEFLIGHT', 'KISS', 'ACTUAL', 'QUICK'];
// The curves rates.ts implements. QUICK exists in firmware but not in our model yet.
const IMPLEMENTED_RATES: RatesType[] = ['BETAFLIGHT', 'RACEFLIGHT', 'KISS', 'ACTUAL'];

// Defaults, identical in 4.3.2, 4.4.3, 4.5.1 and 2025.12.1: controlrate_profile.c (rates),
// pid.h (PID, D_MIN_DEFAULT), pid.c (d_min_gain / d_max_gain 37, advance 20).
const DEFAULT_RATES = { type: 'ACTUAL', rcRate: 7, rate: 67, expo: 0, rateLimit: 1998, thrMid: 50, thrExpo: 0 };
const DEFAULT_PID: Record<Axis, { p: number; i: number; d: number; f: number; dMin: number }> = {
    roll: { p: 45, i: 80, d: 40, f: 120, dMin: 30 },
    pitch: { p: 47, i: 84, d: 46, f: 125, dMin: 34 },
    yaw: { p: 45, i: 80, d: 0, f: 120, dMin: 0 }
};
const DEFAULT_BOOST_GAIN = 37;
const DEFAULT_BOOST_ADVANCE = 20;
// 2025.12.1 (pid.h L64-67): d_<axis> became the base D and d_max_<axis> the peak.
const DEFAULT_D_2025 = { roll: 30, pitch: 34, yaw: 0 };
const DEFAULT_DMAX_2025 = { roll: 40, pitch: 46, yaw: 0 };

// CLI ranges (settings.c), the same in all four versions: PID_GAIN_MAX 250, F_GAIN_MAX 1000,
// d_min 0..D_MIN_GAIN_MAX 250 (4.x), d_max 0..PID_GAIN_MAX 250 (2025.12.1 L1329-1331),
// d_max_gain 0..100, d_max_advance 0..200, rc_rate 1..255, srate 0..255, expo 0..100,
// rate_limit 200..1998, thr_mid / thr_expo 0..100.
const PID_GAIN_MAX = 250;
const F_GAIN_MAX = 1000;
const CLI_RC_RATE = [1, 255];
const CLI_SRATE = [0, 255];
const CLI_EXPO = [0, 100];
const RATE_LIMIT_MIN = 200;

// MASTER settings that change the setpoint but which the simulator does not model (rc.c:
// deadbands, mid_rc centres roll/pitch/yaw before the curve, fpv mix, yaw reversal).
const SETPOINT_MASTER_VARS = ['deadband', 'yaw_deadband', 'mid_rc', 'fpv_mix_degrees', 'yaw_control_reversed'];

/** How to read the D values: until 4.5 d_<axis> is the peak; from 2025.12 it is the base. */
type DScheme = 'd-is-peak' | 'd-is-base';

interface VersionInfo {
    scheme: DScheme;
    pidProfiles: number; // PID_PROFILE_COUNT
    rateProfiles: number; // CONTROL_RATE_PROFILE_COUNT (the largest a target may have)
    customDefaults: boolean; // diff is taken against the board's custom defaults when present
}

// common_pre.h: 4.3 has 3 PID / 6 rate profiles, 4.4 and 4.5 have 4 / 4, 2025.12 has 4 / 4
// "or maybe 6". 4.6.0 was the development label of what became 2025.12 and already used the
// d_max scheme under a 4.x number (d_min -> d_max rename, Sept 2024), so it is refused.
// 4.2 and older have other rate and PID defaults and are refused too.
function versionInfo(major: number, minor: number): VersionInfo | null {
    if (major === 4 && minor === 3) return { scheme: 'd-is-peak', pidProfiles: 3, rateProfiles: 6, customDefaults: true };
    if (major === 4 && (minor === 4 || minor === 5)) return { scheme: 'd-is-peak', pidProfiles: 4, rateProfiles: 4, customDefaults: minor === 4 };
    if (major === 2025 && minor === 12) return { scheme: 'd-is-base', pidProfiles: 4, rateProfiles: 6, customDefaults: false };
    return null;
}

// printVersion: "# <name> / <target> (<board id>) <x.y.z>[-<suffix>] <Mmm dd yyyy> / <hh:mm:ss> (<git>) MSP API: <a.b>".
// The git hash is 9 hex chars in real dumps although version.h says 7, so its length is free.
// The name excludes '/' and the target excludes '(' so the match is linear on long '#' lines.
const VERSION_RE =
    /^#\s*([^\s/]+)\s*\/\s*([^\s(]+)\s*\((\w+)\)\s*(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?(?:\s+(\w{3}\s+\d{1,2}\s+\d{4})\s*\/\s*(\d\d:\d\d:\d\d)\s*\(([0-9a-fA-F]+)\))?(?:\s*MSP API:\s*(\d+\.\d+))?/;

// printConfig prints these before the final selector lines of `diff all` (not with `bare`).
const RESTORE_RE = /^#\s*restore original (profile|rateprofile) selection\s*$/i;
// printVersion (4.3/4.4, USE_CUSTOM_DEFAULTS): the board carries custom defaults.
const CUSTOM_DEFAULTS_RE = /^#\s*config:\s*(YES|manufacturer_id:)/i;

type RawValues = Map<string, string>;
type Kind = 'pid' | 'rate';

function isRateVar(name: string): boolean {
    return (
        name === 'rates_type' ||
        name === 'quickrates_rc_expo' ||
        name === 'thr_mid' ||
        name === 'thr_expo' ||
        name === 'throttle_limit_type' ||
        name === 'throttle_limit_percent' ||
        name === 'rateprofile_name' ||
        /^(roll|pitch|yaw)_(rc_rate|srate|expo|rate_limit)$/.test(name) ||
        /^(roll|pitch)_level_expo$/.test(name)
    );
}

function isPidVar(name: string): boolean {
    return /^[pidf]_(roll|pitch|yaw)$/.test(name) || /^d_(min|max)_(roll|pitch|yaw)$/.test(name) || name === 'd_max_gain' || name === 'd_max_advance';
}

const KIND_WORD: Record<Kind, string> = { pid: 'profile', rate: 'rateprofile' };

interface Selector {
    valid: boolean;
    index: number;
    afterRestore: boolean;
    line: string;
}

export function parseBetaflightDiff(text: string): BfDiffResult {
    const res: BfDiffResult = {
        firmware: { name: null, version: null, suffix: null, target: null, boardId: null, mspApi: null, raw: null },
        activePidProfile: 0,
        activeRateProfile: 0,
        rates: null,
        pid: null,
        dBase: null,
        throttle: null,
        warnings: [],
        errors: []
    };
    const warn = (m: string) => res.warnings.push(m);
    const fail = (m: string) => res.errors.push(m);

    let src = typeof text === 'string' ? text : '';
    if (src.length > MAX_INPUT_CHARS) {
        fail(`The pasted text is ${Math.round(src.length / 1024)} KB; a Betaflight \`diff all\` is 10-30 KB. Paste one diff only.`);
        return res;
    }
    // Chat apps and editors insert zero-width characters and no-break spaces.
    src = src.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\u00A0/g, ' ');

    // Sections: "master" before the first selector, then one per "profile N" / "rateprofile N".
    // A `set` line belongs to the section it is printed in (dumpAllValues prints each section's
    // values after its selector), never to a guessed one.
    const sections = new Map<string, RawValues>();
    const sectionOf = (key: string): RawValues => {
        let s = sections.get(key);
        if (!s) sections.set(key, (s = new Map()));
        return s;
    };
    let cur: string = 'master'; // 'master' | 'pid:N' | 'rate:N' | 'discard'
    const selectors: Record<Kind, Selector[]> = { pid: [], rate: [] };
    const pendingRestore: Record<Kind, boolean> = { pid: false, rate: false };
    let customDefaultsMarker = false;
    let versionLines = 0;

    // CRLF everywhere in firmware output; tolerate LF and bare CR.
    const lines = src.split(/\r\n|\r|\n/);
    for (const rawLine of lines) {
        // "> " quote markers from chat pastes.
        const line = rawLine.trim().replace(/^(?:>\s?)+/, '').trim();
        if (line === '') continue;

        if (line.startsWith('#')) {
            const restore = RESTORE_RE.exec(line);
            if (restore) {
                pendingRestore[restore[1].toLowerCase() === 'profile' ? 'pid' : 'rate'] = true;
                continue;
            }
            if (CUSTOM_DEFAULTS_RE.test(line)) customDefaultsMarker = true;
            const m = line.length <= MAX_VERSION_LINE ? VERSION_RE.exec(line) : null;
            if (!m) continue; // headings, "#set x = default" comments, "# config: YES", ...
            versionLines++;
            if (res.firmware.raw !== null) {
                if (line !== res.firmware.raw) fail('Two different version lines found: paste one diff at a time.');
                else fail('The version line appears twice: the same diff was pasted more than once. Paste it once.');
                continue;
            }
            res.firmware = {
                name: m[1],
                version: { major: Number(m[4]), minor: Number(m[5]), patch: Number(m[6]) },
                suffix: m[7] ?? null,
                target: m[2],
                boardId: m[3],
                mspApi: m[11] ?? null,
                raw: line
            };
            continue;
        }

        // Bare commands "profile N" / "rateprofile N" select the section. In `diff` each is
        // printed once; in `diff all` every index is printed and then, after a
        // "# restore original ... selection" line, the active one again (printConfig).
        const sel = /^(profile|rateprofile)\s+(\S+)$/i.exec(line);
        if (sel) {
            const kind: Kind = sel[1].toLowerCase() === 'profile' ? 'pid' : 'rate';
            const n = /^\d+$/.test(sel[2]) ? Number(sel[2]) : NaN;
            const valid = Number.isInteger(n) && n <= MAX_PROFILE_INDEX;
            selectors[kind].push({ valid, index: valid ? n : -1, afterRestore: pendingRestore[kind], line });
            pendingRestore[kind] = false;
            if (valid) {
                cur = `${kind}:${n}`;
            } else {
                cur = 'discard';
                warn(`Ignored "${line}": not a valid ${KIND_WORD[kind]} index; the settings after it were dropped.`);
            }
            continue;
        }

        // "set name = value" is how dumpPgValue prints; the CLI also accepts "set name=value".
        const set = /^set\s+([A-Za-z0-9_]+)\s*=\s*(.*)$/i.exec(line);
        if (set) {
            if (cur === 'discard') continue;
            const name = set[1].toLowerCase();
            const value = set[2].trim();
            const where = cur === 'master' ? 'the master section' : `"${cur.replace('pid:', 'profile ').replace('rate:', 'rateprofile ')}"`;
            if (isRateVar(name) && !cur.startsWith('rate:')) {
                fail(`"set ${name}" is a rateprofile setting but appears in ${where}; the firmware never prints it there. Paste the diff unedited.`);
                continue;
            }
            if (isPidVar(name) && !cur.startsWith('pid:')) {
                fail(`"set ${name}" is a profile setting but appears in ${where}; the firmware never prints it there. Paste the diff unedited.`);
                continue;
            }
            const sec = sectionOf(cur);
            if (sec.has(name)) {
                fail(`"set ${name}" appears twice in ${where}; a firmware diff prints each setting once. Paste one unedited diff.`);
                continue;
            }
            sec.set(name, value);
        }
        // Everything else (batch, defaults, board_name, feature, serial, aux, save, ...) is not
        // about flight feel and is skipped.
    }

    // ---- identity and version gate --------------------------------------------------------
    const fw = res.firmware;
    if (fw.raw === null || fw.version === null) {
        fail('Not a Betaflight diff: no "# Betaflight / <target> (<board>) x.y.z ..." version line found. Run `diff all` in the Betaflight CLI and paste the whole output.');
        return res;
    }
    if (versionLines > 1) return res; // error already recorded
    if (fw.name !== 'Betaflight') {
        fail(`Firmware "${fw.name}" is not supported: only Betaflight diffs can be imported.`);
        return res;
    }
    const { major, minor } = fw.version;
    const vi = versionInfo(major, minor);
    if (vi === null) {
        fail(`Betaflight ${major}.${minor} is not supported: the import knows 4.3, 4.4, 4.5 and 2025.12 (4.2 and older have other defaults; 4.6 builds already use the 2025.12 D meanings).`);
        return res;
    }
    const scheme = vi.scheme;
    if (vi.customDefaults && customDefaultsMarker) {
        // 4.3/4.4 diff against the board's custom defaults when it has them (cli.c
        // backupAndResetConfigs); 4.5+ always against the compiled defaults.
        warn(`${major}.${minor} diff: an omitted value means the board's custom default (the diff says "# config: YES"); it is assumed equal to the firmware default.`);
    }

    // ---- which profile and rate profile are active -----------------------------------------
    const counts: Record<Kind, number> = { pid: vi.pidProfiles, rate: vi.rateProfiles };
    const active: Record<Kind, number> = { pid: -1, rate: -1 };
    for (const kind of ['pid', 'rate'] as Kind[]) {
        const word = KIND_WORD[kind];
        const list = selectors[kind];
        const last = list[list.length - 1];
        if (!last) {
            fail(`No "${word} N" line found, so the active ${word} is unknown. Run \`diff all\` and paste the whole output, including the end.`);
            continue;
        }
        if (!last.valid) {
            fail(`The last ${word} line, "${last.line}", is not a valid index, so the active ${word} is unknown.`);
            continue;
        }
        if (list.length > 1 && !last.afterRestore) {
            fail(`This \`diff all\` has no "# restore original ${word} selection" line (made with \`bare\`, or cut off), so the active ${word} is unknown. Run \`diff all\` without \`bare\` and paste the whole output.`);
            continue;
        }
        if (last.index >= counts[kind]) {
            fail(`The active ${word} is ${last.index}, but Betaflight ${major}.${minor} has ${word}s 0..${counts[kind] - 1}.`);
            continue;
        }
        active[kind] = last.index;
        const extra = [...new Set(list.filter((s) => s.valid && s.index >= counts[kind]).map((s) => s.index))];
        for (const i of extra) warn(`${word} ${i} does not exist in Betaflight ${major}.${minor}; its settings were ignored.`);
    }

    // A version line contradicting the D settings means the header and body do not belong
    // together: 4.x never prints d_max_<axis>, 2025.12 never prints d_min_<axis>.
    for (const [key, sec] of sections) {
        if (!key.startsWith('pid:')) continue;
        for (const name of sec.keys()) {
            if (scheme === 'd-is-peak' && /^d_max_(roll|pitch|yaw)$/.test(name)) {
                fail(`${name} does not exist in Betaflight ${major}.${minor} (it appears in 2025.12); the version line and the settings do not match.`);
            } else if (scheme === 'd-is-base' && /^d_min_(roll|pitch|yaw)$/.test(name)) {
                fail(`${name} is from 4.x and does not exist in 2025.12; the version line and the settings do not match.`);
            }
        }
    }
    if (res.errors.length > 0) return res;
    res.activePidProfile = active.pid;
    res.activeRateProfile = active.rate;

    const rp = sections.get(`rate:${active.rate}`) ?? new Map<string, string>();
    const pp = sections.get(`pid:${active.pid}`) ?? new Map<string, string>();
    const ignored = new Set<string>();

    // ---- rates of the active rate profile ---------------------------------------------------
    const typeRaw = (rp.get('rates_type') ?? DEFAULT_RATES.type).toUpperCase();
    if (!BF_RATES_TYPES.includes(typeRaw)) {
        fail(`rates_type = ${typeRaw} is not a Betaflight rates type.`);
    } else if (!(IMPLEMENTED_RATES as string[]).includes(typeRaw)) {
        fail(`rates_type = ${typeRaw} is not implemented in the simulator yet; switch the rate profile to ACTUAL, BETAFLIGHT, KISS or RACEFLIGHT.`);
    }
    if (res.errors.length > 0) return res;
    const type = typeRaw as RatesType;
    const bounds = RATE_BOUNDS[type];

    // Read one integer within the CLI range. A firmware-printed diff cannot hold anything else,
    // so a non-integer or out-of-range value is an error, not a silent default.
    const readInt = (vals: RawValues, name: string, def: number, lo: number, hi: number): number => {
        const v = vals.get(name);
        if (v === undefined) return def;
        if (!/^-?\d+$/.test(v)) {
            fail(`${name} = ${v} is not a whole number; the firmware prints integers. Paste the diff unedited.`);
            return def;
        }
        const n = Number(v);
        if (n < lo || n > hi) {
            fail(`${name} = ${v} is outside the Betaflight range ${lo}..${hi}, so the firmware cannot have printed it. Paste the diff unedited.`);
            return def;
        }
        return n;
    };
    // validateAndFixRatesSettings (config.c) constrains rc_rate / srate / expo to the limits of
    // the rates type (ratesSettingLimits) when the config loads; the import does the same.
    const readRate = (name: string, def: number, cli: number[], limit: number): number => {
        const n = readInt(rp, name, def, cli[0], cli[1]);
        if (n > limit) {
            warn(`${name} = ${n} is above the ${type} limit ${limit}; the firmware clamps it to ${limit}, and so does the import.`);
            return limit;
        }
        return n;
    };

    const axisRates = (ax: Axis): AxisRates => ({
        rcRate: readRate(`${ax}_rc_rate`, DEFAULT_RATES.rcRate, CLI_RC_RATE, bounds.rcRate),
        rate: readRate(`${ax}_srate`, DEFAULT_RATES.rate, CLI_SRATE, bounds.rate),
        expo: readRate(`${ax}_expo`, DEFAULT_RATES.expo, CLI_EXPO, bounds.expo)
    });
    const rates = { type, roll: axisRates('roll'), pitch: axisRates('pitch'), yaw: axisRates('yaw') };
    const limits = AXES.map((ax) => readInt(rp, `${ax}_rate_limit`, DEFAULT_RATES.rateLimit, RATE_LIMIT_MIN, SETPOINT_RATE_LIMIT));
    const rateLimit = Math.min(...limits);
    if (limits.some((l) => l !== rateLimit)) {
        warn(`Per-axis rate limits ${limits.join('/')} differ; the simulator has one limit and uses the lowest, ${rateLimit} deg/s.`);
    }
    const throttle = {
        mid: readInt(rp, 'thr_mid', DEFAULT_RATES.thrMid, 0, 100),
        expo: readInt(rp, 'thr_expo', DEFAULT_RATES.thrExpo, 0, 100)
    };
    for (const name of ['throttle_limit_type', 'throttle_limit_percent']) {
        if (rp.has(name)) warn(`${name} = ${rp.get(name)} is not applied by the simulator.`);
    }
    for (const ax of ['roll', 'pitch']) {
        const name = `${ax}_level_expo`;
        // levelExpo left the rate profile in 4.5 (controlRateConfig_t PG version 5 -> 6).
        if (rp.has(name) && !(major === 4 && minor <= 4)) warn(`${name} does not exist after 4.4; ignored.`);
        else if (rp.has(name)) ignored.add(name);
    }

    // ---- PID of the active profile --------------------------------------------------------
    const pid = {} as { roll: PidTriple; pitch: PidTriple; yaw: PidTriple };
    const dBase = {} as { roll: number; pitch: number; yaw: number };
    // The boost is driven by gyro activity (gain) and by setpoint change (gain * advance in
    // 4.x, advance alone in 2025.12): pid_init.c 4.5.1 L406-407, 2025.12.1 L540-541.
    const gain = readInt(pp, 'd_max_gain', DEFAULT_BOOST_GAIN, 0, 100);
    const advance = readInt(pp, 'd_max_advance', DEFAULT_BOOST_ADVANCE, 0, 200);
    const boostOff = scheme === 'd-is-peak' ? gain === 0 : gain === 0 && advance === 0;
    for (const ax of AXES) {
        const def = DEFAULT_PID[ax];
        const p = readInt(pp, `p_${ax}`, def.p, 0, PID_GAIN_MAX);
        const i = readInt(pp, `i_${ax}`, def.i, 0, PID_GAIN_MAX);
        const f = readInt(pp, `f_${ax}`, def.f, 0, F_GAIN_MAX);
        let peak: number;
        let base: number;
        if (scheme === 'd-is-peak') {
            // 4.3-4.5: d_<axis> is the peak D; d_min_<axis> the resting D, active only when
            // 0 < d_min < D (pid_init.c), otherwise D is constant.
            peak = readInt(pp, `d_${ax}`, def.d, 0, PID_GAIN_MAX);
            const dMin = readInt(pp, `d_min_${ax}`, def.dMin, 0, PID_GAIN_MAX);
            base = dMin > 0 && dMin < peak ? dMin : peak;
        } else {
            // 2025.12: d_<axis> is the resting D; d_max_<axis> the peak, active only when D > 0
            // and d_max is above D (pid_init.c L529-537), otherwise D is constant.
            base = readInt(pp, `d_${ax}`, DEFAULT_D_2025[ax], 0, PID_GAIN_MAX);
            const dMax = readInt(pp, `d_max_${ax}`, DEFAULT_DMAX_2025[ax], 0, PID_GAIN_MAX);
            peak = base > 0 && dMax > base ? dMax : base;
        }
        // With no boost input (pid.c: factor = dMinPercent + (1 - dMinPercent) * 0) D rests at
        // the base for good, so the base is also the peak.
        if (boostOff) peak = base;
        pid[ax] = [p, i, peak, f];
        dBase[ax] = base;
    }

    // ---- the rest ---------------------------------------------------------------------------
    const master = sections.get('master') ?? new Map<string, string>();
    for (const name of SETPOINT_MASTER_VARS) {
        if (master.has(name)) warn(`${name} = ${master.get(name)} changes the stick feel in Betaflight but is not applied by the simulator.`);
    }
    for (const name of master.keys()) if (!SETPOINT_MASTER_VARS.includes(name)) ignored.add(name);
    for (const name of rp.keys()) if (name === 'rateprofile_name' || name === 'quickrates_rc_expo') ignored.add(name);
    for (const name of pp.keys()) if (!isPidVar(name)) ignored.add(name);
    if (ignored.size > 0) {
        const some = [...ignored].slice(0, 5).join(', ');
        warn(`${ignored.size} setting(s) not used by the simulator were ignored (${some}${ignored.size > 5 ? ', ...' : ''}).`);
    }
    if (res.errors.length > 0) return res;
    res.rates = { ...rates, rateLimit };
    res.throttle = throttle;
    res.pid = pid;
    res.dBase = dBase;
    return res;
}

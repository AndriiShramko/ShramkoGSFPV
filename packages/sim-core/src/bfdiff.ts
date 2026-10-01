// Import rates, PID gains, feed-forward, the throttle curve and motor idle from a Betaflight
// CLI `diff` / `diff all` dump.
//
// The format and every meaning below were read from Betaflight 4.3.2, 4.4.3, 4.5.0, 4.5.1,
// 4.5.3, 2025.12.1, 2025.12.5 and 2026.6.1 (GPL-3.0): src/main/cli/cli.c (printConfig,
// printVersion, cliDumpPidProfile, the battery-profile dump of 2026.6, backupAndResetConfigs),
// src/main/cli/settings.c (valueTable, CLI ranges), src/main/fc/parameter_names.h,
// src/main/fc/controlrate_profile.c (defaults, ratesSettingLimits), src/main/config/config.c
// (validateAndFixRatesSettings), src/main/flight/pid.h, pid.c and pid_init.c (PID defaults,
// the D boost), src/main/pg/motor.c and src/main/flight/mixer_init.c (idle, dynamic idle),
// src/main/target/common_pre.h (profile counts) and src/main/build/version.h.
// Nothing was copied; see docs/PROVENANCE.md.
//
// A diff prints only values that differ from the defaults, so the parser starts from the
// defaults and overrides what it finds. A missing `roll_rc_rate` means "default", not
// "unknown". Anything a firmware-printed diff cannot contain (an out-of-range value, a
// profile index that does not exist, two version lines, a setting printed twice) is refused
// with an error instead of being guessed around: a wrong tune imported silently is worse
// than no import. Settings the simulator does not use are listed in `ignored`, never dropped
// silently.

import type { AxisRates, RatesConfig, RatesType, ThrottleCurve } from './rates';
import { RATE_BOUNDS, SETPOINT_RATE_LIMIT } from './rates';

export type PidTriple = [number, number, number, number]; // [P, I, D(peak), F]

export interface BfVersion {
    major: number;
    minor: number;
    patch: number;
}

/** A `set` line the import read but does not apply, with the section it was printed in. */
export interface BfIgnored {
    section: string; // "master", "profile 0", "rateprofile 0", "battery_profile 0"
    name: string;
    value: string;
}

export interface BfIdle {
    /** Static idle as a fraction of full motor output (dshot_idle_value / motor_idle divided by 10000). */
    fraction: number;
    /** The CLI setting it came from: 4.3-4.5 `dshot_idle_value`, 2025.12+ `motor_idle`. */
    setting: 'dshot_idle_value' | 'motor_idle';
    /** The CLI integer (percent x 100). */
    value: number;
    /** true: the diff does not print it, so it is the firmware default. */
    fromDefault: boolean;
    /** Dynamic idle target in rpm (`dyn_idle_min_rpm` x 100) of the active profile; 0 = off. */
    dynamicMinRpm: number;
}

export interface BfDiffResult {
    firmware: {
        name: string | null; // "Betaflight"
        version: BfVersion | null;
        suffix: string | null; // 2025.12+ pre-release suffix, e.g. "RC1" from "2025.12.1-RC1"
        target: string | null; // MCU target, e.g. STM32F405
        boardId: string | null; // 4-char id in parentheses, e.g. S405
        mspApi: string | null;
        gitHash: string | null; // build hash in parentheses after the time
        /** The Betaflight release whose meanings the import used, e.g. "4.5", "2025.12", "2026.6". */
        semantics: string | null;
        /** Release whose tag commit equals the build hash, when known (e.g. "2025.12.5"). */
        releaseOfHash: string | null;
        raw: string | null; // the version line as found
    };
    activePidProfile: number;
    activeRateProfile: number;
    rates: RatesConfig | null;
    /** Our convention: [P, I, D, F] with D = the peak (maximum) D the firmware can reach; F = feed-forward. */
    pid: { roll: PidTriple; pitch: PidTriple; yaw: PidTriple } | null;
    /** Resting D per axis (d_min in 4.x, d_<axis> in 2025.12+); equals D when there is no boost. */
    dBase: { roll: number; pitch: number; yaw: number } | null;
    throttle: ThrottleCurve | null;
    /** Motor idle; null when the motor protocol makes the static idle meaningless (analog protocols in 4.x). */
    idle: BfIdle | null;
    /** Every `set` of the master section and of the active profiles that the simulator does not use. */
    ignored: BfIgnored[];
    /** Non-`set` commands that were skipped, with how often each appeared (feature, serial, aux, ...). */
    ignoredCommands: Record<string, number>;
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

// lookupTableRatesType (cli/settings.c), identical in 4.3.2, 4.4.3, 4.5.1, 2025.12.1 and 2026.6.1.
const BF_RATES_TYPES = ['BETAFLIGHT', 'RACEFLIGHT', 'KISS', 'ACTUAL', 'QUICK'];
// The curves rates.ts implements. QUICK exists in firmware but not in our model yet.
const IMPLEMENTED_RATES: RatesType[] = ['BETAFLIGHT', 'RACEFLIGHT', 'KISS', 'ACTUAL'];

// Defaults, identical in 4.3.2, 4.4.3, 4.5.1, 2025.12.1 and 2026.6.1: controlrate_profile.c
// (rates), pid.h (PID, D_MIN_DEFAULT / D_MAX_DEFAULT).
const DEFAULT_RATES = { type: 'ACTUAL', rcRate: 7, rate: 67, expo: 0, rateLimit: 1998, thrMid: 50, thrExpo: 0 };
const DEFAULT_PID: Record<Axis, { p: number; i: number; d: number; f: number; dMin: number }> = {
    roll: { p: 45, i: 80, d: 40, f: 120, dMin: 30 },
    pitch: { p: 47, i: 84, d: 46, f: 125, dMin: 34 },
    yaw: { p: 45, i: 80, d: 0, f: 120, dMin: 0 }
};
// 2025.12.1 (pid.h L64-67): d_<axis> became the base D and d_max_<axis> the peak.
const DEFAULT_D_2025 = { roll: 30, pitch: 34, yaw: 0 };
const DEFAULT_DMAX_2025 = { roll: 40, pitch: 46, yaw: 0 };

// Motor idle (pg/motor.c): 550 = 5.5 % in every supported version; 2025.12+ uses 700 when the
// protocol is BRUSHED. The CLI range is 0..2000 for both names.
const DEFAULT_IDLE = 550;
const DEFAULT_IDLE_BRUSHED = 700;
const IDLE_MAX = 2000;
// lookupTableMotorPwmProtocol: the analog ones. A static idle offset applies only to the digital
// protocols in 4.x (the DShot idle value); 2025.12 applies motor_idle to every protocol.
const ANALOG_PROTOCOLS = ['PWM', 'ONESHOT125', 'ONESHOT42', 'MULTISHOT', 'BRUSHED'];
const ALL_PROTOCOLS = [...ANALOG_PROTOCOLS, 'DSHOT150', 'DSHOT300', 'DSHOT600', 'PROSHOT1000', 'DISABLED'];

// CLI ranges (settings.c), the same in all supported versions: PID_GAIN_MAX 250, F_GAIN_MAX 1000,
// d_min 0..D_MIN_GAIN_MAX 250 (4.x), d_max 0..PID_GAIN_MAX 250 (2025.12+), d_max_gain 0..100,
// d_max_advance 0..200, rc_rate 1..255, srate 0..255, expo 0..100, rate_limit 200..1998,
// thr_mid / thr_expo 0..100, dyn_idle_min_rpm 0..200.
const PID_GAIN_MAX = 250;
const F_GAIN_MAX = 1000;
const CLI_RC_RATE = [1, 255];
const CLI_SRATE = [0, 255];
const CLI_EXPO = [0, 100];
const RATE_LIMIT_MIN = 200;
const DYN_IDLE_MAX = 200;

// MASTER settings that change the setpoint but which the simulator does not model (rc.c:
// deadbands, mid_rc centres roll/pitch/yaw before the curve, fpv mix, yaw reversal).
const SETPOINT_MASTER_VARS = ['deadband', 'yaw_deadband', 'mid_rc', 'fpv_mix_degrees', 'yaw_control_reversed'];

// Profile settings that change how the quad flies in Betaflight but have no counterpart in the
// simulator yet. They are named in one warning so a pilot sees what the import could not carry.
const FEEL_PROFILE_VARS = [
    'tpa_mode', 'tpa_rate', 'tpa_breakpoint', 'tpa_low_rate', 'tpa_low_breakpoint', 'tpa_low_always',
    'anti_gravity_gain', 'anti_gravity_cutoff_hz', 'anti_gravity_p_gain',
    'feedforward_boost', 'feedforward_smooth_factor', 'feedforward_averaging', 'feedforward_jitter_factor', 'feedforward_transition', 'feedforward_max_rate_limit',
    'iterm_relax', 'iterm_relax_type', 'iterm_relax_cutoff', 'iterm_windup', 'iterm_limit',
    'throttle_boost', 'throttle_boost_cutoff', 'thrust_linear',
    'dterm_lpf1_dyn_min_hz', 'dterm_lpf1_dyn_max_hz', 'dterm_lpf1_static_hz', 'dterm_lpf2_static_hz', 'dterm_lpf1_type', 'dterm_lpf2_type',
    'motor_output_limit', 'pidsum_limit', 'pidsum_limit_yaw'
];

/** How to read the D values: until 4.5 d_<axis> is the peak; from 2025.12 it is the base. */
type DScheme = 'd-is-peak' | 'd-is-base';

interface VersionInfo {
    label: string; // "4.5", "2025.12", ...
    scheme: DScheme;
    pidProfiles: number; // PID_PROFILE_COUNT
    rateProfiles: number; // CONTROL_RATE_PROFILE_COUNT (the largest a target may have)
    batteryProfiles: number; // BATTERY_PROFILE_COUNT (2026.6+), 0 before
    customDefaults: boolean; // diff is taken against the board's custom defaults when present
    idleSetting: 'dshot_idle_value' | 'motor_idle';
    boostGain: number; // d_max_gain default
    boostAdvance: number; // d_max_advance default
    mspApi: string; // the MSP API version this release reports
}

// common_pre.h: 4.3 has 3 PID / 6 rate profiles, 4.4 and 4.5 have 4 / 4, 2025.12 and 2026.6 have
// 4 / 4 "or maybe 6". 4.6.0 was the development label of what became 2025.12 and already used
// the d_max scheme under a 4.x number (d_min -> d_max rename, Sept 2024), so it is refused.
// 4.2 and older have other rate and PID defaults and are refused too.
// 2026.6 moved the battery settings into "battery_profile N" sections (BATTERY_PROFILE_COUNT 3)
// printed after the rate profiles; the simulator uses none of them.
// 2026.6 (checked against the 2026.6.1 source): PID and rate defaults, CLI ranges, rate curves
// and the D scheme are those of 2025.12; the D-boost defaults changed (d_max_gain 37 -> 0,
// d_max_advance 20 -> 35) and battery profiles were added.
function versionInfo(major: number, minor: number): VersionInfo | null {
    const x4 = { scheme: 'd-is-peak' as DScheme, batteryProfiles: 0, idleSetting: 'dshot_idle_value' as const, boostGain: 37, boostAdvance: 20 };
    if (major === 4 && minor === 3) return { ...x4, label: '4.3', pidProfiles: 3, rateProfiles: 6, customDefaults: true, mspApi: '1.44' };
    if (major === 4 && minor === 4) return { ...x4, label: '4.4', pidProfiles: 4, rateProfiles: 4, customDefaults: true, mspApi: '1.45' };
    if (major === 4 && minor === 5) return { ...x4, label: '4.5', pidProfiles: 4, rateProfiles: 4, customDefaults: false, mspApi: '1.46' };
    const y = { scheme: 'd-is-base' as DScheme, pidProfiles: 4, rateProfiles: 6, customDefaults: false, idleSetting: 'motor_idle' as const };
    if (major === 2025 && minor === 12) return { ...y, label: '2025.12', batteryProfiles: 0, boostGain: 37, boostAdvance: 20, mspApi: '1.47' };
    // Any 2026.x is read as 2026.6 (the only 2026 release line today) with a warning.
    if (major === 2026) return { ...y, label: '2026.6', batteryProfiles: 3, boostGain: 0, boostAdvance: 35, mspApi: '1.48' };
    return null;
}

// Tag commits of the Betaflight releases (git ls-remote of github.com/betaflight/betaflight,
// 2026-09-28). The version line carries the first 9 hex digits of the build commit.
const RELEASE_COMMITS: Record<string, string> = {
    '229ac6675': '4.3.0', '8d4f00532': '4.3.1', '60c9521da': '4.3.2',
    '4605309d8': '4.4.0', 'e43d591b2': '4.4.1', '23d066d08': '4.4.2', '738127e7e': '4.4.3',
    'c155f5830': '4.5.0', '77d01ba3b': '4.5.1', '024f8e13d': '4.5.2', '0e533ba76': '4.5.3', '25356b59a': '4.5.4', '4adbd3ef7': '4.5.5',
    '85d201376': '2025.12.1', '79065c96b': '2025.12.2', 'db7df6e48': '2025.12.3', 'c2af58a0c': '2025.12.4', '7348054f2': '2025.12.5',
    '6dbc4218f': '2026.6.1', 'e0b7bb01b': '2026.6.2'
};

// printVersion: "# <name> / <target> (<board id>) <x.y.z>[-<suffix>] <Mmm dd yyyy> / <hh:mm:ss> (<git>) MSP API: <a.b>".
// The git hash is 9 hex chars in real dumps although version.h says 7, so its length is free.
// The name excludes '/' and the target excludes '(' so the match is linear on long '#' lines.
const VERSION_RE =
    /^#\s*([^\s/]+)\s*\/\s*([^\s(]+)\s*\((\w+)\)\s*(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?(?:\s+(\w{3}\s+\d{1,2}\s+\d{4})\s*\/\s*(\d\d:\d\d:\d\d)\s*\(([0-9a-fA-F]+)\))?(?:\s*MSP API:\s*(\d+\.\d+))?/;

// printConfig prints these before the final selector lines of `diff all` (not with `bare`).
const RESTORE_RE = /^#\s*restore original (profile|rateprofile|battery_profile) selection\s*$/i;
// printVersion (4.3/4.4, USE_CUSTOM_DEFAULTS): the board carries custom defaults.
const CUSTOM_DEFAULTS_RE = /^#\s*config:\s*(YES|manufacturer_id:)/i;

type RawValues = Map<string, string>;
type Kind = 'pid' | 'rate' | 'battery';

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

const KIND_WORD: Record<Kind, string> = { pid: 'profile', rate: 'rateprofile', battery: 'battery_profile' };
const SECTION_NAME = (key: string): string =>
    key === 'master' ? 'master' : key.replace('pid:', 'profile ').replace('rate:', 'rateprofile ').replace('battery:', 'battery_profile ');

interface Selector {
    valid: boolean;
    index: number;
    afterRestore: boolean;
    line: string;
}

/**
 * Motor idle as a fraction of full output that keeps a motor at `minRpm`, for a flight model whose
 * motor speed is `output * omegaMaxPerVolt * volts` (params.ts). Betaflight's dynamic idle
 * (`dyn_idle_min_rpm`) holds an rpm, not an output, so the equivalent fraction depends on the drone.
 */
export function idleForMinRpm(minRpm: number, omegaMaxPerVolt: number, volts: number): number {
    const omega = (minRpm * 2 * Math.PI) / 60;
    const full = omegaMaxPerVolt * volts;
    if (!(full > 0) || !(minRpm > 0)) return 0;
    const f = omega / full;
    return f > 1 ? 1 : f;
}

export function parseBetaflightDiff(text: string): BfDiffResult {
    const res: BfDiffResult = {
        firmware: { name: null, version: null, suffix: null, target: null, boardId: null, mspApi: null, gitHash: null, semantics: null, releaseOfHash: null, raw: null },
        activePidProfile: 0,
        activeRateProfile: 0,
        rates: null,
        pid: null,
        dBase: null,
        throttle: null,
        idle: null,
        ignored: [],
        ignoredCommands: {},
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

    // Sections: "master" before the first selector, then one per "profile N" / "rateprofile N" /
    // "battery_profile N". A `set` line belongs to the section it is printed in (dumpAllValues
    // prints each section's values after its selector), never to a guessed one.
    const sections = new Map<string, RawValues>();
    const sectionOf = (key: string): RawValues => {
        let s = sections.get(key);
        if (!s) sections.set(key, (s = new Map()));
        return s;
    };
    let cur: string = 'master'; // 'master' | 'pid:N' | 'rate:N' | 'battery:N' | 'discard'
    const selectors: Record<Kind, Selector[]> = { pid: [], rate: [], battery: [] };
    const pendingRestore: Record<Kind, boolean> = { pid: false, rate: false, battery: false };
    let customDefaultsMarker = false;
    let versionLines = 0;
    const commands = new Map<string, number>();

    // CRLF everywhere in firmware output; tolerate LF and bare CR.
    const lines = src.split(/\r\n|\r|\n/);
    for (const rawLine of lines) {
        // "> " quote markers from chat pastes.
        const line = rawLine.trim().replace(/^(?:>\s?)+/, '').trim();
        if (line === '') continue;

        if (line.startsWith('#')) {
            const restore = RESTORE_RE.exec(line);
            if (restore) {
                const w = restore[1].toLowerCase();
                pendingRestore[w === 'profile' ? 'pid' : w === 'rateprofile' ? 'rate' : 'battery'] = true;
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
                gitHash: m[10] ? m[10].toLowerCase() : null,
                semantics: null,
                releaseOfHash: null,
                raw: line
            };
            continue;
        }

        // Bare commands "profile N" / "rateprofile N" / "battery_profile N" select the section. In
        // `diff` each is printed once; in `diff all` every index is printed and then, after a
        // "# restore original ... selection" line, the active one again (printConfig).
        const sel = /^(profile|rateprofile|battery_profile)\s+(\S+)$/i.exec(line);
        if (sel) {
            const w = sel[1].toLowerCase();
            const kind: Kind = w === 'profile' ? 'pid' : w === 'rateprofile' ? 'rate' : 'battery';
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
            const where = cur === 'master' ? 'the master section' : `"${SECTION_NAME(cur)}"`;
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
            continue;
        }
        // Everything else (batch, defaults, board_name, feature, serial, aux, save, ...) is not
        // about flight feel and is skipped, but counted so the caller can show what was skipped.
        const word = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
        if (word) {
            const c = word[1].toLowerCase();
            commands.set(c, (commands.get(c) ?? 0) + 1);
        }
    }
    for (const [c, n] of commands) res.ignoredCommands[c] = n;

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
    const { major, minor, patch } = fw.version;
    const vi = versionInfo(major, minor);
    if (vi === null) {
        fail(`Betaflight ${major}.${minor} is not supported: the import knows 4.3, 4.4, 4.5, 2025.12 and 2026.x (4.2 and older have other defaults; 4.6 builds already use the 2025.12 D meanings).`);
        return res;
    }
    fw.semantics = vi.label;
    const scheme = vi.scheme;
    if (vi.customDefaults && customDefaultsMarker) {
        // 4.3/4.4 diff against the board's custom defaults when it has them (cli.c
        // backupAndResetConfigs); 4.5+ always against the compiled defaults.
        warn(`${major}.${minor} diff: an omitted value means the board's custom default (the diff says "# config: YES"); it is assumed equal to the firmware default.`);
    }
    // The build hash and the MSP API version say which code actually printed the diff.
    const printed = `${major}.${minor}.${patch}`;
    const hashRelease = fw.gitHash ? RELEASE_COMMITS[fw.gitHash.slice(0, 9)] ?? null : null;
    let hashNote: { parts: string[]; alt: VersionInfo | null; release: string | null } | null = null;
    fw.releaseOfHash = hashRelease;
    if (major === 2026) {
        const parts = [
            minor === 6
                ? `Betaflight ${printed} is read with 2026.6 meanings, checked against the 2026.6.1 source: rates, PID defaults and the D scheme are those of 2025.12; only the D-boost defaults (d_max_gain 0, d_max_advance 35) and the battery profiles are new.`
                : `Betaflight ${printed} is newer than any release the import was checked against; it is read with 2026.6 meanings (rates, PID defaults and the D scheme of 2025.12). Check the imported values.`
        ];
        const [hMajor, hMinor] = (hashRelease ?? '').split('.').map(Number);
        const alt = hashRelease && hashRelease !== printed ? versionInfo(hMajor, hMinor) : null;
        if (hashRelease && hashRelease !== printed) {
            parts.push(
                `This dump's build hash ${fw.gitHash} is the commit of Betaflight ${hashRelease}${fw.mspApi ? ` and its MSP API ${fw.mspApi} is ${fw.mspApi === vi.mspApi ? `the one ${vi.label} reports` : `not the ${vi.mspApi} that ${vi.label} reports`}` : ''}: it looks like a ${hashRelease} build labelled ${printed}.`
            );
        }
        // The last sentence needs the profile values; it is added once the PIDs are read.
        hashNote = { parts, alt, release: hashRelease };
    } else if (hashRelease && hashRelease !== printed && !(fw.suffix && hashRelease.startsWith(`${major}.${minor}.`))) {
        warn(`The version line says ${printed}, but its build hash ${fw.gitHash} is the commit of Betaflight ${hashRelease}. The import follows the version line (${vi.label}).`);
    }

    // ---- which profiles are active ------------------------------------------------------------
    const counts: Record<Kind, number> = { pid: vi.pidProfiles, rate: vi.rateProfiles, battery: vi.batteryProfiles };
    const active: Record<Kind, number> = { pid: -1, rate: -1, battery: -1 };
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
    // Battery profiles hold nothing the simulator uses, so they never refuse an import.
    if (selectors.battery.length > 0 && vi.batteryProfiles === 0) {
        warn(`"battery_profile" sections exist only from Betaflight 2026.6, but the version line says ${printed}; their settings were ignored.`);
    }
    const lastBattery = selectors.battery[selectors.battery.length - 1];
    if (lastBattery?.valid) active.battery = lastBattery.index;

    // A version line contradicting the D or idle settings means the header and body do not
    // belong together: 4.x never prints d_max_<axis> or motor_idle, 2025.12+ never prints
    // d_min_<axis> or dshot_idle_value.
    for (const [key, sec] of sections) {
        for (const name of sec.keys()) {
            if (key.startsWith('pid:')) {
                if (scheme === 'd-is-peak' && /^d_max_(roll|pitch|yaw)$/.test(name)) {
                    fail(`${name} does not exist in Betaflight ${major}.${minor} (it appears in 2025.12); the version line and the settings do not match.`);
                } else if (scheme === 'd-is-base' && /^d_min_(roll|pitch|yaw)$/.test(name)) {
                    fail(`${name} is from 4.x and does not exist in 2025.12; the version line and the settings do not match.`);
                }
            } else if (key === 'master') {
                if (vi.idleSetting === 'dshot_idle_value' && name === 'motor_idle') {
                    fail(`motor_idle does not exist in Betaflight ${major}.${minor} (it replaced dshot_idle_value in 2025.12); the version line and the settings do not match.`);
                } else if (vi.idleSetting === 'motor_idle' && name === 'dshot_idle_value') {
                    fail(`dshot_idle_value is from 4.x and does not exist in ${vi.label} (it is motor_idle there); the version line and the settings do not match.`);
                }
            }
        }
    }
    if (res.errors.length > 0) return res;
    res.activePidProfile = active.pid;
    res.activeRateProfile = active.rate;

    const rp = sections.get(`rate:${active.rate}`) ?? new Map<string, string>();
    const pp = sections.get(`pid:${active.pid}`) ?? new Map<string, string>();
    const master = sections.get('master') ?? new Map<string, string>();
    const used = new Set<string>(); // "section|name" of every value the import applies

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
    const rateKey = `rate:${active.rate}`;
    const pidKey = `pid:${active.pid}`;
    used.add(`${rateKey}|rates_type`);

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
        used.add(`${rateKey}|${name}`);
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
    const limits = AXES.map((ax) => {
        used.add(`${rateKey}|${ax}_rate_limit`);
        return readInt(rp, `${ax}_rate_limit`, DEFAULT_RATES.rateLimit, RATE_LIMIT_MIN, SETPOINT_RATE_LIMIT);
    });
    const rateLimit = Math.min(...limits);
    if (limits.some((l) => l !== rateLimit)) {
        warn(`Per-axis rate limits ${limits.join('/')} differ; the simulator has one limit and uses the lowest, ${rateLimit} deg/s.`);
    }
    const throttle = {
        mid: readInt(rp, 'thr_mid', DEFAULT_RATES.thrMid, 0, 100),
        expo: readInt(rp, 'thr_expo', DEFAULT_RATES.thrExpo, 0, 100)
    };
    used.add(`${rateKey}|thr_mid`);
    used.add(`${rateKey}|thr_expo`);
    for (const name of ['throttle_limit_type', 'throttle_limit_percent']) {
        if (rp.has(name)) warn(`${name} = ${rp.get(name)} is not applied by the simulator.`);
    }
    for (const ax of ['roll', 'pitch']) {
        const name = `${ax}_level_expo`;
        // levelExpo left the rate profile in 4.5 (controlRateConfig_t PG version 5 -> 6).
        if (rp.has(name) && !(major === 4 && minor <= 4)) {
            warn(`${name} does not exist after 4.4; ignored.`);
        }
    }

    // ---- PID of the active profile --------------------------------------------------------
    const pid = {} as { roll: PidTriple; pitch: PidTriple; yaw: PidTriple };
    const dBase = {} as { roll: number; pitch: number; yaw: number };
    // The boost is driven by gyro activity (gain) and by setpoint change (gain * advance in
    // 4.x, advance alone in 2025.12+): pid_init.c 4.5.1 L406-407, 2025.12.1 L540-541, 2026.6.1 L506-507.
    const gain = readInt(pp, 'd_max_gain', vi.boostGain, 0, 100);
    const advance = readInt(pp, 'd_max_advance', vi.boostAdvance, 0, 200);
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
            // 2025.12+: d_<axis> is the resting D; d_max_<axis> the peak, active only when D > 0
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
    if (hashNote) {
        // Would the release named by the build hash read this dump differently? Only the D-boost
        // defaults and the idle setting name can differ between the releases accepted here.
        const alt = hashNote.alt;
        if (alt) {
            const intOr = (name: string, def: number) => (pp.has(name) ? Number(pp.get(name)) : def);
            const altGain = intOr('d_max_gain', alt.boostGain);
            const altAdvance = intOr('d_max_advance', alt.boostAdvance);
            const altOff = alt.scheme === 'd-is-peak' ? altGain === 0 : altGain === 0 && altAdvance === 0;
            if (alt.scheme === scheme && altOff === boostOff && alt.idleSetting === vi.idleSetting) {
                hashNote.parts.push('The rates, PIDs, feed-forward, throttle curve and idle read the same either way.');
            } else {
                hashNote.parts.push(`Read as ${hashNote.release}, the D values or the idle would differ (D boost ${altOff ? 'off' : 'on'} instead of ${boostOff ? 'off' : 'on'}); the import follows the version line.`);
            }
        }
        warn(hashNote.parts.join(' '));
    }
    for (const name of pp.keys()) if (isPidVar(name)) used.add(`${pidKey}|${name}`);

    // ---- motor idle ---------------------------------------------------------------------------
    // Static idle (pg/motor.c, mixer_init.c): 4.3-4.5 dshot_idle_value (digital protocols only),
    // 2025.12+ motor_idle. Dynamic idle (dyn_idle_min_rpm, a profile value, x100 rpm) replaces the
    // static floor in flight: mixer_init.c sets the output floor to zero and a controller keeps
    // the slowest motor above the target rpm.
    const protocol = (master.get('motor_pwm_protocol') ?? '').toUpperCase();
    if (protocol && !ALL_PROTOCOLS.includes(protocol)) warn(`motor_pwm_protocol = ${protocol} is not a known Betaflight motor protocol.`);
    const idleName = vi.idleSetting;
    const brushed = protocol === 'BRUSHED';
    const idleDefault = idleName === 'motor_idle' && brushed ? DEFAULT_IDLE_BRUSHED : DEFAULT_IDLE;
    const idleValue = readInt(master, idleName, idleDefault, 0, IDLE_MAX);
    const dynIdle = readInt(pp, 'dyn_idle_min_rpm', 0, 0, DYN_IDLE_MAX);
    used.add(`master|${idleName}`);
    used.add(`${pidKey}|dyn_idle_min_rpm`);
    if (idleName === 'dshot_idle_value' && ANALOG_PROTOCOLS.includes(protocol)) {
        warn(`motor_pwm_protocol = ${protocol}: in Betaflight ${vi.label} the static idle (dshot_idle_value) applies only to DShot, so no idle was imported; the drone keeps its preset idle.`);
    } else {
        res.idle = { fraction: idleValue / 10000, setting: idleName, value: idleValue, fromDefault: !master.has(idleName), dynamicMinRpm: dynIdle * 100 };
        if (brushed) warn('motor_pwm_protocol = BRUSHED: the simulator models brushless motors; the idle was imported as a fraction of full output anyway.');
    }
    if (dynIdle > 0) {
        warn(
            `Dynamic idle is on (dyn_idle_min_rpm = ${dynIdle}, ${dynIdle * 100} rpm): in flight Betaflight keeps every motor above ${dynIdle * 100} rpm instead of a fixed idle. The simulator has a fixed idle; the imported idle is ${(idleValue / 100).toFixed(1)} % until it is converted with the drone's motor data (idleForMinRpm).`
        );
    }

    // ---- the rest ---------------------------------------------------------------------------
    for (const name of SETPOINT_MASTER_VARS) {
        if (master.has(name)) {
            warn(`${name} = ${master.get(name)} changes the stick feel in Betaflight but is not applied by the simulator.`);
        }
    }
    const mol = pp.get('motor_output_limit');
    if (mol !== undefined && mol !== '100') {
        warn(`motor_output_limit = ${mol} caps motor output at ${mol} % in Betaflight; the simulator does not apply it, so top thrust and speed are higher than on the real quad.`);
    }
    const feel = FEEL_PROFILE_VARS.filter((n) => pp.has(n) && n !== 'motor_output_limit').map((n) => `${n} = ${pp.get(n)}`);
    if (feel.length > 0) warn(`Not modelled by the simulator, although they change how the quad flies in Betaflight: ${feel.join(', ')}.`);

    // Everything read but not applied: master, the active profile, the active rate profile and
    // the active battery profile. Inactive profiles are other tunes, not ignored settings.
    const listed: [string, RawValues | undefined][] = [
        ['master', master],
        [pidKey, sections.get(pidKey)],
        [rateKey, sections.get(rateKey)]
    ];
    if (active.battery >= 0) listed.push([`battery:${active.battery}`, sections.get(`battery:${active.battery}`)]);
    for (const [key, sec] of listed) {
        if (!sec) continue;
        for (const [name, value] of sec) {
            if (!used.has(`${key}|${name}`)) res.ignored.push({ section: SECTION_NAME(key), name, value });
        }
    }
    // Settings with a warning of their own are not counted again here.
    const quiet = res.ignored.filter((g) => !SETPOINT_MASTER_VARS.includes(g.name) && !FEEL_PROFILE_VARS.includes(g.name) && !/^(throttle_limit_type|throttle_limit_percent)$/.test(g.name));
    if (quiet.length > 0) {
        const some = quiet.slice(0, 5).map((g) => g.name).join(', ');
        warn(`${quiet.length} setting(s) not used by the simulator were ignored (${some}${quiet.length > 5 ? ', ...' : ''}).`);
    }
    if (res.errors.length > 0) return res;
    res.rates = { ...rates, rateLimit };
    res.throttle = throttle;
    res.pid = pid;
    res.dBase = dBase;
    return res;
}

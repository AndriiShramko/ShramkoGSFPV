import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseBetaflightDiff, idleForMinRpm, compileParams, maxRate } from '../src/index';
import type { PresetJson } from '../src/index';

// The nine CLI dumps BetaFPV publishes for the Pavo20 Pro and Pro II (fixtures/betafpv/README.md
// lists the source URL of each). They are kept byte for byte; the hashes below are the files as
// downloaded on 2026-09-28.
const DIR = join(__dirname, 'fixtures', 'betafpv');
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');
const has = (list: string[], s: string) => list.some((w) => w.includes(s));
const edit = (text: string, from: string, to: string) => {
    expect(text).toContain(from);
    return text.replace(from, to);
};

const PRO_PID = { roll: [54, 111, 44, 0], pitch: [68, 139, 60, 0], yaw: [54, 111, 0, 0] };
const PRO2_F405_PID = { roll: [51, 105, 46, 41], pitch: [64, 133, 63, 51], yaw: [51, 105, 0, 41] };
const PRO2_AT32_PID = { roll: [53, 110, 46, 43], pitch: [67, 139, 63, 53], yaw: [53, 110, 0, 43] };
const DEFAULT_RATES = { type: 'ACTUAL', roll: { rcRate: 7, rate: 67, expo: 0 }, pitch: { rcRate: 7, rate: 67, expo: 0 }, yaw: { rcRate: 7, rate: 67, expo: 0 }, rateLimit: 1998 };

interface Expect {
    file: string;
    sha256: string;
    version: string;
    semantics: string;
    pid: typeof PRO_PID;
    throttle: { mid: number; expo: number };
    idle: { fraction: number; setting: string; value: number };
}
const TABLE: Expect[] = [
    { file: 'pavo20pro-bf450-elrs-20241216.txt', sha256: '52f70752ec348c12939ea138627d5c7cd1c77043ca3a31f3a15ee0e592ef57c6', version: '4.5.0', semantics: '4.5', pid: PRO_PID, throttle: { mid: 65, expo: 20 }, idle: { fraction: 0.1, setting: 'dshot_idle_value', value: 1000 } },
    { file: 'pavo20pro-bf450-tbs-20240729.txt', sha256: '6bfd2c7bc353e76027567c3f33c2595a2a5357e08a5304ab27fb677994e86d7b', version: '4.5.0', semantics: '4.5', pid: PRO_PID, throttle: { mid: 65, expo: 20 }, idle: { fraction: 0.1, setting: 'dshot_idle_value', value: 1000 } },
    { file: 'pavo20pro-bf450-sbus-20250610.txt', sha256: '2148109e3f186786085e0663df94aeba50cc54211ef8929f7068a9380dae695c', version: '4.5.0', semantics: '4.5', pid: PRO_PID, throttle: { mid: 65, expo: 20 }, idle: { fraction: 0.1, setting: 'dshot_idle_value', value: 1000 } },
    { file: 'pavo20pro2-3s-bf453-f405-elrs-20251230.txt', sha256: '0e55ba03239f347df40fc2bc8c7fdad08c8991dd507dd1a22f10fc61bc987c9e', version: '4.5.3', semantics: '4.5', pid: PRO2_F405_PID, throttle: { mid: 50, expo: 0 }, idle: { fraction: 0.1, setting: 'dshot_idle_value', value: 1000 } },
    { file: 'pavo20pro2-3s-bf453-f405-sbus-20251230.txt', sha256: 'a9ed1d999907ce3da5be02baa2a78c828aaadfd74e9a2c5b318c63b376636a7d', version: '4.5.3', semantics: '4.5', pid: PRO2_F405_PID, throttle: { mid: 50, expo: 0 }, idle: { fraction: 0.1, setting: 'dshot_idle_value', value: 1000 } },
    { file: 'pavo20pro2-bf2025125-at32-elrs-20260810.txt', sha256: '5040e1e971ec8d27ae85b60e166d1f8ee0572cd3d679a46109f0124514f10190', version: '2025.12.5', semantics: '2025.12', pid: PRO2_AT32_PID, throttle: { mid: 50, expo: 0 }, idle: { fraction: 0.08, setting: 'motor_idle', value: 800 } },
    { file: 'pavo20pro2-bf2025125-at32-sbus-20260810.txt', sha256: '1e908bdca52db601c5002b0fd4125082d02f549ccd88b818603060a79e7dcea6', version: '2025.12.5', semantics: '2025.12', pid: PRO2_AT32_PID, throttle: { mid: 50, expo: 0 }, idle: { fraction: 0.08, setting: 'motor_idle', value: 800 } },
    { file: 'pavo20pro2-bf202661-at32-elrs-20260920.txt', sha256: '7a0722731822ca26c57ccd298030e371f131b10b3ba8efbf31f763b4952a9563', version: '2026.6.1', semantics: '2026.6', pid: PRO2_AT32_PID, throttle: { mid: 50, expo: 0 }, idle: { fraction: 0.08, setting: 'motor_idle', value: 800 } },
    { file: 'pavo20pro2-bf202661-at32-sbus-20260920.txt', sha256: '391d5084f806bafb5473dc30464cb2cfd67f2f2a706a8ea9c5b0365f2822fc62', version: '2026.6.1', semantics: '2026.6', pid: PRO2_AT32_PID, throttle: { mid: 50, expo: 0 }, idle: { fraction: 0.08, setting: 'motor_idle', value: 800 } }
];

describe('BetaFPV Pavo20 dumps (real firmware output)', () => {
    it('the fixture folder holds exactly the nine files of the table, unchanged since download', () => {
        const files = readdirSync(DIR).filter((n) => n.endsWith('.txt')).sort();
        expect(files).toEqual(TABLE.map((t) => t.file).sort());
        for (const t of TABLE) {
            const sha = createHash('sha256').update(readFileSync(join(DIR, t.file))).digest('hex');
            expect(sha, t.file).toBe(t.sha256);
        }
    });

    for (const t of TABLE) {
        it(`${t.file}: Betaflight ${t.version} parses with 0 errors; PIDs, FF, rates, throttle curve and idle are imported`, () => {
            const r = parseBetaflightDiff(read(t.file));
            expect(r.errors).toEqual([]);
            const v = r.firmware.version!;
            expect(`${v.major}.${v.minor}.${v.patch}`).toBe(t.version);
            expect(r.firmware.semantics).toBe(t.semantics);
            expect(r.activePidProfile).toBe(0);
            expect(r.activeRateProfile).toBe(0);
            expect(r.pid).toEqual(t.pid);
            // D is constant on every BetaFPV profile 0 (d_min / d_max equal to D, simplified D-max gain 0).
            expect(r.dBase).toEqual({ roll: t.pid.roll[2], pitch: t.pid.pitch[2], yaw: 0 });
            expect(r.rates).toEqual(DEFAULT_RATES);
            expect(maxRate(r.rates!, 'yaw')).toBe(670);
            expect(r.throttle).toEqual(t.throttle);
            expect(r.idle).toEqual({ ...t.idle, fromDefault: false, dynamicMinRpm: 0 });
            // What was not imported is listed, with its section, and summarised in one warning.
            expect(r.ignored.length).toBeGreaterThan(40);
            expect(r.ignored).toContainEqual({ section: 'master', name: 'motor_poles', value: '12' });
            expect(r.ignored).toContainEqual({ section: 'master', name: 'dshot_bidir', value: 'ON' });
            expect(r.ignored.some((g) => g.section === 'profile 0' && g.name === 'tpa_breakpoint')).toBe(true);
            for (const used of ['p_roll', 'f_yaw', 'thr_mid', 'dshot_idle_value', 'motor_idle']) expect(r.ignored.map((g) => g.name)).not.toContain(used);
            expect(r.ignoredCommands.aux).toBe(6);
            expect(has(r.warnings, 'not used by the simulator were ignored')).toBe(true);
            expect(has(r.warnings, 'Not modelled by the simulator')).toBe(true);
        });
    }

    it('the 2026.6.1 dumps carry the 2026 warning, naming the 2025.12.5 build hash and MSP API', () => {
        for (const f of ['pavo20pro2-bf202661-at32-elrs-20260920.txt', 'pavo20pro2-bf202661-at32-sbus-20260920.txt']) {
            const r = parseBetaflightDiff(read(f));
            const w = r.warnings.find((x) => x.startsWith('Betaflight 2026.6.1 is read with 2026.6 meanings'));
            expect(w, f).toBeDefined();
            expect(w).toContain('build hash 7348054f2 is the commit of Betaflight 2025.12.5');
            expect(w).toContain('MSP API 1.47 is not the 1.48 that 2026.6 reports');
            expect(w).toContain('read the same either way');
            expect(r.firmware.releaseOfHash).toBe('2025.12.5');
            // ...and the same body under the 2025.12.5 line gives the same import, without that warning.
            const as2025 = parseBetaflightDiff(read(f).replace(' 2026.6.1 ', ' 2025.12.5 '));
            expect(as2025.errors).toEqual([]);
            expect(as2025.pid).toEqual(r.pid);
            expect(as2025.idle).toEqual(r.idle);
            expect(has(as2025.warnings, '2026')).toBe(false);
        }
        // The 4.5 and 2025.12 dumps name their own release commit: no hash warning.
        for (const t of TABLE.filter((x) => !x.version.startsWith('2026'))) {
            expect(has(parseBetaflightDiff(read(t.file)).warnings, 'build hash'), t.file).toBe(false);
        }
    });

    it('negative controls: the same 2026 dump is refused under 2027, and with a 4.x D setting', () => {
        const f = read('pavo20pro2-bf202661-at32-elrs-20260920.txt');
        const r27 = parseBetaflightDiff(f.replace(' 2026.6.1 ', ' 2027.6.1 '));
        expect(r27.errors.join(' ')).toMatch(/not supported/);
        expect(r27.pid).toBeNull();
        const mixed = parseBetaflightDiff(edit(f, 'set d_max_roll = 46', 'set d_min_roll = 46'));
        expect(mixed.errors.join(' ')).toMatch(/d_min_roll is from 4\.x/);
        expect(mixed.idle).toBeNull();
    });

    it('the Pavo20 Pro dump differs from the Pro II dumps where the research says it does', () => {
        const pro = parseBetaflightDiff(read('pavo20pro-bf450-elrs-20241216.txt'));
        const pro2 = parseBetaflightDiff(read('pavo20pro2-3s-bf453-f405-elrs-20251230.txt'));
        expect(pro.pid!.roll[3]).toBe(0); // FF 0 on the Pro
        expect(pro2.pid!.roll[3]).toBe(41);
        expect(pro.throttle).toEqual({ mid: 65, expo: 20 });
        expect(pro2.throttle).toEqual({ mid: 50, expo: 0 });
    });
});

// ---- idle ---------------------------------------------------------------------------------------
const V45 = '# Betaflight / STM32F405 (S405) 4.5.1 Mar 19 2025 / 10:06:16 (77d01ba3b) MSP API: 1.46';
const V2025 = '# Betaflight / STM32F405 (S405) 2025.12.1 Jan 10 2026 / 12:00:00 (0123456789) MSP API: 1.47';
const V2026 = '# Betaflight / STM32F405 (S405) 2026.6.1 Jul  1 2026 / 12:00:00 (6dbc4218f) MSP API: 1.48';
const body = (version: string, master = '', profile = '', rate = '') => `# version\n${version}\n\n# master\n${master}\nprofile 0\n${profile}\nrateprofile 0\n${rate}\n`;

describe('motor idle import', () => {
    it('an omitted idle is the firmware default 5.5 %, in every version', () => {
        for (const v of [V45, V2025, V2026]) {
            const r = parseBetaflightDiff(body(v));
            expect(r.errors).toEqual([]);
            expect(r.idle!.fraction).toBe(0.055);
            expect(r.idle!.fromDefault).toBe(true);
        }
        expect(parseBetaflightDiff(body(V45)).idle!.setting).toBe('dshot_idle_value');
        expect(parseBetaflightDiff(body(V2025)).idle!.setting).toBe('motor_idle');
    });

    it('negative control: each release refuses the other idle name as a mismatched version line', () => {
        const a = parseBetaflightDiff(body(V45, 'set motor_idle = 800'));
        expect(a.errors.join(' ')).toMatch(/motor_idle does not exist in Betaflight 4\.5/);
        expect(a.idle).toBeNull();
        const b = parseBetaflightDiff(body(V2025, 'set dshot_idle_value = 1000'));
        expect(b.errors.join(' ')).toMatch(/dshot_idle_value is from 4\.x/);
        // ...while the right name reads.
        expect(parseBetaflightDiff(body(V45, 'set dshot_idle_value = 1000')).idle!.fraction).toBe(0.1);
        expect(parseBetaflightDiff(body(V2025, 'set motor_idle = 800')).idle!.fraction).toBe(0.08);
        // Out of the CLI range 0..2000.
        expect(parseBetaflightDiff(body(V45, 'set dshot_idle_value = 2001')).errors.join(' ')).toMatch(/0\.\.2000/);
    });

    it('4.x analog protocols have no static idle: nothing imported, with a warning; 2025.12 brushed defaults to 7 %', () => {
        const pwm = parseBetaflightDiff(body(V45, 'set motor_pwm_protocol = PWM\nset dshot_idle_value = 1000'));
        expect(pwm.errors).toEqual([]);
        expect(pwm.idle).toBeNull();
        expect(has(pwm.warnings, 'applies only to DShot')).toBe(true);
        const dshot = parseBetaflightDiff(body(V45, 'set motor_pwm_protocol = DSHOT300\nset dshot_idle_value = 1000'));
        expect(dshot.idle!.fraction).toBe(0.1);
        const brushed = parseBetaflightDiff(body(V2025, 'set motor_pwm_protocol = BRUSHED'));
        expect(brushed.idle).toEqual({ fraction: 0.07, setting: 'motor_idle', value: 700, fromDefault: true, dynamicMinRpm: 0 });
        expect(has(brushed.warnings, 'BRUSHED')).toBe(true);
    });

    it('dynamic idle (dyn_idle_min_rpm, a profile value) is reported in rpm with a warning', () => {
        const r = parseBetaflightDiff(body(V45, 'set dshot_idle_value = 700', 'set dyn_idle_min_rpm = 35'));
        expect(r.errors).toEqual([]);
        expect(r.idle).toEqual({ fraction: 0.07, setting: 'dshot_idle_value', value: 700, fromDefault: false, dynamicMinRpm: 3500 });
        expect(has(r.warnings, 'Dynamic idle is on (dyn_idle_min_rpm = 35, 3500 rpm)')).toBe(true);
        expect(r.ignored.map((g) => g.name)).not.toContain('dyn_idle_min_rpm');
        // Control: without it there is no dynamic-idle warning; above the CLI range 200 it is refused.
        expect(has(parseBetaflightDiff(body(V45)).warnings, 'Dynamic idle')).toBe(false);
        expect(parseBetaflightDiff(body(V45, '', 'set dyn_idle_min_rpm = 201')).errors.join(' ')).toMatch(/0\.\.200/);
        // Only the active profile counts.
        const other = parseBetaflightDiff(`${V45}\nprofile 1\nset dyn_idle_min_rpm = 40\nprofile 0\n# restore original profile selection\nprofile 0\nrateprofile 0\n`);
        expect(other.errors).toEqual([]);
        expect(other.idle!.dynamicMinRpm).toBe(0);
    });

    it('idleForMinRpm converts a dynamic-idle rpm into the output fraction of a drone', () => {
        const preset = JSON.parse(readFileSync(join(__dirname, '..', 'presets', 'pavo20pro-3s.json'), 'utf8')) as PresetJson;
        const sp = compileParams(preset);
        // 7200 KV x 0.75 loaded -> 5400 rpm per volt; 3000 rpm at 10 V -> 3000 / 54000.
        expect(idleForMinRpm(3000, 7200 * 0.75 * (2 * Math.PI) / 60, 10)).toBeCloseTo(3000 / 54000, 12);
        const f = idleForMinRpm(3500, sp.omegaMaxPerVolt, sp.vNom);
        expect(f).toBeGreaterThan(0.02);
        expect(f).toBeLessThan(0.08);
        expect(idleForMinRpm(0, sp.omegaMaxPerVolt, sp.vNom)).toBe(0);
        expect(idleForMinRpm(1e9, sp.omegaMaxPerVolt, sp.vNom)).toBe(1);
    });
});

// ---- 2026.6 structure ------------------------------------------------------------------------------
// The order printConfig of 2026.6.1 uses for `diff all`: master, profiles, the profile restore,
// rate profiles, battery profiles, then the rateprofile and battery_profile restores.
const DIFF_2026 = [
    '# diff all', '', '# version', V2026, '', 'batch start', '', '# master', 'set motor_pwm_protocol = DSHOT300', 'set motor_idle = 900', '',
    'profile 0', '', '# profile 0', 'set p_roll = 50', 'set d_roll = 35', 'set d_max_roll = 45', '',
    'profile 1', '', 'profile 2', '', 'profile 3', '', '# restore original profile selection', 'profile 0', '',
    'rateprofile 0', '', '# rateprofile 0', 'set roll_srate = 80', '', 'rateprofile 1', '', 'rateprofile 2', '', 'rateprofile 3', '',
    'battery_profile 0', '', '# battery_profile 0', 'set bat_capacity = 550', 'set force_battery_cell_count = 3', '',
    'battery_profile 1', '', '# battery_profile 1', 'set bat_capacity = 450', '',
    'battery_profile 2', '',
    '# restore original rateprofile selection', 'rateprofile 0', '', '# restore original battery_profile selection', 'battery_profile 0', '',
    '# save configuration', 'save', ''
].join('\r\n');

describe('Betaflight 2026.6 diff all', () => {
    it('battery_profile sections are read as their own sections; the active one is listed as ignored', () => {
        const r = parseBetaflightDiff(DIFF_2026);
        expect(r.errors).toEqual([]);
        expect(r.firmware.semantics).toBe('2026.6');
        expect(has(r.warnings, 'Betaflight 2026.6.1 is read with 2026.6 meanings')).toBe(true);
        expect(has(r.warnings, 'labelled')).toBe(false); // the hash is 2026.6.1's own commit
        expect(r.pid!.roll).toEqual([50, 80, 45, 120]);
        expect(r.dBase!.roll).toBe(35);
        expect(r.rates!.roll.rate).toBe(80);
        expect(r.idle!.fraction).toBe(0.09);
        expect(r.ignored).toContainEqual({ section: 'battery_profile 0', name: 'bat_capacity', value: '550' });
        expect(r.ignored).not.toContainEqual({ section: 'battery_profile 1', name: 'bat_capacity', value: '450' });
    });

    it('negative control: without the battery_profile selector the battery values would pile into rateprofile 3 and clash', () => {
        const r = parseBetaflightDiff(DIFF_2026.replace(/battery_profile (\d)/g, 'batteryprofile $1'));
        expect(r.errors.join(' ')).toMatch(/bat_capacity" appears twice/);
    });

    it('2026.6 D-boost defaults (d_max_gain 0, d_max_advance 35): advance 0 alone switches the boost off only in 2026.6', () => {
        const d26 = DIFF_2026.replace('set d_max_roll = 45', 'set d_max_roll = 45\r\nset d_max_advance = 0');
        const r26 = parseBetaflightDiff(d26);
        expect(r26.errors).toEqual([]);
        expect(r26.pid!.roll[2]).toBe(35); // gain default 0 + advance 0: D rests at d_roll
        // Control: the same body under 2025.12 (gain default 37) keeps the boost to d_max_roll 45.
        const r25 = parseBetaflightDiff(d26.replace(V2026, V2025).replace(/battery_profile \d\r\n\r\n(# battery_profile \d\r\n(set [^\r]+\r\n)*)?/g, ''));
        expect(r25.errors).toEqual([]);
        expect(r25.pid!.roll[2]).toBe(45);
    });

    it('a 2026 build hash of another release is named, and a differing D reading is reported, not hidden', () => {
        // The genuine 2026.6 body under a line whose hash is 2025.12.5's commit.
        const t = DIFF_2026.replace('(6dbc4218f) MSP API: 1.48', '(7348054f2) MSP API: 1.47').replace('set d_max_roll = 45', 'set d_max_roll = 45\r\nset d_max_advance = 0');
        const r = parseBetaflightDiff(t);
        expect(r.errors).toEqual([]);
        const w = r.warnings.find((x) => x.startsWith('Betaflight 2026.6.1'))!;
        expect(w).toContain('2025.12.5 build labelled 2026.6.1');
        expect(w).toContain('D boost on instead of off');
        expect(w).not.toContain('read the same either way');
    });

    it('a later 2026.x is read as 2026.6 with its own warning; a 4.x line with another release hash is named', () => {
        const r = parseBetaflightDiff(DIFF_2026.replace(' 2026.6.1 ', ' 2026.12.0 '));
        expect(r.errors).toEqual([]);
        expect(has(r.warnings, 'newer than any release the import was checked against')).toBe(true);
        const v = parseBetaflightDiff(body(V45.replace('(77d01ba3b)', '(0e533ba76)')));
        expect(v.errors).toEqual([]);
        expect(has(v.warnings, 'build hash 0e533ba76 is the commit of Betaflight 4.5.3')).toBe(true);
        // Control: the matching hash gives no such warning.
        expect(has(parseBetaflightDiff(body(V45)).warnings, 'build hash')).toBe(false);
    });

    it('battery_profile lines under a pre-2026 version line are ignored with a warning, never refused', () => {
        const r = parseBetaflightDiff(`${V2025}\nprofile 0\nrateprofile 0\nbattery_profile 0\nset bat_capacity = 550\n`);
        expect(r.errors).toEqual([]);
        expect(has(r.warnings, 'exist only from Betaflight 2026.6')).toBe(true);
    });
});

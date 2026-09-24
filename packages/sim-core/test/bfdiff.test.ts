import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBetaflightDiff, setpointRate, maxRate } from '../src/index';

// Synthetic diffs in the firmware's print order (printConfig; valueTable order within a
// section); the values are made up, the structure is what 4.4.3 / 4.5.1 print.
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const D45 = fixture('bf-diff-4.5.1.txt');
const D44 = fixture('bf-diff-4.4.3.txt');

const VERSION_45 = '# Betaflight / STM32F405 (S405) 4.5.1 Mar 19 2025 / 10:06:16 (77d01ba3b) MSP API: 1.46';
const VERSION_44 = '# Betaflight / STM32F7X2 (S7X2) 4.4.3 Nov 18 2023 / 01:52:14 (738127e7e) MSP API: 1.45';
// Synthetic line in the same printVersion format; only the version number matters here.
const VERSION_2025 = '# Betaflight / STM32F405 (S405) 2025.12.1 Jan 10 2026 / 12:00:00 (0123456789) MSP API: 1.47';

const swapVersion = (text: string, from: string, to: string) => {
    expect(text).toContain(from);
    return text.replace(from, to);
};
const edit = (text: string, from: string, to: string) => {
    expect(text).toContain(from);
    return text.replace(from, to);
};
/** A minimal plain `diff` body: one profile and one rate profile. */
const plain = (version: string, profile: string, rate = '') => `# version\n${version}\n\nprofile 0\n${profile}\nrateprofile 0\n${rate}\n`;
const has = (list: string[], s: string) => list.some((w) => w.includes(s));

describe('Betaflight diff import: fixtures', () => {
    it('4.5.1 diff all: active profile 1 / rateprofile 2, omitted values are defaults', () => {
        const r = parseBetaflightDiff(D45);
        expect(r.errors).toEqual([]);
        expect(r.firmware).toEqual({
            name: 'Betaflight',
            version: { major: 4, minor: 5, patch: 1 },
            suffix: null,
            target: 'STM32F405',
            boardId: 'S405',
            mspApi: '1.46',
            raw: VERSION_45
        });
        // "restore original ... selection" lines point at profile 1 and rateprofile 2, not 3.
        expect(r.activePidProfile).toBe(1);
        expect(r.activeRateProfile).toBe(2);
        // rates_type absent -> ACTUAL; yaw_expo absent -> 0; no rate_limit -> 1998.
        expect(r.rates).toEqual({
            type: 'ACTUAL',
            roll: { rcRate: 20, rate: 85, expo: 30 },
            pitch: { rcRate: 20, rate: 85, expo: 30 },
            yaw: { rcRate: 18, rate: 65, expo: 0 },
            rateLimit: 1998
        });
        expect(r.throttle).toEqual({ mid: 45, expo: 25 });
        // i_pitch 84, f_pitch 125, i_yaw 80, d_yaw 0 are 4.5 defaults (pid.h).
        expect(r.pid).toEqual({ roll: [52, 90, 35, 140], pitch: [55, 84, 44, 125], yaw: [50, 80, 0, 100] });
        expect(r.dBase).toEqual({ roll: 25, pitch: 32, yaw: 0 });
        expect(r.warnings.some((w) => w.startsWith('yaw_deadband = 5'))).toBe(true);
        // d_max_gain is a PID setting that is read, not an ignored one.
        expect(has(r.warnings, 'd_max_gain')).toBe(false);
        expect(r.warnings.filter((w) => w.includes('not used by the simulator')).length).toBe(1);
        expect(has(r.warnings, 'custom default')).toBe(false); // 4.5 diffs against compiled defaults
    });

    it('4.4.3 plain diff: single profile 2 / rateprofile 1, d_min_pitch default 34', () => {
        const r = parseBetaflightDiff(D44);
        expect(r.errors).toEqual([]);
        expect(r.firmware.version).toEqual({ major: 4, minor: 4, patch: 3 });
        expect(r.firmware.mspApi).toBe('1.45');
        expect(r.activePidProfile).toBe(2);
        expect(r.activeRateProfile).toBe(1);
        // yaw_rate_limit 1000 vs 1998 on roll/pitch -> one limit, the lowest, with a warning.
        expect(r.rates).toEqual({
            type: 'BETAFLIGHT',
            roll: { rcRate: 120, rate: 72, expo: 10 },
            pitch: { rcRate: 120, rate: 72, expo: 10 },
            yaw: { rcRate: 100, rate: 60, expo: 0 },
            rateLimit: 1000
        });
        expect(has(r.warnings, '1998/1998/1000')).toBe(true);
        expect(r.throttle).toEqual({ mid: 50, expo: 0 });
        expect(r.pid).toEqual({ roll: [45, 80, 42, 110], pitch: [50, 84, 48, 125], yaw: [45, 80, 0, 120] });
        expect(r.dBase).toEqual({ roll: 28, pitch: 34, yaw: 0 });
        // roll_level_expo is a real 4.4 rate-profile setting: no "does not exist" warning.
        expect(has(r.warnings, 'level_expo does not exist')).toBe(false);
        // "# config: YES" -> the diff is against the board's custom defaults.
        expect(has(r.warnings, '4.4 diff: an omitted value')).toBe(true);
        expect(has(r.warnings, 'not supported')).toBe(false);
    });

    it('4.4 without custom defaults (no marker, or NO CONFIG FOUND) gives no custom-default warning', () => {
        expect(has(parseBetaflightDiff(edit(D44, '# config: YES', '')).warnings, 'custom default')).toBe(false);
        const none = edit(D44, '# config: YES', '###ERROR IN diff: NO CONFIG FOUND###');
        const r = parseBetaflightDiff(none);
        expect(r.errors).toEqual([]);
        expect(has(r.warnings, 'custom default')).toBe(false);
        expect(r.pid).toEqual(parseBetaflightDiff(D44).pid);
    });

    it('CRLF (as the firmware prints) and bare CR line endings give the same result', () => {
        expect(parseBetaflightDiff(D45.replace(/\n/g, '\r\n'))).toEqual(parseBetaflightDiff(D45));
        expect(parseBetaflightDiff(D44.replace(/\n/g, '\r\n'))).toEqual(parseBetaflightDiff(D44));
        expect(parseBetaflightDiff(D45.replace(/\n/g, '\r'))).toEqual(parseBetaflightDiff(D45));
    });

    it('a 4.5 diff with nothing changed yields exactly the 4.5 defaults', () => {
        const r = parseBetaflightDiff(`# version\n${VERSION_45}\nbatch start\nprofile 0\nrateprofile 0\nbatch end\n`);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
        expect(r.rates).toEqual({
            type: 'ACTUAL',
            roll: { rcRate: 7, rate: 67, expo: 0 },
            pitch: { rcRate: 7, rate: 67, expo: 0 },
            yaw: { rcRate: 7, rate: 67, expo: 0 },
            rateLimit: 1998
        });
        expect(r.pid).toEqual({ roll: [45, 80, 40, 120], pitch: [47, 84, 46, 125], yaw: [45, 80, 0, 120] });
        expect(r.dBase).toEqual({ roll: 30, pitch: 34, yaw: 0 });
        expect(maxRate(r.rates!, 'roll')).toBe(670); // Actual default: 670 deg/s
    });

    it('a 2025.12 diff with nothing changed yields the 2025.12 defaults (pid.h: D 30/34 base, d_max 40/46)', () => {
        const r = parseBetaflightDiff(`# version\n${VERSION_2025}\nprofile 0\nrateprofile 0\n`);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
        expect(r.pid).toEqual({ roll: [45, 80, 40, 120], pitch: [47, 84, 46, 125], yaw: [45, 80, 0, 120] });
        expect(r.dBase).toEqual({ roll: 30, pitch: 34, yaw: 0 });
        expect(r.rates!.roll).toEqual({ rcRate: 7, rate: 67, expo: 0 });
    });

    it('a 2025.12 pre-release suffix keeps the date and MSP fields (version.h FC_VERSION_SUFFIX)', () => {
        const rc = VERSION_2025.replace('2025.12.1 ', '2025.12.1-RC1 ');
        const r = parseBetaflightDiff(`${rc}\nprofile 0\nrateprofile 0\n`);
        expect(r.errors).toEqual([]);
        expect(r.firmware.version).toEqual({ major: 2025, minor: 12, patch: 1 });
        expect(r.firmware.suffix).toBe('RC1');
        expect(r.firmware.mspApi).toBe('1.47');
    });
});

describe('Betaflight diff import: version-dependent D', () => {
    it('4.4 and 4.5 read D the same way (facts: no change until after 4.5)', () => {
        const as45 = parseBetaflightDiff(swapVersion(D44, VERSION_44, VERSION_45));
        const as44 = parseBetaflightDiff(swapVersion(D45, VERSION_45, VERSION_44));
        expect(as45.pid).toEqual(parseBetaflightDiff(D44).pid);
        expect(as44.pid).toEqual(parseBetaflightDiff(D45).pid);
        // ...but the version is still read: roll_level_expo is flagged once the line says 4.5.
        expect(as45.warnings.some((w) => w.startsWith('roll_level_expo does not exist'))).toBe(true);
    });

    it('negative control: the same D lines under a 2025.12 version line give another peak D', () => {
        const noDmin = D45.replace(/^set d_min_\w+ = \d+\n/gm, '');
        const r45 = parseBetaflightDiff(noDmin);
        const r = parseBetaflightDiff(swapVersion(noDmin, VERSION_45, VERSION_2025));
        expect(r45.errors).toEqual([]);
        expect(r.errors).toEqual([]);
        // 4.5: d_roll 35 is the peak, default d_min 30 the base.
        expect(r45.pid!.roll[2]).toBe(35);
        expect(r45.dBase).toEqual({ roll: 30, pitch: 34, yaw: 0 });
        // 2025.12: d_roll 35 is the BASE; d_max_roll absent -> default 40 > 35 -> peak 40.
        expect(r.pid!.roll[2]).toBe(40);
        expect(r.pid!.pitch[2]).toBe(46);
        expect(r.dBase).toEqual({ roll: 35, pitch: 44, yaw: 0 });
    });

    it('2025.12 d_max above d is the peak; d_max below d leaves D constant; d = 0 has no boost', () => {
        const r = parseBetaflightDiff(plain(VERSION_2025, 'set d_roll = 30\nset d_max_roll = 55\nset d_pitch = 50\nset d_max_pitch = 45'));
        expect(r.errors).toEqual([]);
        expect(r.pid!.roll[2]).toBe(55);
        expect(r.dBase!.roll).toBe(30);
        expect(r.pid!.pitch[2]).toBe(50);
        expect(r.dBase!.pitch).toBe(50);
        // pid_init.c: the boost needs D > 0.
        const z = parseBetaflightDiff(plain(VERSION_2025, 'set d_roll = 0\nset d_max_roll = 50'));
        expect(z.pid!.roll[2]).toBe(0);
        expect(z.dBase!.roll).toBe(0);
    });

    it('d_max_<axis> under a 4.x line and d_min_<axis> under a 2025.12 line are refused as mismatched', () => {
        const r45 = parseBetaflightDiff(plain(VERSION_45, 'set d_roll = 30\nset d_max_roll = 55'));
        expect(r45.errors.join(' ')).toMatch(/d_max_roll does not exist/);
        expect(r45.pid).toBeNull();
        const r25 = parseBetaflightDiff(swapVersion(D45, VERSION_45, VERSION_2025));
        expect(r25.errors.join(' ')).toMatch(/d_min_roll is from 4\.x/);
        expect(r25.pid).toBeNull();
    });

    it('4.5: d_min is the base only when 0 < d_min < D', () => {
        const up = parseBetaflightDiff(plain(VERSION_45, 'set d_roll = 30\nset d_min_roll = 40'));
        expect(up.pid!.roll[2]).toBe(30);
        expect(up.dBase!.roll).toBe(30);
        const zero = parseBetaflightDiff(plain(VERSION_45, 'set d_roll = 40\nset d_min_roll = 0'));
        expect(zero.pid!.roll[2]).toBe(40);
        expect(zero.dBase!.roll).toBe(40);
        const eq = parseBetaflightDiff(plain(VERSION_45, 'set d_roll = 30\nset d_min_roll = 30'));
        expect(eq.dBase!.roll).toBe(30);
        const below = parseBetaflightDiff(plain(VERSION_45, 'set d_roll = 40\nset d_min_roll = 25'));
        expect(below.pid!.roll[2]).toBe(40);
        expect(below.dBase!.roll).toBe(25);
    });

    it('4.5: d_max_gain = 0 leaves D at d_min for good (pid_init.c: both boost gains scale with it)', () => {
        const r = parseBetaflightDiff(plain(VERSION_45, 'set d_max_gain = 0'));
        expect(r.errors).toEqual([]);
        expect(r.pid!.roll[2]).toBe(30);
        expect(r.pid!.pitch[2]).toBe(34);
        expect(r.dBase).toEqual({ roll: 30, pitch: 34, yaw: 0 });
        expect(has(r.warnings, 'd_max_gain')).toBe(false);
        // Control: any gain > 0 keeps the peak; advance 0 alone does not stop the gyro boost.
        expect(parseBetaflightDiff(plain(VERSION_45, 'set d_max_gain = 1')).pid!.roll[2]).toBe(40);
        expect(parseBetaflightDiff(plain(VERSION_45, 'set d_max_advance = 0')).pid!.roll[2]).toBe(40);
    });

    it('2025.12: the peak is unreachable only when d_max_gain and d_max_advance are both 0', () => {
        expect(parseBetaflightDiff(plain(VERSION_2025, 'set d_max_gain = 0')).pid!.roll[2]).toBe(40);
        expect(parseBetaflightDiff(plain(VERSION_2025, 'set d_max_advance = 0')).pid!.roll[2]).toBe(40);
        const off = parseBetaflightDiff(plain(VERSION_2025, 'set d_max_gain = 0\nset d_max_advance = 0'));
        expect(off.pid!.roll[2]).toBe(30);
        expect(off.dBase!.roll).toBe(30);
    });
});

describe('Betaflight diff import: refusals (negative controls)', () => {
    it('(a) the same body without the version line is refused', () => {
        const r = parseBetaflightDiff(swapVersion(D45, VERSION_45, ''));
        expect(r.errors.length).toBeGreaterThan(0);
        expect(r.rates).toBeNull();
        expect(r.pid).toBeNull();
        const r44 = parseBetaflightDiff(swapVersion(D44, VERSION_44, ''));
        expect(r44.errors.length).toBeGreaterThan(0);
    });

    it('(b) two diffs pasted together are refused, identical or not', () => {
        const two = parseBetaflightDiff(`${D45}\n${D44}`);
        expect(two.errors.join(' ')).toMatch(/Two different version lines/);
        expect(two.pid).toBeNull();
        expect(two.rates).toBeNull();
        const twice = parseBetaflightDiff(`${D45}\n${D45}`);
        expect(twice.errors.join(' ')).toMatch(/pasted more than once/);
        expect(twice.pid).toBeNull();
    });

    it('(c) QUICK rates in the active rate profile are refused', () => {
        const quick = edit(D45, 'set thr_expo = 25', 'set thr_expo = 25\nset rates_type = QUICK');
        const r = parseBetaflightDiff(quick);
        expect(r.errors.join(' ')).toMatch(/QUICK/);
        expect(r.rates).toBeNull();
        // ...but QUICK in an inactive rate profile does not matter.
        const inactive = edit(D45, 'set rates_type = BETAFLIGHT', 'set rates_type = QUICK');
        expect(parseBetaflightDiff(inactive).errors).toEqual([]);
        // An unknown lookup name is refused too; the lookup is case-insensitive like the CLI.
        expect(parseBetaflightDiff(edit(D45, 'set thr_mid = 45', 'set rates_type = FOO')).errors.length).toBeGreaterThan(0);
        expect(parseBetaflightDiff(edit(D44, 'set rates_type = BETAFLIGHT', 'set rates_type = betaflight')).rates).toEqual(parseBetaflightDiff(D44).rates);
    });

    it('(d) garbage and other firmware are refused', () => {
        for (const t of ['', 'hello world\nset p_roll = 50\n', '{"rates":1}', '# Betaflight is great\nprofile 0\n']) {
            const r = parseBetaflightDiff(t);
            expect(r.errors.length).toBeGreaterThan(0);
            expect(r.pid).toBeNull();
        }
        const fork = parseBetaflightDiff(D45.replace('# Betaflight /', '# EmuFlight /'));
        expect(fork.errors.join(' ')).toMatch(/EmuFlight/);
    });

    it('(e) only 4.3, 4.4, 4.5 and 2025.12 are accepted', () => {
        for (const v of ['3.5.7', '4.0.0', '4.1.7', '4.2.11', '4.6.0', '4.7.0', '2025.6.0', '2026.6.0']) {
            const r = parseBetaflightDiff(D45.replace(' 4.5.1 ', ` ${v} `));
            expect(r.errors.join(' '), v).toMatch(/not supported/);
            expect(r.pid).toBeNull();
        }
        // 4.3 has the 4.5 defaults but 3 PID profiles: the fixture's "profile 3" is flagged.
        const r43 = parseBetaflightDiff(D45.replace(' 4.5.1 ', ' 4.3.2 '));
        expect(r43.errors).toEqual([]);
        expect(r43.pid).toEqual(parseBetaflightDiff(D45).pid);
        expect(has(r43.warnings, 'profile 3 does not exist in Betaflight 4.3')).toBe(true);
    });

    it('(f) `diff all bare` and a cut-off `diff all` are refused: the active profile is unknown', () => {
        const bare = D45.replace('# restore original profile selection\nprofile 1\n', '').replace('# restore original rateprofile selection\nrateprofile 2\n', '');
        expect(bare).not.toContain('restore original');
        const r = parseBetaflightDiff(bare);
        expect(r.errors.join(' ')).toMatch(/restore original profile selection/);
        expect(r.errors.join(' ')).toMatch(/restore original rateprofile selection/);
        expect(r.pid).toBeNull();
        // Cut before the profile restore line, and cut between the two restore lines.
        const cutA = D45.slice(0, D45.indexOf('# restore original profile selection'));
        expect(parseBetaflightDiff(cutA).errors.length).toBeGreaterThan(0);
        const cutB = D45.slice(0, D45.indexOf('# restore original rateprofile selection'));
        const rb = parseBetaflightDiff(cutB);
        expect(rb.errors.join(' ')).toMatch(/rateprofile/);
        expect(rb.errors.join(' ')).not.toMatch(/active profile/);
        expect(rb.rates).toBeNull();
    });

    it('(g) invalid profile lines: settings after them are dropped, an invalid active one is refused', () => {
        const mid = `${VERSION_45}\nprofile 0\nset p_roll = 50\nprofile 9\nset p_roll = 99\nprofile -1\nset p_roll = 98\n# restore original profile selection\nprofile 0\nrateprofile 0\n`;
        const r = parseBetaflightDiff(mid);
        expect(r.errors).toEqual([]);
        expect(r.pid!.roll[0]).toBe(50);
        expect(has(r.warnings, 'Ignored "profile 9"')).toBe(true);
        expect(has(r.warnings, 'Ignored "profile -1"')).toBe(true);
        // The same with a rate profile: "rateprofile x" values do not land in rateprofile 0.
        const rate = parseBetaflightDiff(`${VERSION_45}\nprofile 0\nrateprofile 0\nset roll_srate = 80\nrateprofile x\nset roll_srate = 99\n# restore original rateprofile selection\nrateprofile 0\n`);
        expect(rate.errors).toEqual([]);
        expect(rate.rates!.roll.rate).toBe(80);
        // Last selector invalid, or an index this version does not have.
        expect(parseBetaflightDiff(`${VERSION_45}\nprofile 0\nrateprofile x\n`).errors.join(' ')).toMatch(/not a valid index/);
        expect(parseBetaflightDiff(`${VERSION_45}\nprofile 7\nrateprofile 0\n`).errors.length).toBeGreaterThan(0);
        expect(parseBetaflightDiff(`${VERSION_45}\nprofile 4\nrateprofile 0\n`).errors.join(' ')).toMatch(/profiles 0\.\.3/);
        // 2025.12 targets may have 6 rate profiles; 4.5 has 4.
        expect(parseBetaflightDiff(`${VERSION_2025}\nprofile 0\nrateprofile 5\nset roll_srate = 80\n`).rates!.roll.rate).toBe(80);
        expect(parseBetaflightDiff(`${VERSION_45}\nprofile 0\nrateprofile 5\n`).errors.join(' ')).toMatch(/rateprofiles 0\.\.3/);
    });

    it('(h) a paste with no profile lines is refused; chat quote markers are stripped', () => {
        const header = parseBetaflightDiff(`# version\n${VERSION_44}\n`);
        expect(header.errors.join(' ')).toMatch(/No "profile N" line/);
        expect(header.pid).toBeNull();
        const quoted = D45.split('\n').map((l) => `> ${l}`).join('\n');
        expect(parseBetaflightDiff(quoted)).toEqual(parseBetaflightDiff(D45));
    });

    it('(i) edited diffs are refused: a setting twice in one section, or in the wrong section', () => {
        const dup = parseBetaflightDiff(edit(D45, 'set p_roll = 52', 'set p_roll = 52\nset p_roll = 60'));
        expect(dup.errors.join(' ')).toMatch(/p_roll" appears twice/);
        expect(dup.pid).toBeNull();
        const wrong = parseBetaflightDiff(edit(D45, 'set p_roll = 52', 'set p_roll = 52\nset roll_srate = 90'));
        expect(wrong.errors.join(' ')).toMatch(/roll_srate" is a rateprofile setting/);
        const early = parseBetaflightDiff(edit(D45, 'set yaw_deadband = 5', 'set yaw_deadband = 5\nset p_roll = 70'));
        expect(early.errors.join(' ')).toMatch(/master section/);
    });

    it('(j) values a firmware diff cannot contain are refused, not replaced by defaults', () => {
        for (const [from, to] of [
            ['set p_roll = 52', 'set p_roll = 300'],
            ['set p_roll = 52', 'set p_roll = +60'],
            ['set p_roll = 52', 'set p_roll = 5.5'],
            ['set roll_rc_rate = 20', 'set roll_rc_rate = 256'],
            ['set roll_rc_rate = 20', 'set roll_rc_rate = 0'],
            ['set roll_srate = 85', 'set roll_srate = 256'],
            ['set thr_mid = 45', 'set thr_mid = 101'],
            ['set d_max_gain = 40', 'set d_max_gain = 101']
        ]) {
            const r = parseBetaflightDiff(edit(D45, from, to));
            expect(r.errors.length, to).toBe(1);
            expect(r.pid, to).toBeNull();
            expect(r.rates, to).toBeNull();
        }
        expect(parseBetaflightDiff(edit(D45, 'set p_roll = 52', 'set p_roll = +60')).errors[0]).toMatch(/not a whole number/);
        // rate_limit is 200..1998 in the CLI.
        const lim = parseBetaflightDiff(edit(D44, 'set yaw_rate_limit = 1000', 'set yaw_rate_limit = 100'));
        expect(lim.errors.join(' ')).toMatch(/outside the Betaflight range 200\.\.1998/);
        // Zero-width characters and no-break spaces from chat apps are removed first.
        const zw = parseBetaflightDiff(edit(D45, 'set i_roll = 90', 'set i_roll = 9​0'));
        expect(zw.errors).toEqual([]);
        expect(zw.pid!.roll[1]).toBe(90);
    });

    it('(k) rates above the rates-type limit are clamped to it, as validateAndFixRatesSettings does', () => {
        // ACTUAL rc_rate limit 200 (ratesSettingLimits); the CLI accepts up to 255.
        const a = parseBetaflightDiff(edit(D45, 'set roll_rc_rate = 20', 'set roll_rc_rate = 250'));
        expect(a.errors).toEqual([]);
        expect(a.rates!.roll.rcRate).toBe(200);
        expect(a.warnings.filter((w) => w.includes('the firmware clamps it')).length).toBe(1);
        expect(maxRate(a.rates!, 'roll')).toBe(1998); // centre 2000 deg/s, cut by rate_limit
        // BETAFLIGHT srate limit 100.
        const b = parseBetaflightDiff(edit(D44, 'set roll_srate = 72', 'set roll_srate = 150'));
        expect(b.rates!.roll.rate).toBe(100);
        expect(has(b.warnings, 'roll_srate = 150 is above the BETAFLIGHT limit 100')).toBe(true);
        // KISS srate limit 99.
        const k = parseBetaflightDiff(edit(edit(D44, 'set rates_type = BETAFLIGHT', 'set rates_type = KISS'), 'set roll_srate = 72', 'set roll_srate = 100'));
        expect(k.rates!.roll.rate).toBe(99);
        // At the limit: no clamp, no warning.
        const at = parseBetaflightDiff(edit(D45, 'set roll_rc_rate = 20', 'set roll_rc_rate = 200'));
        expect(at.rates!.roll.rcRate).toBe(200);
        expect(has(at.warnings, 'clamps')).toBe(false);
    });
});

describe('Betaflight diff import: other settings', () => {
    it('stick-feel master settings warn; throttle limit warns; unknown settings give one warning', () => {
        const t = edit(edit(D45, 'set yaw_deadband = 5', 'set yaw_deadband = 5\nset mid_rc = 1520'), 'set thr_expo = 25', 'set thr_expo = 25\nset throttle_limit_type = SCALE');
        const r = parseBetaflightDiff(t);
        expect(r.errors).toEqual([]);
        expect(r.warnings.some((w) => w.startsWith('mid_rc = 1520 changes the stick feel'))).toBe(true);
        expect(r.warnings.some((w) => w.startsWith('throttle_limit_type = SCALE is not applied'))).toBe(true);
        expect(r.warnings.filter((w) => w.includes('not used by the simulator')).length).toBe(1);
    });

    it('"set name=value" without spaces is read like the CLI reads it', () => {
        expect(parseBetaflightDiff(edit(D45, 'set p_roll = 52', 'set p_roll=60')).pid!.roll[0]).toBe(60);
    });

    it('a long line of slashes after "#" is handled in linear time', () => {
        const t0 = Date.now();
        const r = parseBetaflightDiff(`#${'/'.repeat(200_000)}\n${D45}`);
        expect(Date.now() - t0).toBeLessThan(2000);
        expect(r.errors).toEqual([]);
        // ...and a paste far larger than any diff is refused outright.
        expect(parseBetaflightDiff(`${D45}\n#${' '.repeat(300_000)}`).errors.join(' ')).toMatch(/Paste one diff only/);
    });
});

describe('Betaflight diff import: round-trip into rates.ts', () => {
    it('4.5 fixture roll (ACTUAL R=20 S=85 E=30) gives the hand-computed setpoints', () => {
        const r = parseBetaflightDiff(D45).rates!;
        // Full stick x=1: center c = 20*10 = 200, m = 85*10 - 200 = 650,
        //   ex = |1| * (1^5 * 0.3 + 1 * 0.7) = 1  ->  200 + 650 = 850 deg/s.
        expect(setpointRate(r.type, 1, r.roll, r.rateLimit)).toBeCloseTo(850, 9);
        // Half stick x=0.5: ex = 0.5 * (0.03125 * 0.3 + 0.5 * 0.7) = 0.1796875,
        //   0.5 * 200 + 650 * 0.1796875 = 100 + 116.796875 = 216.796875 deg/s.
        expect(setpointRate(r.type, 0.5, r.roll, r.rateLimit)).toBeCloseTo(216.796875, 9);
        // Yaw full stick: c = 180, m = 650 - 180 = 470 -> 650 deg/s.
        expect(maxRate(r, 'yaw')).toBeCloseTo(650, 9);
    });

    it('4.4 fixture roll (BETAFLIGHT R=120 S=72 E=10) at full stick', () => {
        const r = parseBetaflightDiff(D44).rates!;
        // x1 = 1*1*0.1 + 1*0.9 = 1; 200 * 1.2 * 1 = 240; super factor 1/(1 - 0.72) -> 857.142857 deg/s.
        expect(maxRate(r, 'roll')).toBeCloseTo(240 / 0.28, 9);
    });
});

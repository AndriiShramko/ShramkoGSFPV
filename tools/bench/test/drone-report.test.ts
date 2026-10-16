// What a Drone physics report sends and what its form says it sends (apps/fly/src/app/builtin/drone-report.ts;
// review R2 of lane D, docs/wip/v08-d.md). The form's line is built from DRONE_REPORT_ITEMS; these claims keep
// it true, each with a negative control that fails the same predicate:
//  - every field of the body (with the settings box ticked: the settings, the flight mode, the input) is named
//    by an item or is one of the form's mechanics (control: the line before review R2, which named only the
//    drone, the words and the e-mail, leaves the scene, the release, the language and the box's three fields
//    unnamed; a field added to the body without an item is caught);
//  - the box's sentence names exactly what the box adds (the settings.* fields), the other sentence the rest;
//  - a drone that is not in the list sends no settings even with the box ticked;
//  - every item has its phrase in the four simulator languages (control: a dictionary without one is caught).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../../../packages/prefs/test/helpers';
import { DRONE_NEW, DRONE_REPORT_ITEMS, bodyFields, droneReportBody, undisclosed } from '../../../apps/fly/src/app/builtin/drone-report';
import type { DroneReportInput } from '../../../apps/fly/src/app/builtin/drone-report';

const FULL: DroneReportInput = {
    message: 'hovers lower than my real one', contact: 'pilot@example.com', drone: 'taurusx8-komodo-6s', betaflight: '# diff all\nset p_roll = 52',
    logUrl: 'https://drive.example.com/log.bbl', locale: 'en', scene: '39e63ce9', release: 'abc123def456', t: 4200, hp: '',
    settings: { changed: { 'physics.twr': 3.1 }, flightMode: 'angle', input: 'hid' }
};
/** the privacy line before review R2: "the drone, what you write and paste here, and your e-mail" */
const BEFORE_R2 = [{ keys: ['drone'] }, { keys: ['message', 'betaflight', 'logUrl'] }, { keys: ['contact'] }];

describe('Drone physics report: the form says what the body carries (review R2)', () => {
    it('every field of a full report, settings box ticked, is named by the line', () => {
        const body = droneReportBody(FULL);
        expect(bodyFields(body)).toEqual(expect.arrayContaining(['scene', 'release', 'locale', 'settings.changed', 'settings.flightMode', 'settings.input']));
        expect(undisclosed(body)).toEqual([]);
    });

    it('control: the line before review R2 leaves the scene, the release, the language and the box\'s fields unnamed', () => {
        expect(undisclosed(droneReportBody(FULL), BEFORE_R2).sort()).toEqual(['locale', 'page', 'release', 'scene', 'settings.changed', 'settings.flightMode', 'settings.input']);
    });

    it('control: a field added to the body or to the settings without an item is caught', () => {
        expect(undisclosed({ ...droneReportBody(FULL), ua: 'Mozilla/5.0' })).toEqual(['ua']);
        expect(undisclosed(droneReportBody({ ...FULL, settings: { ...FULL.settings!, gpu: 'RTX' } as never }))).toEqual(['settings.gpu']);
    });

    it('the box\'s sentence names exactly the settings fields; the other sentence everything else', () => {
        for (const i of DRONE_REPORT_ITEMS) expect(i.keys.every((k) => k.startsWith('settings.') === i.withBox), i.item).toBe(true);
        const box = DRONE_REPORT_ITEMS.filter((i) => i.withBox).flatMap((i) => i.keys).sort();
        expect(box).toEqual(['settings.changed', 'settings.flightMode', 'settings.input']);
    });

    it('without the box, or for a drone not in the list, no settings are sent; empty optional fields are not sent', () => {
        expect(bodyFields(droneReportBody({ ...FULL, settings: undefined })).some((k) => k.startsWith('settings'))).toBe(false);
        expect(bodyFields(droneReportBody({ ...FULL, drone: DRONE_NEW })).some((k) => k.startsWith('settings'))).toBe(false);
        expect(bodyFields(droneReportBody({ ...FULL, logUrl: '', betaflight: '' }))).not.toEqual(expect.arrayContaining(['logUrl']));
        // control: with the box and a listed drone they are sent
        expect(bodyFields(droneReportBody(FULL))).toContain('settings.flightMode');
    });

    it('every item has its phrase, and both sentences take the list, in the four languages; control: a missing phrase is caught', () => {
        const dict = (l: string): Record<string, string> => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'dronetune', `${l}.json`), 'utf8'));
        const missing = (d: Record<string, string>): string[] => [
            ...DRONE_REPORT_ITEMS.map((i) => `fb.drone.sends.${i.item}`).filter((k) => typeof d[k] !== 'string' || !d[k].trim()),
            ...['fb.drone.sent', 'fb.drone.sentBox'].filter((k) => !d[k]?.includes('{list}'))
        ];
        for (const l of ['en', 'es', 'pl', 'ru']) expect(missing(dict(l)), l).toEqual([]);
        const broken = { ...dict('pl') };
        delete broken['fb.drone.sends.input'];
        expect(missing(broken)).toEqual(['fb.drone.sends.input']);
    });
});

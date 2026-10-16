// What a Drone physics report sends, and how the form tells the pilot (review R2 of lane D, docs/wip/v08-d.md).
// Pure, so the Node tests can check it (tools/bench/test/drone-report.test.ts); the form is feedback.ts.
//
// The rule: the form's privacy line is built from DRONE_REPORT_ITEMS, and every field of the body that
// droneReportBody builds is covered by an item (or is one of the form's own mechanics, which carry nothing
// about the pilot). A field added to the body without an item fails the test, so the line cannot drift from
// what is really sent again (it said "the drone, the text and the e-mail, nothing else" while the body also
// carried the scene, the release, the language and, with the box ticked, the flight mode and the input).
// Each item is one phrase in the four languages: fb.drone.sends.<item> in locales/fly/dronetune.

/** The drone select's value for a drone that is not in the list (server.py DRONE_NEW). */
export const DRONE_NEW = 'new';
/** The API's limits of a drone-physics report (server.py DRONE_TUNE_TEXT_MAX, DRONE_LOG_URL_MAX). */
export const BETAFLIGHT_MAX = 100_000;
export const LOG_URL_MAX = 500;
/** A blackbox log's link: http or https, as the API keeps it (server.py _LOG_URL_RE). */
export const LOG_URL_RE = /^https?:\/\/[^\s<>"'`]{3,}$/i;

/** The pilot's simulator settings for the drone, sent when the form's box is ticked. */
export interface DroneSettings {
    /** the settings the pilot changed for this drone: id -> value */
    changed: Record<string, unknown>;
    /** the flight mode flown (acro / angle / horizon) */
    flightMode: unknown;
    /** the input flown with (radio, gamepad, keyboard, touch), or null */
    input: string | null;
}

/** Everything the form puts into one report; strings already trimmed and cut to their limits. */
export interface DroneReportInput {
    message: string;
    contact: string;
    drone: string;
    betaflight: string;
    logUrl: string;
    locale: string;
    scene: string;
    release: string;
    /** ms from opening the form to sending (the API's time-to-submit check) */
    t: number;
    /** the honeypot field's value: people never see it, so it is empty */
    hp: string;
    /** the box ticked and a drone from the list: the pilot's settings */
    settings?: DroneSettings;
}

/**
 * The phrases of the privacy line, in its order. `keys`: the body fields the phrase names (`settings.<k>` for
 * a field of the settings); `withBox`: sent only with the settings box ticked (the line says so).
 */
export const DRONE_REPORT_ITEMS: readonly { item: string; keys: readonly string[]; withBox: boolean }[] = [
    { item: 'drone', keys: ['drone'], withBox: false },
    { item: 'words', keys: ['message', 'betaflight', 'logUrl'], withBox: false },
    { item: 'email', keys: ['contact'], withBox: false },
    { item: 'scene', keys: ['scene', 'page'], withBox: false },
    { item: 'version', keys: ['release', 'locale'], withBox: false },
    { item: 'settings', keys: ['settings.changed'], withBox: true },
    { item: 'mode', keys: ['settings.flightMode'], withBox: true },
    { item: 'input', keys: ['settings.input'], withBox: true }
];

/** Body fields that are the form's own mechanics and carry nothing about the pilot: the report's kind, the time to send, the empty spam trap. */
export const DRONE_REPORT_MECHANICS: readonly string[] = ['kind', 't', 'hp'];

/** The POST /api/report body of a Drone physics report. */
export function droneReportBody(i: DroneReportInput): Record<string, unknown> {
    return {
        kind: 'drone', message: i.message, contact: i.contact, locale: i.locale, page: 'fly', scene: i.scene, release: i.release, t: i.t, hp: i.hp,
        drone: i.drone, logUrl: i.logUrl || undefined, betaflight: i.betaflight || undefined,
        settings: i.settings && i.drone !== DRONE_NEW ? i.settings : undefined
    };
}

/** The fields a body really carries (undefined ones are not sent by JSON), settings flattened to `settings.<k>`. */
export function bodyFields(body: Record<string, unknown>): string[] {
    const out: string[] = [];
    for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        if (k === 'settings' && typeof v === 'object' && v !== null) for (const [s, sv] of Object.entries(v)) { if (sv !== undefined) out.push(`settings.${s}`); }
        else out.push(k);
    }
    return out;
}

/** The fields of `body` the privacy line built from `items` does not name (empty when it tells the whole truth). */
export function undisclosed(body: Record<string, unknown>, items: readonly { keys: readonly string[] }[] = DRONE_REPORT_ITEMS): string[] {
    const named = new Set([...DRONE_REPORT_MECHANICS, ...items.flatMap((i) => i.keys)]);
    return bodyFields(body).filter((k) => !named.has(k));
}

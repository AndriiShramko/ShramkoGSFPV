// Who is recording and what they agreed to (docs/wip/v12-plan.md section 4.3 step 2; spec section 10 of the sound
// package). The pilot's profile is a random id, an optional nickname (never required, never a name by design), and what
// the helper says about the session: whether the pilot is under 18, whether a parent's signed consent was confirmed, the
// headphones. It is kept in this browser (localStorage) so a helper does not enter it again; it names no one.
//
// The consent of one recording is built from it: recording on, voice only when the microphone was allowed, sending and
// speech recognition off (each is a separate confirmation of its own, later), and for a minor the guardian's confirmation
// recorded as the sound package's validator demands: a minor's package cannot claim consent to send, or to use speech
// recognition, without a guardian's signed consent confirmed by the helper.
import type { Consent, DeviceInfo } from '@shramko/sonic-fpv';
import { newPilotId } from '@shramko/sonic-fpv';

export const PROFILE_KEY = 'gsfpv.sonicrec.profile';
export const NICKNAME_MAX = 40;

export interface PilotProfile {
    /** random, 8 to 64 URL-safe characters; names no one */
    readonly id: string;
    /** optional, at most NICKNAME_MAX characters, no control characters */
    readonly nickname: string | null;
    /** the pilot is under 18 */
    readonly minor: boolean;
    /** the helper confirmed a parent's or guardian's signed consent (only meaningful for a minor) */
    readonly guardianConfirmed: boolean;
    readonly headphones: DeviceInfo['headphones'];
    /** ids of the surveys the pilot has finished or declined, to choose first flight or returning pilot */
    readonly surveysSeen: readonly string[];
}

/** The part of Storage the profile needs. */
export interface KeyValue {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const HEADPHONES: readonly DeviceInfo['headphones'][] = ['wired', 'bluetooth', 'speakers', 'unknown'];

/** A nickname the package accepts: trimmed, control characters dropped, cut to the limit; empty is null. */
export function cleanNickname(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NICKNAME_MAX).trim();
    return s === '' ? null : s;
}

export function newProfile(random?: (n: number) => Uint8Array): PilotProfile {
    return { id: newPilotId(random), nickname: null, minor: false, guardianConfirmed: false, headphones: 'unknown', surveysSeen: [] };
}

/** The stored profile, repaired field by field; a new one when nothing usable is stored. Never throws. */
export function loadProfile(store: KeyValue | null, random?: (n: number) => Uint8Array): PilotProfile {
    let raw: unknown = null;
    try {
        const text = store?.getItem(PROFILE_KEY) ?? null;
        raw = text === null ? null : JSON.parse(text);
    } catch {
        raw = null;
    }
    const base = newProfile(random);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return base;
    const r = raw as Record<string, unknown>;
    const id = typeof r['id'] === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(r['id']) ? r['id'] : base.id;
    const headphones = HEADPHONES.find((h) => h === r['headphones']) ?? 'unknown';
    const seen = Array.isArray(r['surveysSeen']) ? r['surveysSeen'].filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80).slice(0, 20) : [];
    return { id, nickname: cleanNickname(r['nickname']), minor: r['minor'] === true, guardianConfirmed: r['minor'] === true && r['guardianConfirmed'] === true, headphones, surveysSeen: seen };
}

export function saveProfile(store: KeyValue | null, profile: PilotProfile): void {
    try {
        store?.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
        // private window or storage full: the profile is for this page only
    }
}

/** The profile with some fields changed, repaired the way loadProfile repairs a stored one. */
export function withProfile(profile: PilotProfile, change: Partial<Omit<PilotProfile, 'id'>>): PilotProfile {
    const minor = change.minor ?? profile.minor;
    return {
        id: profile.id,
        nickname: change.nickname === undefined ? profile.nickname : cleanNickname(change.nickname),
        minor,
        guardianConfirmed: minor && (change.guardianConfirmed ?? profile.guardianConfirmed),
        headphones: change.headphones ?? profile.headphones,
        surveysSeen: change.surveysSeen ?? profile.surveysSeen
    };
}

/**
 * The consent of one recording. `voice`: the microphone was allowed. `send` and `speechRecognition` start false and are
 * set only by their own confirmation. For a minor, `guardianConfirmed` is the helper's confirmation (true or false, never
 * null); for an adult it is null.
 */
export function consentFor(profile: PilotProfile, o: { readonly voice: boolean; readonly at: string; readonly send?: boolean; readonly speechRecognition?: boolean }): Consent {
    const send = o.send === true;
    const speechRecognition = o.speechRecognition === true;
    if (profile.minor) {
        const guardian = profile.guardianConfirmed;
        // what leaves the device needs the guardian's confirmation first: refused here, so a package never claims it
        if (!guardian && (send || speechRecognition)) throw new Error('a minor cannot consent to send or to speech recognition without a guardian\'s confirmed consent');
        return { recording: true, voice: o.voice, send, speechRecognition, minor: true, guardianConfirmed: guardian, at: o.at };
    }
    return { recording: true, voice: o.voice, send, speechRecognition, minor: false, guardianConfirmed: null, at: o.at };
}

/** May this profile's recordings be sent (or its audio given to the browser's speech recognition)? */
export function mayLeaveDevice(profile: PilotProfile): boolean {
    return !profile.minor || profile.guardianConfirmed;
}

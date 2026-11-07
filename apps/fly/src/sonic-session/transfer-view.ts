// What the helper's panel says about the sending of one recording (docs/wip/v12-plan.md section 4.3 step 8): a pure function from what the
// device remembers (upload.json) and what the running transfer reports now, to one line of meaning. No texts here: the panel puts the words
// to it from the dictionaries. The rule that matters is the order of the claims: "delivered" only when the record or the live progress
// shows BOTH channels confirmed, "on the server" only when the server's own answer said stored.
import type { SessionEntry } from './registry';
import type { PilotProfile } from './consent';
import { CHANNELS, allConfirmed } from './upload';
import type { ChannelState, TransferProgress, TransferRecord } from './upload';

export type TransferLine =
    | { readonly kind: 'none' }
    /** reading the package, asking for an upload, or the server checking it */
    | { readonly kind: 'working' }
    | { readonly kind: 'uploading'; readonly done: number; readonly of: number }
    | { readonly kind: 'waiting'; readonly problem: string; readonly retryAt: number | null }
    /** `ref`: the server's id of the recording, which a pilot or a parent quotes to ask for its deletion */
    | { readonly kind: 'stored'; readonly channels: Readonly<Record<string, ChannelState>> | null; readonly problem: string | null; readonly ref: string | null }
    | { readonly kind: 'delivered'; readonly channels: Readonly<Record<string, ChannelState>> | null; readonly ref: string | null }
    | { readonly kind: 'blocked'; readonly reason: string };

/** `live`: the progress of a transfer that is running in this page, if any. */
export function transferLine(record: TransferRecord | null, live: TransferProgress | null): TransferLine {
    if (live !== null) {
        const channels = live.channels ?? record?.channels ?? null;
        const ref = live.serverId ?? record?.serverId ?? null;
        switch (live.stage) {
            case 'preparing':
            case 'starting':
            case 'finishing':
                return { kind: 'working' };
            case 'uploading':
                return { kind: 'uploading', done: live.chunksDone, of: live.chunks };
            case 'waiting':
                // a failure after the server stored it does not undo that: it is waiting to read the delivery again
                if (live.stored) return { kind: 'stored', channels, problem: live.problem, ref };
                return { kind: 'waiting', problem: live.problem ?? 'network', retryAt: live.retryAt };
            case 'stored':
                return { kind: 'stored', channels, problem: live.problem, ref };
            case 'delivered':
                return allConfirmed(channels) ? { kind: 'delivered', channels, ref } : { kind: 'stored', channels, problem: null, ref };
            case 'blocked':
                return { kind: 'blocked', reason: live.problem ?? 'unknown' };
            case 'stopped':
                break; // the page let it go: what the record says is all there is
        }
    }
    if (record === null) return { kind: 'none' };
    if (record.blocked !== null) return { kind: 'blocked', reason: record.blocked };
    if (record.delivered && allConfirmed(record.channels)) return { kind: 'delivered', channels: record.channels, ref: record.serverId };
    if (record.stored) return { kind: 'stored', channels: record.channels, problem: null, ref: record.serverId };
    return { kind: 'waiting', problem: 'interrupted', retryAt: null };
}

/** The channels in the server's order, each with its state; a channel the server has not reported yet is 'queued'. */
export function channelList(channels: Readonly<Record<string, ChannelState>> | null): { readonly name: string; readonly status: string }[] {
    return CHANNELS.map((name) => ({ name, status: channels?.[name]?.status ?? 'queued' }));
}

export type SendBlocker = 'unreadable' | 'unfinished' | 'locked' | 'guardian';

/**
 * Why a recording must not be sent now, or null. The package's own consent decides (the server reads it too): a minor's recording
 * needs the guardian's confirmation recorded in it. The pilot's profile is looked at as well, one way only: when it is the same pilot
 * and says under 18 without the guardian's confirmation now, the recording is held back (the helper corrected it after the flight).
 */
export function sendBlocker(entry: SessionEntry, profile: PilotProfile): SendBlocker | null {
    if (entry.state === 'unfinished') return 'unfinished';
    if (entry.state !== 'finished' || entry.manifest === null) return 'unreadable';
    if (entry.locked) return 'locked';
    const consent = entry.manifest.consent;
    if (consent.minor && consent.guardianConfirmed !== true) return 'guardian';
    if (profile.id === entry.manifest.pilot.id && profile.minor && !profile.guardianConfirmed) return 'guardian';
    return null;
}

/** May the voice be listened to for this recording's sending? Only when it was allowed, and for a minor only with the guardian's confirmation. */
export function mayListen(entry: SessionEntry, profile: PilotProfile): boolean {
    if (!profile.speechRecognition) return false;
    const consent = entry.manifest?.consent;
    if (consent === undefined) return false;
    return !consent.minor || consent.guardianConfirmed === true;
}

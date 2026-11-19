// The page's head-tracking switch (lane head4): the browser's camera, permission and visibility, the mode's voice and the
// lazy tracking module, given to HeadSwitch (switch.ts). Made once per sound setup (sonic/start.ts and sonic/in-place.ts call
// attachHead), so the start screen's row and the flight's recentre key drive the same switch.
import { keysFor } from '@gsfpv/prefs';
import { t } from '../../i18n';
import type { SonicSetup } from '../entry';
import type { ListenerLike } from './listener-turn';
import { HeadSwitch } from './switch';
import type { CameraPermission, HeadSay } from './switch';
import type { HeadLineId, HeadTracker, MediaLike } from './types';

/** The key that centres the head, as the lines name it. */
export const HEAD_CENTRE_ACTION = 'sonic.headCentre';

/** ms a line takes to read when no voice says it (a screen reader reads the caption): about 14 characters a second, at most 12 s */
export function readMs(text: string): number {
    return Math.min(12_000, 600 + text.length * 70);
}

/** The text of a head line in the page's language. */
export function headLine(id: HeadLineId): string {
    const key = keysFor(HEAD_CENTRE_ACTION, { sonic: true })[0]?.cap ?? 'Shift+H';
    return t(`sonichead.say.${id}`, { key });
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The face tracker (stage H3 brings it; until then a start reports 'failed' and the setting goes back off, said). */
function loadTracker(): Promise<HeadTracker> {
    return Promise.reject(new Error('the face tracker arrives with stage H3'));
}

async function cameraPermission(): Promise<CameraPermission> {
    try {
        const p = await navigator.permissions.query({ name: 'camera' as PermissionName });
        return p.state;
    } catch {
        return 'unknown';
    }
}

export function attachHead(setup: SonicSetup): HeadSwitch {
    const say: HeadSay = async (id, o = {}) => {
        const text = headLine(id);
        // with "my screen reader speaks" the reader reads the caption: the line is waited for by its length
        const voiced = setup.audio.engine.say({ key: 'sonic.say.text', params: { text } }, { interrupt: o.interrupt === true }).catch(() => wait(readMs(text)));
        await Promise.all([voiced, setup.prefs.selfVoice ? null : wait(readMs(text))]);
    };
    const head = new HeadSwitch({
        host: setup.host,
        say,
        permission: cameraPermission,
        load: () => import('./tracking'),
        doc: document,
        media: () => (navigator.mediaDevices as MediaLike | undefined) ?? null,
        tracker: loadTracker,
        listener: () => {
            const ac = setup.audio.ac as unknown as { listener?: ListenerLike; currentTime?: number } | null;
            return ac?.listener ? { listener: ac.listener, now: ac.currentTime ?? 0 } : null;
        },
        narrator: () => setup.prefs.narrator !== false
    });
    setup.head = head;
    void head.resume();
    return head;
}

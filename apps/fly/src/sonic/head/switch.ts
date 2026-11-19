// The pilot's "Turn my head to listen" (lane head4, docs/wip/sonic-headtrack-plan.md 1.3): a web camera follows the head so
// the sounds stay where they are in the world while the head turns. OFF unless the pilot turns it on in the sound settings
// (start-screen.ts, one row). This file is the setting and the way in, and nothing more: the tracking itself (the camera,
// the face tracker, the pose filter, the listener's turn) is the lazy module ./tracking, imported only when the pilot turns
// the setting on, or at load when it was left on and the browser already allows the camera. With the setting off the page
// loads no head code and never touches the camera.
//
// Switching on speaks first (what the camera is for, that no picture leaves the computer, that the browser will ask) and only
// then asks for the camera; the result is spoken. A refusal turns the setting back off and says what to do. The saved choice
// lives in the prefs collection 'sonic' (packages/prefs doc.ts SonicState.headTrack: absent means off).
import type { SonicHost } from '../store';
import type { HeadResult, HeadTrackingDeps, HeadTrackingLike } from './types';

/** The setting is on (saved): false unless the pilot turned it on. */
export function headTrackOn(host: SonicHost): boolean {
    return host.collection('sonic').headTrack === true;
}

/** Saves the setting (only when it changes; off is no entry). */
export function setHeadTrack(host: SonicHost, on: boolean): void {
    if (headTrackOn(host) === on) return;
    host.updateCollection('sonic', (d) => {
        if (on) d.headTrack = true;
        else delete d.headTrack;
    });
}

/** The browser's answer to "may this page use the camera" without asking (Permissions API); 'unknown' where it gives none. */
export type CameraPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** A line said for the pilot: resolves when it was said (or could not be). */
export type HeadSay = HeadTrackingDeps['say'];

/** What the switch needs of the page. */
export interface HeadSwitchDeps extends HeadTrackingDeps {
    readonly host: SonicHost;
    readonly permission: () => Promise<CameraPermission>;
    /** the lazy module (./tracking); a test gives its own */
    readonly load: () => Promise<{ createHeadTracking(d: HeadTrackingDeps): HeadTrackingLike }>;
    /** the page's visibility: the camera stops while the page is hidden */
    readonly doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | null;
}

export class HeadSwitch {
    private tracking: HeadTrackingLike | null = null;
    /** the camera should run (the setting is on and the last start did not fail) */
    private wanted = false;
    private busy: Promise<unknown> = Promise.resolve();
    private readonly onVisibility = (): void => void this.follow();

    constructor(private readonly d: HeadSwitchDeps) {
        d.doc?.addEventListener('visibilitychange', this.onVisibility);
    }

    /** the saved setting */
    get on(): boolean {
        return headTrackOn(this.d.host);
    }

    /** the tracking module is loaded and the camera runs */
    get running(): boolean {
        return this.tracking?.running === true;
    }

    /**
     * At page load: a setting left on starts again only when the browser already allows the camera (no question at load);
     * otherwise it is turned off, and switching it on again asks with the spoken explanation first.
     */
    async resume(): Promise<void> {
        if (!this.on) return;
        if ((await this.d.permission()) !== 'granted') {
            setHeadTrack(this.d.host, false);
            return;
        }
        this.wanted = true;
        const r = await this.start();
        if (r !== 'on') this.refused(r, false);
    }

    /** The pilot switched the setting: on speaks, asks, says the result (true: it runs); off stops the camera and says so. */
    async set(on: boolean): Promise<boolean> {
        if (!on) {
            this.wanted = false;
            setHeadTrack(this.d.host, false);
            this.tracking?.stop();
            await this.d.say('off', { interrupt: true });
            return false;
        }
        setHeadTrack(this.d.host, true);
        this.wanted = true;
        // the explanation is heard before the browser's question appears
        await this.d.say('ask', { interrupt: true });
        if (!this.wanted) return false;
        const r = await this.start();
        // switched off while the browser asked: the off line was said already
        if (!this.wanted) return false;
        if (r === 'on') {
            await this.d.say('on', { interrupt: true });
            return true;
        }
        this.refused(r, true);
        return false;
    }

    /** The recentre key: the next face seen is straight ahead. Off: says how to turn it on (never a key that does nothing). */
    recentre(): void {
        if (!this.running || !this.tracking) {
            void this.d.say('keyOff', { interrupt: true });
            return;
        }
        this.tracking.recentre();
    }

    dispose(): void {
        this.d.doc?.removeEventListener('visibilitychange', this.onVisibility);
        this.wanted = false;
        this.tracking?.stop();
    }

    private refused(r: Exclude<HeadResult, 'on'>, said: boolean): void {
        this.wanted = false;
        setHeadTrack(this.d.host, false);
        this.tracking?.stop();
        if (said || r !== 'denied') void this.d.say(r, { interrupt: true });
    }

    /** the page hidden: the camera stops; shown again with the setting on: it starts again (already allowed: no question) */
    private follow(): Promise<unknown> {
        const hidden = this.d.doc?.visibilityState === 'hidden';
        if (hidden) {
            this.tracking?.stop();
            return Promise.resolve();
        }
        if (!this.wanted || this.running) return Promise.resolve();
        return this.start().then((r) => {
            if (r !== 'on' && this.wanted) this.refused(r, true);
        });
    }

    /** one start at a time: a second press while the camera opens waits for the first */
    private start(): Promise<HeadResult> {
        const run = this.busy.then(async (): Promise<HeadResult> => {
            if (this.running) return 'on';
            if (!this.tracking) {
                try {
                    const m = await this.d.load();
                    this.tracking = m.createHeadTracking(this.d);
                } catch {
                    return 'failed';
                }
            }
            if (!this.wanted) return 'failed';
            return this.tracking.start();
        });
        this.busy = run.catch(() => undefined);
        return run;
    }
}

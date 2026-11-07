// Unfinished recordings offered again at the next start (docs/wip/v12-plan.md section 4.3 step 3; spec section 7: "an unfinished
// session is offered again next time"). A tab that was closed or crashed in the middle of a recording left its session in the
// browser's storage; at the next start of the sound mode the app says so (the package's line rec.recover: "An earlier flight was
// not finished. Press T to keep it."), and a press of T keeps the oldest one: the package's recoverSession brings it back to a
// readable session that is marked as not complete. Nothing is deleted by not answering: an unkept session is offered again at the
// next start. Keys: while an offer waits and no recording runs, T answers the offer, never starts a recording.
import type { SpeechLine } from '@shramko/sonic-fpv';
import type { SessionEntry } from './registry';
import { keepSession, listSessions } from './registry';
import type { SessionStores } from './recorder';

export interface ResumeDeps {
    stores: SessionStores;
    /** another tab is recording the session */
    isLocked(id: string): Promise<boolean>;
    nowIso(): string;
    /** a spoken line; never awaited */
    say(line: SpeechLine): void;
    keyLabel(code: string): string;
    gzip?: (b: Uint8Array) => Promise<Uint8Array>;
    /** the offer list changed (the panel redraws) */
    onChange?(): void;
}

export class ResumeOffer {
    private offered: string[] = [];
    private scanned = false;

    constructor(private readonly deps: ResumeDeps) {}

    /** Sessions waiting for an answer, oldest first. */
    get pending(): readonly string[] {
        return this.offered;
    }

    /**
     * Looks for unfinished sessions (none being recorded by another tab) and speaks the offer for the first. Once per page: a
     * second call returns what is still pending. Never throws: a storage that cannot be read offers nothing.
     */
    async scan(): Promise<readonly string[]> {
        if (this.scanned) return this.offered;
        this.scanned = true;
        try {
            const entries = await listSessions(this.deps.stores, this.deps.isLocked);
            const waiting = entries.filter((e) => e.state === 'unfinished' && !e.locked).sort((a, b) => Date.parse((a.manifest as { created: string }).created) - Date.parse((b.manifest as { created: string }).created));
            this.offered = waiting.map((e) => e.id);
        } catch {
            this.offered = [];
        }
        if (this.offered.length > 0) this.speakOffer();
        this.deps.onChange?.();
        return this.offered;
    }

    private speakOffer(): void {
        this.deps.say({ key: 'rec.recover', params: { key: this.deps.keyLabel('KeyT') } });
    }

    /** The pilot pressed T: keep the oldest offered session. Resolves with its entry, or null when nothing waits or it could not be kept. */
    async keepNext(): Promise<SessionEntry | null> {
        const id = this.offered[0];
        return id === undefined ? null : this.keep(id);
    }

    /** Keeps a session (the pilot's key or the helper's button), offered or not; says it is saved, and offers the next one. */
    async keep(id: string): Promise<SessionEntry | null> {
        this.offered = this.offered.filter((x) => x !== id);
        try {
            await keepSession(this.deps.stores, id, this.deps.isLocked, this.deps.nowIso, this.deps.gzip === undefined ? {} : { gzip: this.deps.gzip });
        } catch {
            this.deps.onChange?.();
            return null;
        }
        this.deps.say({ key: 'rec.saved' });
        if (this.offered.length > 0) this.speakOffer();
        this.deps.onChange?.();
        const entries = await listSessions(this.deps.stores, this.deps.isLocked).catch(() => [] as SessionEntry[]);
        return entries.find((e) => e.id === id) ?? null;
    }

    /** Not now: the session stays as it is (and is offered at the next start). */
    dismiss(id: string): void {
        this.offered = this.offered.filter((x) => x !== id);
        this.deps.onChange?.();
    }

    /** A session was deleted or kept elsewhere: it is no longer waiting. */
    forget(id: string): void {
        if (this.offered.includes(id)) this.dismiss(id);
    }
}

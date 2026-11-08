// The replay as the helper uses it (docs/wip/v12-plan.md section 4.3 step 5): open a recording (a file, or a session kept in this browser),
// check it against the lesson with the sound package's comparer, play it with the cues and the pilot's voice, pause, seek, close. This file
// is the state machine between the pieces: replay-open (the bytes), replay-check (the comparer), replay-player (the clock), replay-host
// (the page). The view (replay-view.ts) draws `state` and calls these methods; every sentence in it is already in the page's language.
import './texts';
import type { PackageProblem, SessionPackage } from '@shramko/sonic-fpv';
import { t } from '../i18n';
import { formatClock } from './format';
import type { SessionStores } from './recorder';
import { checkPackage } from './replay-check';
import type { CheckRun, ReplayOutcome } from './replay-check';
import type { ReplayHost } from './replay-host';
import { openFile, openSession } from './replay-open';
import type { Opened } from './replay-open';
import { ReplayPlayer } from './replay-player';
import type { ReplayState, ReplayTrace } from './replay-player';

export interface ReplayViewState {
    readonly stage: 'closed' | 'loading' | 'error' | 'ready';
    /** what is replayed: the lesson and when it was flown */
    readonly title: string;
    readonly error: string | null;
    readonly player: ReplayState | null;
    readonly check: { readonly ok: boolean; readonly summary: string } | null;
    /** sentences the helper should read: no voice, the voice could not be decoded, another place on screen, a damaged file */
    readonly notes: readonly string[];
    /** the package's own English report of the check, and its notes: for the details element */
    readonly details: string;
}

const CLOSED: ReplayViewState = { stage: 'closed', title: '', error: null, player: null, check: null, notes: [], details: '' };

/** One lesson of the recording as the check found it (the numbers behind the panel's sentence), for the acceptance runs. */
export interface LessonCheckRow {
    readonly lesson: string | null;
    readonly frames: number;
    /** false: the lead of a recording of several lessons, replayed and not compared */
    readonly compared: boolean;
    readonly ok: boolean | null;
    readonly recorded: number;
    readonly matched: number;
    readonly diffs: number;
    readonly cueShare: number | null;
    readonly cueClassShare: number | null;
}

export interface ReplayControlDeps {
    host: ReplayHost;
    stores: SessionStores;
    /** the page's language for a date */
    formatWhen(iso: string): string;
    onChange(s: ReplayViewState): void;
    /** options of the check (tests make it small) */
    checkRun?: CheckRun;
}

export class ReplayControl {
    private readonly deps: ReplayControlDeps;
    private player: ReplayPlayer | null = null;
    private offFrames: (() => void) | null = null;
    private offLost: (() => void) | null = null;
    private token = 0;
    private view: ReplayViewState = CLOSED;
    private rows: readonly LessonCheckRow[] = [];

    constructor(deps: ReplayControlDeps) {
        this.deps = deps;
    }

    get state(): ReplayViewState {
        return this.player === null ? this.view : { ...this.view, player: this.player.state };
    }

    get active(): boolean {
        return this.player !== null;
    }

    /** The lessons of the recording opened last, as the check found them. */
    get checks(): readonly LessonCheckRow[] {
        return this.rows;
    }

    /** What the open replay did (frames fed, lessons shown, the voice started), on the audio clock; null with none open. */
    get trace(): ReplayTrace | null {
        return this.player?.trace ?? null;
    }

    private set(next: ReplayViewState): void {
        this.view = next;
        this.deps.onChange(this.state);
    }

    async openSession(id: string): Promise<void> {
        await this.begin(openSession(this.deps.stores, id));
    }

    async openFile(file: Blob): Promise<void> {
        await this.begin(openFile(file));
    }

    private async begin(opening: Promise<Opened>): Promise<void> {
        this.close();
        const mine = ++this.token;
        this.set({ ...CLOSED, stage: 'loading' });
        const opened = await opening;
        if (mine !== this.token) return;
        const link = this.deps.host.link();
        if (link === null) return this.fail(t('sonicrec.replay.noruntime'));
        if (!opened.ok) return this.fail(t('sonicrec.replay.error', { reason: opened.error }));
        const pkg = opened.pkg;
        const m = pkg.manifest;
        // a scan's world is the simulator's: handed in when it is the one on screen, else the replay runs without one (no hazard cues);
        // a recording of several lessons is checked and played lesson by lesson, a scan lesson's world asked of the page (v12-int step 5)
        const world = m.scene.kind !== 'none' && link.world !== null && link.world.id === m.scene.id ? link.world : null;
        const outcome = await checkPackage(pkg, { ...(this.deps.checkRun ?? {}), world, ...(link.scanWorld === undefined ? {} : { scanWorld: link.scanWorld }) });
        if (mine !== this.token) return;
        if (outcome.setup === null) return this.fail(t('sonicrec.replay.check.none', { reason: outcome.error?.message ?? '' }));
        this.rows = outcome.segments.map((s) => ({
            lesson: s.segment.lessonId,
            frames: s.segment.frames.length,
            compared: s.check !== null,
            ok: s.check?.ok ?? null,
            recorded: s.check?.events.recorded ?? 0,
            matched: s.check?.events.matched ?? 0,
            diffs: s.check?.events.diffs.length ?? 0,
            cueShare: s.check?.cues.share ?? null,
            cueClassShare: s.check?.cues.classShare ?? null
        }));
        const player = new ReplayPlayer({ ...link.deps, onChange: () => this.deps.onChange(this.state) }, pkg, outcome.segments);
        await player.prepare();
        if (mine !== this.token) {
            player.close();
            return;
        }
        this.player = player;
        this.offFrames = this.deps.host.frames(() => player.tick());
        this.offLost = this.deps.host.lost(() => this.close());
        const notes: string[] = [];
        if (opened.lenient) notes.push(t('sonicrec.replay.problems', { n: opened.problems.length }));
        if (pkg.voice === null) notes.push(t('sonicrec.replay.voice.none'));
        else if (player.state.voice === 'failed') notes.push(t('sonicrec.replay.voice.failed'));
        // the picture is the recording's place when the page draws every lesson of it (the flight side's view), or, on a page that
        // draws no lessons, when the world on screen is the recording's
        const canShow = link.canShow;
        const samePlace =
            canShow !== undefined
                ? outcome.segments.every((s) => canShow(s.setup.lesson, s.setup.world))
                : m.scene.kind === 'scan'
                  ? link.sceneId === m.scene.id
                  : outcome.setup.world === null || link.world?.id === outcome.setup.world.id;
        if (!samePlace) notes.push(t('sonicrec.replay.world.other'));
        this.set({ stage: 'ready', title: this.titleOf(pkg, outcome), error: null, player: player.state, check: this.summary(outcome), notes, details: this.detailsOf(outcome, opened.problems) });
    }

    private titleOf(pkg: SessionPackage, outcome: ReplayOutcome): string {
        const m = pkg.manifest;
        const ids = outcome.segments.length > 1 ? outcome.segments.map((s) => s.segment.lessonId ?? t('sonicrec.replay.freeflight')) : [m.lesson?.id ?? t('sonicrec.replay.freeflight')];
        return `${ids.join(', ')} · ${this.deps.formatWhen(m.created)}`;
    }

    private summary(outcome: ReplayOutcome): { ok: boolean; summary: string } | null {
        const c = outcome.check;
        if (c === null) return null;
        const vars = { matched: c.events.matched, recorded: c.events.recorded, cues: Math.round(c.cues.share * 100), diffs: c.events.diffs.length };
        return { ok: c.ok, summary: t(c.ok ? 'sonicrec.replay.check.pass' : 'sonicrec.replay.check.fail', vars) };
    }

    private detailsOf(outcome: ReplayOutcome, problems: readonly PackageProblem[]): string {
        const notes = outcome.segments.flatMap((s) => s.setup.notes.map((n) => (outcome.segments.length > 1 ? `${s.segment.lessonId ?? '-'}: ${n.code}: ${n.message}` : `${n.code}: ${n.message}`)));
        const lines = [outcome.line, ...notes, ...problems.map((p) => `${p.code}: ${p.message}`)];
        return lines.filter((l) => l !== '').join('\n');
    }

    private fail(message: string): void {
        this.set({ ...CLOSED, stage: 'error', error: message });
    }

    play(): void {
        this.player?.play();
    }

    pause(): void {
        this.player?.pause();
    }

    toggle(): void {
        if (this.player?.state.phase === 'playing') this.pause();
        else this.play();
    }

    seek(ms: number): void {
        this.player?.seek(ms);
        this.deps.onChange(this.state);
    }

    /** Lets go of the page: the voice, the engine's settings, the camera, the flight. Safe to call at any time. */
    close(): void {
        this.token++;
        this.offFrames?.();
        this.offLost?.();
        this.offFrames = this.offLost = null;
        const had = this.player !== null;
        this.player?.close();
        this.player = null;
        if (had || this.view.stage !== 'closed') this.set(CLOSED);
    }

    /** `0:12 of 0:47` for the toggle button and the position text. */
    static clock(s: ReplayState): string {
        return t('sonicrec.replay.time', { now: formatClock(s.tMs), total: formatClock(s.durationMs) });
    }
}

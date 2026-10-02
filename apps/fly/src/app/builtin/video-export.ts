// "Save this flight as video (60 fps)" (docs/architecture-v03.md F.3, F.4; item 19, D34). A row of
// the summary panel offers it with the size (1080p, 1440p, 4K); the life is replayed from its log at
// exactly 1/60 s per frame and each frame is encoded once the engine drew it with the scan complete
// for that view (../../videoexport.ts). Meanwhile the flight holds the pause reason 'export', the
// canvas draws at exactly the video's size with cinema's full detail, the camera is the replay's
// (or the replay's own crash view, on the replay's clock), and a bar at the bottom shows the frames
// done with Cancel (Esc). The file goes where a recording goes (recording.ts: the folder, the
// browser's storage, memory) with the credit burned in. Showcase scenes only, like recording (D34).
import { S } from '@gsfpv/sim-core';
import type { Life } from '@gsfpv/sim-core';
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { CrashView } from '../../crashview';
import type { CrashHost } from '../../crashview';
import { LivesPlayer, lifeProblem } from '../../session/replay';
import { EXPORT_SIZES, LogExport, exportFrameCount } from '../../videoexport';
import type { ExportPose, ExportSize, ExportView } from '../../videoexport';
import type { CinemaRecorder, RecorderInfo } from '../../cinema';
import { PauseMenu } from '../menu';
import { recordingOf } from './cinema';
import type { Saved } from './recording';
import type { Feature, FlightContext } from '../context';
import './video-export.css';

/** What a run gives back (the hook's result, and what the bar shows). */
export interface ExportResult {
    ended: 'done' | 'cancel' | 'error';
    size: ExportSize;
    frames: number;
    encoded: number;
    startTick: number;
    endTick: number;
    stepFps: number;
    waited: number;
    incomplete: number;
    encodedIncomplete: number;
    crashes: number;
    seconds: number;
    first: ExportPose | null;
    last: ExportPose | null;
    info: RecorderInfo | null;
    /** luminance spread of the credit strip in the encoded pictures (D34: the credit is burned in) */
    creditStripStd: number;
    error?: string;
}

export interface ExportRunOptions {
    size?: ExportSize;
    /** the lives to replay (a saved flight's); the current life when left out */
    lives?: readonly Life[];
    fromTick?: number;
    toTick?: number;
    /** test only, the negative control of F.5: a wrong frame step (1/30 s) */
    stepFps?: number;
    /** test only (control): encode frames whatever the scan's state */
    ignoreScene?: boolean;
}

/** window.__gsfpv.videoExport: the acceptance drives the export and checks it against its own replay. */
export interface VideoExportHook {
    run(o?: ExportRunOptions): Promise<ExportResult>;
    state(): { running: boolean; k: number; frames: number; waited: number; bar: boolean; row: string | null };
    cancel(): void;
    /** the bar's Close (back to the summary panel) */
    close(): void;
    /** the replayed pose at each tick, from a fresh replay of the current lives (independent of the export's) */
    replayPoses(ticks: readonly number[]): { tick: number; p: number[]; q: number[] }[];
}

declare module '../test-hook' {
    interface TestHook {
        videoExport?: VideoExportHook;
    }
}

const SIZES: readonly ExportSize[] = ['1080p', '1440p', '2160p'];
let chosen: ExportSize | null = null;

export const videoExport: Feature = {
    id: 'video-export',
    install(ctx: FlightContext) {
        let running: { ex: LogExport | null; recorder: CinemaRecorder | null; cancelled: boolean } | null = null;
        let bar: HTMLElement | null = null;

        const defaultSize = (): ExportSize => {
            if (chosen) return chosen;
            const r = ctx.prefs.get<string>('recording.resolution');
            return SIZES.includes(r as ExportSize) ? (r as ExportSize) : '1080p';
        };

        /** Why these lives cannot become a video here, or ''. */
        const why = (lives: readonly Life[], fromTick: number, toTick: number): string => {
            const share = recordingOf(ctx);
            if (!ctx.scene.meta) return t('rec.onlyShowcase');
            if (!share || !share.rec.supported) return t('rec.unsupported');
            if (lives.length === 0) return t('rec.export.empty');
            const s = ctx.session;
            for (const l of lives) {
                const sc = l.header.scene;
                if (sc && (sc.id !== s.scene.id || sc.version !== s.scene.version)) return t('rec.export.otherScene');
                const p = lifeProblem(l.header, s.wallsSource);
                if (p) return t('rec.export.cannot', { why: p });
            }
            if (exportFrameCount(toTick - fromTick) < 1) return t('rec.export.empty');
            return '';
        };

        const currentRange = (): { lives: readonly Life[]; from: number; to: number } => {
            const s = ctx.session;
            if (!s.sim) return { lives: [], from: 0, to: 0 };
            const log = s.log;
            return { lives: [log], from: log.header.life.startTick, to: log.endTick };
        };

        // ------------------------------------------------------------------ the bar while it runs
        const progress = h('progress', { class: 'vx-progress', max: 1, value: 0, 'data-testid': 'video-export-progress' }) as HTMLProgressElement;
        const status = h('span', { class: 'vx-status', role: 'status', 'data-testid': 'video-export-status' });
        const title = h('span', { class: 'vx-title', id: 'vx-title' });
        const cancelBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'video-export-cancel', onclick: () => cancel() }, t('rec.export.cancel')) as HTMLButtonElement;
        const closeBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'video-export-close', hidden: true, onclick: () => close() }, t('rec.export.close')) as HTMLButtonElement;
        const offer = h('span', { class: 'vx-offer' });
        const onKey = (e: KeyboardEvent): void => {
            if (!bar) return;
            // the flight is paused under the bar: its keys (P, Esc, the flight's) are not for now
            if (e.code === 'Escape') {
                e.preventDefault();
                if (running) cancel();
                else close();
            } else if (e.code === 'Tab' || e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') return;
            e.stopImmediatePropagation();
        };
        const showBar = (size: ExportSize): void => {
            title.textContent = t('rec.export.running', { size: t(`set.recording.resolution.opt.${size}`) });
            progress.value = 0;
            status.textContent = '';
            offer.replaceChildren();
            cancelBtn.hidden = false;
            closeBtn.hidden = true;
            bar = h('div', { class: 'vx-bar interactive', role: 'dialog', 'aria-labelledby': 'vx-title', 'data-testid': 'video-export-bar' },
                h('div', { class: 'vx-head' }, title, cancelBtn, closeBtn), progress, h('div', { class: 'vx-line' }, status, offer));
            ctx.ui.append(bar);
            addEventListener('keydown', onKey, { capture: true });
            cancelBtn.focus();
        };
        const hideBar = (): void => {
            bar?.remove();
            bar = null;
            removeEventListener('keydown', onKey, { capture: true });
        };

        function cancel(): void {
            if (running) running.cancelled = true;
        }

        /** The bar's Close: back to the summary panel (its pause taken before the export's goes). */
        function close(): void {
            if (running) return;
            hideBar();
            ctx.menu.open();
            ctx.resume('export');
        }

        // ------------------------------------------------------------------ one run
        async function run(o: ExportRunOptions = {}): Promise<ExportResult> {
            const size = o.size ?? defaultSize();
            const cur = currentRange();
            const lives = o.lives ?? cur.lives;
            const fromTick = o.fromTick ?? (o.lives ? lives[0]?.header.life.startTick ?? 0 : cur.from);
            const toTick = o.toTick ?? (o.lives ? lives[lives.length - 1]?.endTick ?? 0 : cur.to);
            const result: ExportResult = { ended: 'error', size, frames: 0, encoded: 0, startTick: fromTick, endTick: toTick, stepFps: o.stepFps ?? 60, waited: 0, incomplete: 0, encodedIncomplete: 0, crashes: 0, seconds: 0, first: null, last: null, info: null, creditStripStd: 0 };
            const share = recordingOf(ctx);
            const no = why(lives, fromTick, toTick);
            if (no || !share || running) {
                result.error = no || 'busy';
                return result;
            }
            running = { ex: null, recorder: null, cancelled: false };
            const activation = !!navigator.userActivation?.isActive;
            // a live recording ends here (saved as usual): the export takes the canvas
            if (share.rec.recording) await share.stop();
            ctx.pause('export');
            if (ctx.menu.isOpen) ctx.menu.close();
            showBar(size);
            const r = ctx.renderer;
            const s = ctx.session;
            const prev = { cinema: ctx.quality.cinema, override: s.cameraOverride, transform: r.sceneTransform };
            const { w, h: hgt } = EXPORT_SIZES[size];
            let cv: CrashView | null = null;
            try {
                const recorder = await share.rec.openExport({ width: w, height: hgt, activation });
                running.recorder = recorder;
                // the picture as cinema draws it: full detail, the governor off, at exactly the video's size
                ctx.quality.setCinema(true);
                r.setDetail('final');
                r.setFixedResolution({ w, h: hgt });
                s.cameraOverride = true;
                ctx.crash.hold(true);
                const ex = new LogExport(lives, s.wallsSource, { fromTick, toTick, stepFps: o.stepFps, ignoreScene: o.ignoreScene }, r, view(), {
                    get canTake() { return recorder.canTake; },
                    take: () => recorder.addExact(ctx.canvas) >= 0
                });
                running.ex = ex;
                result.frames = ex.frames;
                result.startTick = ex.startTick;
                result.endTick = ex.endTick;
                const host = {
                    get sim() { return ex.sim; },
                    get params() { return ex.sim.p; },
                    renderer: r,
                    // the walls the crash tumbles in: the flight's, when the replay is at the transform flown now
                    get collision() { return sameTransform(ex.transform) ? s.collision : null; }
                } as unknown as CrashHost;
                cv = new CrashView(host, { clock: () => ex.clockMs });
                cv.rapierReady = ctx.crash.rapierReady;
                const crashView = cv;
                function view(): ExportView {
                    return {
                        beforeStep: () => crashView.trackCamera(),
                        crash: (e) => crashView.onCrash(e),
                        respawn: () => crashView.clear(),
                        transform: (tr) => {
                            const now = r.sceneTransform;
                            if (tr.some((v, i) => Math.abs(v - now[i]) > 1e-9)) r.setSceneTransform(tr[0], [tr[1], tr[2], tr[3]]);
                        },
                        show: (sim, ms) => {
                            if (crashView.active) crashView.frame(ms);
                            else {
                                const st = sim.s;
                                r.setPose(st[S.px], st[S.py], st[S.pz], st[S.qw], st[S.qx], st[S.qy], st[S.qz], s.cameraUptiltDeg);
                            }
                        },
                        camera: () => {
                            const p = r.camera.getPosition();
                            return [p.x, p.y, p.z];
                        }
                    };
                }
                progress.max = Math.max(1, ex.frames);
                await ex.prepare();
                const ended = await new Promise<'done' | 'cancel' | 'error'>((resolve) => {
                    let shown = 0;
                    const off = (v: 'done' | 'cancel' | 'error'): void => { r.app.off('frameend', onEnd); resolve(v); };
                    const onEnd = (): void => {
                        if (running?.cancelled) return off('cancel');
                        if (!recorder.recording) return off('error'); // the memory cap, a full disk, access lost
                        r.renderOnce();
                        let step: ReturnType<LogExport['onFrameEnd']>;
                        try { step = ex.onFrameEnd(); } catch (e) { result.error = String((e as Error)?.message ?? e); return off('error'); }
                        if (step === 'done') return off('done');
                        if (step === 'took') ex.prepare().catch((e) => { result.error = String((e as Error)?.message ?? e); off('error'); });
                        const now = performance.now();
                        if (now - shown > 200) {
                            shown = now;
                            progress.value = ex.k;
                            status.textContent = `${t('rec.export.progress', { k: ex.k, n: ex.frames })}${step === 'wait' && !r.sceneComplete ? ` · ${t('rec.export.loading')}` : ''}`;
                        }
                    };
                    r.app.on('frameend', onEnd);
                });
                Object.assign(result, { ended, encoded: ex.k, waited: ex.waited, incomplete: ex.incomplete, encodedIncomplete: ex.encodedIncomplete, crashes: ex.crashes, first: ex.first, last: ex.last, creditStripStd: recorder.lastCreditStripStd });
                restore();
                if (ended === 'cancel') await recorder.cancel();
                else {
                    const saved: Saved = await share.rec.finishExport(recorder);
                    result.info = saved.info;
                    result.seconds = saved.info.seconds;
                    if (saved.info.ended === 'cap') result.ended = 'error';
                    share.show(saved);
                    offer.replaceChildren(...saved.offer.map((f) => h('a', { href: f.url, download: f.name, class: 'rec-offer', 'data-testid': 'video-export-offer' }, t('rec.download'))));
                }
            } catch (e) {
                result.error = String((e as Error)?.message ?? e);
                restore();
                try { await running.recorder?.cancel(); } catch { /* nothing written */ }
            }
            running = null;
            progress.value = result.encoded;
            status.textContent = result.ended === 'done' && result.info
                ? `${t('rec.export.done', { n: result.encoded })} · ${result.info.where === 'folder' ? t('rec.saved', { s: result.info.seconds.toFixed(1), name: result.info.folder, mb: (result.info.bytes / 1048576).toFixed(1) }) : t('rec.savedBrowser', { s: result.info.seconds.toFixed(1), mb: (result.info.bytes / 1048576).toFixed(1) })}`
                : result.ended === 'cancel' ? t('rec.export.cancelled') : t('rec.export.failed', { e: result.error ?? result.info?.error ?? '' });
            cancelBtn.hidden = true;
            closeBtn.hidden = false;
            closeBtn.focus();
            return result;

            /** Everything as it was before the export: the canvas size, the quality, the scene, the camera. */
            function restore(): void {
                cv?.clear();
                cv = null;
                ctx.crash.hold(false);
                s.cameraOverride = prev.override;
                r.setFixedResolution(null);
                r.setSceneTransform(prev.transform[0], [prev.transform[1], prev.transform[2], prev.transform[3]]);
                ctx.quality.setCinema(prev.cinema);
                r.setDetail(prev.cinema ? 'final' : 'auto');
                ctx.quality.apply();
                r.renderOnce();
            }
        }

        const sameTransform = (tr: readonly number[]): boolean => {
            const cur = ctx.session.transform;
            return Math.abs(tr[0] - cur.s) < 1e-6 && cur.t.every((v, i) => Math.abs(v - tr[i + 1]) < 1e-6);
        };

        // ------------------------------------------------------------------ the summary panel's row
        const makeRow = (): HTMLElement | null => {
            if (!recordingOf(ctx)) return null;
            const cur = currentRange();
            const no = running ? '' : why(cur.lives, cur.from, cur.to);
            const id = 'sum-vx-h';
            const select = h('select', { class: 'vx-size', 'aria-label': t('rec.export.size'), 'data-testid': 'video-export-size' },
                ...SIZES.map((sz) => h('option', { value: sz, selected: sz === defaultSize() }, t(`set.recording.resolution.opt.${sz}`)))) as HTMLSelectElement;
            select.addEventListener('change', () => { chosen = select.value as ExportSize; });
            const go = h('button', { type: 'button', class: 'btn vx-go', 'data-action': 'video-export', disabled: !!no || !!running, onclick: () => void run({ size: select.value as ExportSize }) }, t('rec.export.button')) as HTMLButtonElement;
            select.disabled = !!no;
            const note = h('span', { class: 'vx-why', id: 'vx-why', 'data-testid': 'video-export-why' }, no);
            if (no) go.setAttribute('aria-describedby', 'vx-why');
            return h('section', { class: 'sum-row vx-row', role: 'group', 'aria-labelledby': id, 'data-testid': 'video-export' },
                h('span', { class: 'vx-label', id }, t('rec.export.title')), select, go, note);
        };
        if (ctx.menu instanceof PauseMenu) ctx.menu.addRow(makeRow);

        // ------------------------------------------------------------------ test hook
        ctx.hook.videoExport = {
            run,
            state: () => ({ running: !!running, k: running?.ex?.k ?? 0, frames: running?.ex?.frames ?? 0, waited: running?.ex?.waited ?? 0, bar: !!bar, row: document.querySelector('[data-testid=video-export-why]')?.textContent ?? null }),
            cancel,
            close,
            replayPoses: (ticks) => {
                const s = ctx.session;
                const all = s.lives();
                const out: { tick: number; p: number[]; q: number[] }[] = [];
                for (const tick of ticks) {
                    const lives = all.slice(Math.max(0, all.findIndex((l) => l.endTick >= tick)));
                    const pl = new LivesPlayer(lives, s.wallsSource, tick);
                    pl.stepTo(tick);
                    const st = pl.sim.s;
                    out.push({ tick: pl.sim.tick, p: [st[S.px], st[S.py], st[S.pz]], q: [st[S.qw], st[S.qx], st[S.qy], st[S.qz]] });
                }
                return out;
            }
        };
    }
};

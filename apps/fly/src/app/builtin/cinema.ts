// Cinema mode (phase D) and the recording bar (docs/architecture-v03.md F.1, F.2, F.4; items 19, 14).
// Cinema mode: full detail with the governor off. The bar at the bottom middle: REC (F9), the Auto
// toggle right next to it (item 14), the folder chip "Folder: <name> ▾" (pick, change, forget), a
// one-line "Allow saving to <folder>" when the browser asks again, and a note line (saved, frames
// repeated or dropped, why not here). REC is offered in normal flight too, at the quality as flown;
// cinema mode only raises the quality. Showcase scenes only (D34): elsewhere REC is not offered and
// Auto is shown disabled with the reason. While flying (armed, not crashed) the bar steps aside
// outside cinema mode; the OSD shows "● REC" while it records. recording.ts does the work.
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { q } from '../env';
import type { RecorderInfo } from '../../cinema';
import type { TestHook } from '../test-hook';
import type { Feature, FlightContext } from '../context';
import { Recording, autoRespawnShipped } from './recording';
import type { Saved } from './recording';
import './cinema.css';

/** What the acceptance reads and drives besides the phase-D cinema hook (window.__gsfpv.rec). */
export interface RecHook {
    rec: Recording;
    state(): Record<string, unknown>;
    useFolder(dir: FileSystemDirectoryHandle): Promise<void>;
    setAuto(on: boolean): void;
    /** control: 'v02' is the negative control of F.5 (v0.2's 30 fps track) */
    start(o?: { control?: 'v02' }): Promise<string>;
    stop(): Promise<RecorderInfo | null>;
    /** the newest saved file's bytes as base64, from wherever it went */
    readLast(): Promise<{ name: string; where: string; b64: string } | null>;
    /** test only: minutes per file instead of recording.splitMin (a split in seconds) */
    setSplitMin(min: number | null): void;
}

/** The page's recording and the bar's stop and note: the video export (builtin/video-export.ts) uses them. */
export interface RecordingShare {
    rec: Recording;
    /** stops a running recording and shows what was saved on the bar */
    stop(): Promise<RecorderInfo | null>;
    /** a saved file (the export's) on the bar's note line, with its link when it is offered */
    show(s: Saved | null): void;
}
const SHARED = new WeakMap<FlightContext, RecordingShare>();
/** The cinema feature's recording for this page (installed before the export). */
export function recordingOf(ctx: FlightContext): RecordingShare | undefined {
    return SHARED.get(ctx);
}

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const cinema: Feature = {
    id: 'cinema',
    install(ctx) {
        const { canvas, ui } = ctx;
        const creditOf = (): string | null => {
            const meta = ctx.scene.meta;
            return meta ? `${meta.title} — ${meta.author}, ${meta.license} · gsfpv.flyreelstudio.eu` : null;
        };
        const rec = new Recording({
            prefs: ctx.prefs,
            canvas,
            scene: () => ({ id: ctx.scene.id, credit: creditOf() }),
            autoRespawn: () => autoRespawnShipped(ctx.prefs)
        });
        let note = '';
        let noteOffer: Saved['offer'] = [];
        let menuOpen = false;

        // ------------------------------------------------------------------ the bar
        const recBtn = h('button', { type: 'button', class: 'btn rec', 'data-action': 'cinema-rec', 'aria-keyshortcuts': 'F9', onclick: () => toggle(true) }) as HTMLButtonElement;
        const autoBtn = h('button', { type: 'button', class: 'btn rec-auto', 'data-action': 'rec-auto', 'aria-pressed': 'false', onclick: () => onAuto() }) as HTMLButtonElement;
        const folderBtn = h('button', { type: 'button', class: 'btn rec-folder', 'data-action': 'rec-folder', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => onFolder() }) as HTMLButtonElement;
        const changeBtn = h('button', { type: 'button', class: 'btn', role: 'menuitem', 'data-action': 'rec-folder-change', onclick: () => { closeMenu(); void rec.pick(); } }, t('rec.folder.change'));
        const forgetBtn = h('button', { type: 'button', class: 'btn', role: 'menuitem', 'data-action': 'rec-folder-forget', onclick: () => { closeMenu(); void rec.forget(); } }, t('rec.folder.forget'));
        const folderMenu = h('div', { class: 'rec-menu', role: 'menu', hidden: true, onkeydown: (e: Event) => { if ((e as KeyboardEvent).code === 'Escape') { e.stopPropagation(); closeMenu(); folderBtn.focus(); } } }, changeBtn, forgetBtn);
        const folderWrap = h('div', { class: 'rec-folder-wrap' }, folderBtn, folderMenu);
        const allowBtn = h('button', { type: 'button', class: 'btn rec-allow', 'data-action': 'rec-allow', hidden: true, onclick: () => void rec.allow() }) as HTMLButtonElement;
        const row = h('div', { class: 'rec-row' }, recBtn, autoBtn, folderWrap);
        const cinemaNote = h('div', { class: 'cinema-note', role: 'status', id: 'rec-note', 'data-testid': 'cinema-note' });
        const cinemaBar = h('div', { class: 'cinema-bar rec-bar interactive', 'data-testid': 'rec-bar' }, row, allowBtn, cinemaNote);
        ui.append(cinemaBar);

        function closeMenu(): void {
            menuOpen = false;
            folderMenu.hidden = true;
            folderBtn.setAttribute('aria-expanded', 'false');
        }

        // Outside cinema mode on a desktop the bar sits bottom right; over a long credit line (a narrow
        // window) it goes up above it. The arm card, the key card and the arm hint go above the bar
        // when they would meet it. Measured, because the credit and the cards change size by themselves.
        const overlapX = (a: DOMRect, b: DOMRect): boolean => a.width > 0 && b.width > 0 && a.left < b.right + 8 && b.left < a.right + 8;
        const placeAbove = (): void => {
            const shown = cinemaBar.offsetParent !== null && !cinemaBar.hidden;
            if (!shown) {
                ui.classList.remove('rec-bar-up');
                return;
            }
            const body = document.body.classList;
            let lift = 0;
            if (!body.contains('cinema') && !body.contains('touch-on')) {
                ui.style.setProperty('--rec-lift', '0px');
                const credit = ui.querySelector('.attribution');
                const a = credit instanceof HTMLElement && credit.offsetParent !== null ? credit.getBoundingClientRect() : null;
                const b = cinemaBar.getBoundingClientRect();
                if (a && overlapX(a, b) && a.top < b.bottom) lift = Math.max(0, Math.round(b.bottom - a.top + 6));
            }
            ui.style.setProperty('--rec-lift', `${lift}px`);
            const bar = cinemaBar.getBoundingClientRect();
            // the cards go above the bar and above a credit line low on the screen (they printed over it)
            const credit = body.contains('touch-on') ? null : ui.querySelector('.attribution');
            const c = credit instanceof HTMLElement && credit.offsetParent !== null ? credit.getBoundingClientRect() : null;
            const top = c && c.height > 0 && c.top > innerHeight / 2 ? Math.min(bar.top, c.top) : bar.top;
            const v = `${Math.max(0, Math.round(innerHeight - top))}px`;
            if (ui.style.getPropertyValue('--cinema-top') !== v) ui.style.setProperty('--cinema-top', v);
            const cards = [...ui.querySelectorAll('.hud > .arm-card, .hud > .arm-disarm, .hud > .gate-msg')].filter((c): c is HTMLElement => c instanceof HTMLElement && c.offsetParent !== null);
            ui.classList.toggle('rec-bar-up', body.contains('cinema') || cards.some((c) => overlapX(c.getBoundingClientRect(), bar)));
        };
        new ResizeObserver(placeAbove).observe(cinemaBar);
        addEventListener('resize', placeAbove);

        /** Everything the bar shows, from the recorder's state and the store. */
        function render(): void {
            const allowed = rec.allowed;
            const showcase = creditOf() !== null;
            const recording = rec.recording;
            const cinemaOn = ctx.quality.cinema;
            const autoOn = rec.autoOn;
            // a non-showcase scene shows the bar only when the pilot would expect a recording here
            cinemaBar.hidden = !(showcase || cinemaOn || autoOn);
            recBtn.hidden = !allowed;
            recBtn.classList.toggle('on', recording);
            recBtn.disabled = rec.busy && !recording;
            recBtn.replaceChildren(recording ? t('rec.stop', { t: mmss(rec.seconds) }) : t('rec.button'), h('kbd', { 'aria-hidden': 'true' }, 'F9'));
            autoBtn.textContent = t('rec.auto');
            autoBtn.setAttribute('aria-pressed', autoOn && allowed ? 'true' : 'false');
            autoBtn.disabled = !allowed;
            autoBtn.title = allowed ? t('rec.auto.help') : !showcase ? t('rec.onlyShowcase') : t('rec.unsupported');
            // disabled, it says why in the note right under it (a disabled button shows no tooltip everywhere)
            if (allowed) autoBtn.removeAttribute('aria-describedby');
            else autoBtn.setAttribute('aria-describedby', 'rec-note');
            const name = rec.folder?.name ?? '';
            folderWrap.hidden = !allowed || !rec.canPick;
            folderBtn.textContent = !rec.folder ? `${t('rec.folder.none')} ▾` : rec.access === 'denied' ? `${t('rec.folder.noAccess', { name })} ▾` : `${t('rec.folder', { name })} ▾`;
            allowBtn.hidden = !allowed || !rec.folder || rec.access !== 'prompt';
            allowBtn.textContent = t('rec.permission', { name });
            ctx.hud.rec = recording;
            // the note: why not here, else what happens now, else the last result
            const why = !showcase ? t('rec.onlyShowcase') : !rec.supported ? t('rec.unsupported') : '';
            cinemaNote.replaceChildren();
            if (why) cinemaNote.append(cinemaOn ? t('cinema.noRec') : why);
            else if (recording) cinemaNote.append(t('rec.recording', { t: mmss(rec.seconds) }));
            else if (note) {
                cinemaNote.append(note);
                for (const f of noteOffer) cinemaNote.append(' ', h('a', { href: f.url, download: f.name, class: 'rec-offer', 'data-testid': 'rec-offer' }, t('rec.download')));
            } else if (cinemaOn) cinemaNote.append(t('cinema.on'));
            placeAbove();
        }
        rec.onChange = render;

        function savedNote(s: Saved): string {
            const i = s.info;
            const mb = (i.bytes / 1048576).toFixed(1);
            const sec = i.seconds.toFixed(1);
            const head = i.ended === 'cap' ? t('rec.memoryCap') : i.ended === 'error' ? t('rec.error', { e: i.error ?? '' }) : '';
            const where = i.where === 'folder' ? t('rec.saved', { s: sec, name: i.folder, mb }) : t('rec.savedBrowser', { s: sec, mb });
            const parts = i.files.length > 1 ? ` · ${t('rec.parts', { n: i.files.length })}` : '';
            return `${head ? `${head} ` : ''}${where}${parts} · ${t('rec.drops', { fps: i.fps, dup: i.duplicated, drop: i.dropped })}`;
        }

        function showSaved(s: Saved | null): void {
            if (!s) return;
            note = savedNote(s);
            noteOffer = s.offer;
            hookCinema.last = s.info;
            render();
        }
        rec.onEnded = showSaved;
        SHARED.set(ctx, { rec, stop: () => stopRec(), show: showSaved });

        /** activation: inside a click or a key press, where the folder's permission may be asked */
        async function startRec(activation: boolean, legacyV02 = false): Promise<string> {
            note = '';
            noteOffer = [];
            // a bar click or F9 is a user activation: ask for the folder straight away, before any await
            if (activation && rec.folder && rec.access === 'prompt') await rec.allow();
            return rec.queue(() => rec.start({ auto: false, activation, legacyV02 }));
        }

        async function stopRec(): Promise<RecorderInfo | null> {
            const s = await rec.queue(() => rec.stop());
            showSaved(s);
            if (s && q.get('simradio')) {
                // test modes keep the bytes for the phase-D acceptance (accept-d.ts reads lastBytes)
                const last = await readLast();
                hookCinema.lastBytes = last ? Uint8Array.from(atob(last.b64), (c) => c.charCodeAt(0)) : null;
            }
            return s?.info ?? null;
        }

        function toggle(activation: boolean): void {
            if (!rec.allowed) return;
            if (rec.recording) void stopRec();
            else void startRec(activation).catch((e) => { note = String((e as Error)?.message ?? e); render(); });
        }

        function onAuto(): void {
            if (!rec.allowed) return;
            const on = !rec.autoOn;
            // the first time: where should the videos go? (the picker needs this click)
            if (on && !rec.folder && rec.canPick) void rec.pick();
            else if (on && rec.folder && rec.access === 'prompt') void rec.allow();
            rec.setAuto(on);
            // switched on while flying: this flight is recorded too
            if (on && ctx.session.sim.armed && !rec.recording) void rec.queue(() => rec.start({ auto: true, activation: true })).catch(() => '');
        }

        function onFolder(): void {
            if (!rec.folder) { void rec.pick(); return; }
            menuOpen = !menuOpen;
            folderMenu.hidden = !menuOpen;
            folderBtn.setAttribute('aria-expanded', String(menuOpen));
            if (menuOpen) changeBtn.focus();
        }
        addEventListener('pointerdown', (e) => { if (menuOpen && !folderWrap.contains(e.target as Node)) closeMenu(); });

        async function readLast(): Promise<{ name: string; where: string; b64: string } | null> {
            const s = rec.last;
            const f = s?.info.files[s.info.files.length - 1];
            if (!s || !f) return null;
            let blob: Blob | null = null;
            const offered = s.offer.find((o) => o.name === f.name);
            if (offered) blob = await (await fetch(offered.url)).blob();
            else if (rec.folder) blob = await (await rec.folder.getFileHandle(f.name)).getFile();
            if (!blob) return null;
            const b = new Uint8Array(await blob.arrayBuffer());
            let s2 = '';
            for (let i = 0; i < b.length; i += 0x8000) s2 += String.fromCharCode(...b.subarray(i, i + 0x8000));
            return { name: f.name, where: offered ? s.info.where : 'folder', b64: btoa(s2) };
        }

        // ------------------------------------------------------------------ cinema mode
        function toggleCinema(): void {
            const on = !ctx.quality.cinema;
            document.body.classList.toggle('cinema', on);
            ctx.quality.setCinema(on);
            ctx.renderer.setDetail(on ? 'final' : 'auto');
            ctx.quality.apply();
            render();
        }

        // ------------------------------------------------------------------ frames, flight events, pauses
        ctx.renderer.app.on('frameend', () => rec.frame(performance.now()));
        let shown = 0;
        let placed = 0;
        ctx.events.on('frame', ({ now }) => {
            rec.tick(now);
            // the running time on the bar, twice a second
            if (rec.recording && now - shown > 500) { shown = now; render(); }
            // the cards around the bar come and go by themselves (arming, the key card)
            if (now - placed > 250) { placed = now; placeAbove(); }
        });
        ctx.events.on('sim', (e) => rec.onSim(e, performance.now(), !!navigator.userActivation?.isActive));
        ctx.events.on('pause', ({ on }) => {
            rec.pause('flight', on);
            // Resume (a click or P) is a user activation: the folder's permission can be asked there
            if (!on && rec.autoOn && rec.folder && rec.access === 'prompt' && navigator.userActivation?.isActive) void rec.allow();
        });
        // another scene in the same page (E.4): this scene's recording is finished first (its credit is in every frame)
        ctx.events.on('session', () => {
            rec.rules.reset();
            if (rec.recording) void stopRec();
            else render();
        });
        // a recording, or one being saved, is lost when the tab goes (nothing reaches the disk before
        // the file is closed): the browser asks before leaving then
        addEventListener('beforeunload', (e) => {
            if (rec.recording || rec.busy) e.preventDefault();
        });
        document.addEventListener('visibilitychange', () => {
            rec.pause('hidden', document.visibilityState === 'hidden');
            if (document.visibilityState === 'visible') void rec.refreshAccess();
        });
        ctx.prefs.onChange((c) => {
            // the folder's name was reset (Settings: reset, an imported file without it): its handle goes too
            if (c.id === 'recording.folder' && c.value === null && rec.folder) void rec.forget();
            if (c.id === 'recording.auto' || c.id === 'recording.folder') render();
        });

        ctx.keys.on('record.toggle', (e) => {
            e.preventDefault();
            toggle(true);
        });
        ctx.menu.add({ id: 'pause.cinema', action: null, labelKey: 'pause.cinema', order: 100, section: 'tools', run: toggleCinema });
        ctx.menu.add({ id: 'pause.record', action: 'record.toggle', labelKey: 'rec.menu', order: 101, section: 'tools', run: () => toggle(true), enabled: () => rec.allowed });

        // ------------------------------------------------------------------ test hook
        const hookCinema: NonNullable<TestHook['cinema']> = {
            on: () => ctx.quality.cinema,
            toggle: toggleCinema,
            canRecord: rec.allowed,
            start: () => startRec(true),
            stop: stopRec,
            last: null,
            lastBytes: null,
            creditStripStd: () => rec.creditStripStd
        };
        ctx.hook.cinema = hookCinema;
        const recHook: RecHook = {
            rec,
            state: () => ({
                allowed: rec.allowed, showcase: creditOf() !== null, supported: rec.supported, canPick: rec.canPick,
                recording: rec.recording, autoRun: rec.autoRun, auto: rec.autoOn, seconds: rec.seconds, busy: rec.busy,
                folder: rec.folder?.name ?? null, access: rec.access, pendingStopAt: rec.rules.pendingStopAt,
                barHidden: cinemaBar.hidden, barShown: cinemaBar.offsetParent !== null, recHidden: recBtn.hidden,
                autoDisabled: autoBtn.disabled, autoPressed: autoBtn.getAttribute('aria-pressed'), autoTitle: autoBtn.title,
                folderChip: folderWrap.hidden ? null : folderBtn.textContent, allowChip: allowBtn.hidden ? null : allowBtn.textContent,
                note: cinemaNote.textContent, last: rec.last?.info ?? null, offers: rec.last?.offer.map((o) => ({ name: o.name, bytes: o.bytes })) ?? []
            }),
            useFolder: (dir) => rec.useFolder(dir),
            setAuto: (on) => rec.setAuto(on),
            start: (o) => startRec(true, o?.control === 'v02'),
            stop: stopRec,
            readLast,
            setSplitMin: (min) => { rec.splitMinOverride = min; }
        };
        (ctx.hook as TestHook & { rec?: RecHook }).rec = recHook;

        render();
        void rec.load();
    }
};

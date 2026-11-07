// The helper's panel of Fly by Sound's recording (docs/wip/v12-plan.md section 4.3 step 3): what a sighted helper sees and
// clicks beside a pilot who flies by ear. It shows whether a recording runs, starts and stops one (with the consent text on
// screen and the pilot's agreement ticked), says who the pilot is (under 18? a guardian's signed consent confirmed? the
// headphones), and lists the recordings kept in this browser: keep an interrupted one, save one to disk, delete one.
//
// It is built outside #ui (which is one aria-live region: everything added there would be announced) as a plain region with
// real buttons, labels and one status line that is live. The pilot never needs it: T does everything by key and by voice.
// Nothing here is drawn while the sound mode is off: the toggle button appears with ctx.sonic.
import { clear, h } from '../ui/dom';
import { locale, t } from '../i18n';
import type { Recorder, RecorderStatus, StopOptions } from './recorder';
import type { SessionStores } from './recorder';
import type { PilotProfile } from './consent';
import { formatBytes, formatClock, formatWhen } from './format';
import { deleteSession, listSessions, packageOf, writeNotes } from './registry';
import type { SessionEntry } from './registry';
import type { ReplayControl, ReplayViewState } from './replay-control';
import { createReplayView } from './replay-view';
import type { ReplayView } from './replay-view';
import type { ResumeOffer } from './resume';
import { browserSaveEnv, packageFileName, saveToDisk } from './save';
import type { SaveEnv } from './save';
import './sonicrec.css';

export interface PanelDeps {
    recorder: Recorder;
    stores: SessionStores;
    resume: ResumeOffer;
    profile(): PilotProfile;
    setProfile(change: Partial<Omit<PilotProfile, 'id'>>): PilotProfile;
    isLocked(id: string): Promise<boolean>;
    nowIso(): string;
    saveEnv?: SaveEnv;
    /** what the Stop button passes to recorder.stop (the survey of step 4) */
    stopOptions?(): StopOptions;
    /** the page is about to be closed by the helper: leave focus where it was */
    onClose?(): void;
    /** the replay of a recording (step 5): the panel offers Replay on each finished recording and Open a file */
    replay?: ReplayControl;
}

export interface RecPanel {
    readonly root: HTMLElement;
    readonly button: HTMLButtonElement;
    readonly isOpen: boolean;
    open(): void;
    close(): void;
    /** the toggle button exists only while the sound mode is on */
    setVisible(on: boolean): void;
    onStatus(s: RecorderStatus): void;
    /** a line in the panel's live message (a recording ended, something was saved) */
    notify(text: string): void;
    /** the replay's state changed (replay-control.ts) */
    onReplay(s: ReplayViewState): void;
    refresh(): Promise<void>;
    dispose(): void;
}

const HEADPHONES: readonly PilotProfile['headphones'][] = ['wired', 'bluetooth', 'speakers', 'unknown'];

export function createPanel(deps: PanelDeps, parent: HTMLElement = document.body): RecPanel {
    const saveEnv = deps.saveEnv ?? browserSaveEnv();
    let open = false;
    let last: RecorderStatus = deps.recorder.status();
    let refreshSeq = 0;
    let confirming: string | null = null;
    let confirmTimer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;

    // ---------------------------------------------------------------- the pieces that change
    const status = h('p', { class: 'sonicrec-status', role: 'status', 'aria-live': 'polite' });
    const voice = h('p', { class: 'sonicrec-voice' });
    const message = h('p', { class: 'sonicrec-message', role: 'status', 'aria-live': 'polite' });
    const note = h('p', { class: 'sonicrec-note' });
    const list = h('ul', { class: 'sonicrec-sessions' });

    const agree = h('input', { type: 'checkbox', id: 'sonicrec-agree' });
    const start = h('button', { type: 'button', class: 'btn primary', 'data-action': 'start' }, t('sonicrec.start'));
    const stop = h('button', { type: 'button', class: 'btn', 'data-action': 'stop' }, t('sonicrec.stop'));
    const nickname = h('input', { type: 'text', id: 'sonicrec-nick', maxlength: 40, autocomplete: 'off', spellcheck: false });
    const minor = h('input', { type: 'checkbox', id: 'sonicrec-minor' });
    const guardian = h('input', { type: 'checkbox', id: 'sonicrec-guardian' });
    const phones = h('select', { id: 'sonicrec-phones' }, ...HEADPHONES.map((p) => h('option', { value: p }, t(`sonicrec.headphones.${p}`))));

    const consent = h('fieldset', { class: 'sonicrec-consent' },
        h('legend', {}, t('sonicrec.consent.title')),
        h('p', {}, t('sonicrec.consent.text')),
        h('label', { for: 'sonicrec-agree' }, agree, ' ', t('sonicrec.consent.agree')));
    const pilot = h('fieldset', { class: 'sonicrec-pilot' },
        h('legend', {}, t('sonicrec.pilot.title')),
        h('label', { for: 'sonicrec-nick' }, t('sonicrec.pilot.nickname')), nickname,
        h('label', { for: 'sonicrec-minor' }, minor, ' ', t('sonicrec.pilot.minor')),
        h('label', { for: 'sonicrec-guardian' }, guardian, ' ', t('sonicrec.pilot.guardian')),
        h('p', { class: 'sonicrec-help' }, t('sonicrec.pilot.guardian.help')),
        h('label', { for: 'sonicrec-phones' }, t('sonicrec.pilot.headphones')), phones);

    const close = h('button', { type: 'button', class: 'sonicrec-x', 'aria-label': t('sonicrec.close') }, '×');
    // the toggle button says so while a replay plays (the position moves with the view's own clock)
    let replayLabel: string | null = null;
    const replayView: ReplayView | null = deps.replay === undefined ? null : createReplayView(deps.replay, (s) => {
        replayLabel = s.stage === 'ready' && s.player !== null && s.player.phase === 'playing' ? t('sonicrec.button.replay', { time: formatClock(s.player.tMs) }) : null;
        drawStatus();
    });
    const root = h('section', { class: 'sonicrec-panel', id: 'sonicrec-panel', role: 'region', 'aria-labelledby': 'sonicrec-title', hidden: true },
        h('header', { class: 'sonicrec-head' }, h('h2', { id: 'sonicrec-title' }, t('sonicrec.title')), close),
        status, voice,
        h('div', { class: 'sonicrec-actions' }, start, stop),
        consent,
        // the recordings come before the pilot's form: after a flight the helper looks for the Save button first
        h('h3', {}, t('sonicrec.sessions.title')), list, message,
        ...(replayView === null ? [] : [h('div', { class: 'sonicrec-actions' }, replayView.openButton), replayView.root]),
        pilot, note);
    const button = h('button', { type: 'button', class: 'sonicrec-toggle', id: 'sonicrec-toggle', 'aria-controls': 'sonicrec-panel', 'aria-expanded': 'false', hidden: true }, t('sonicrec.button'));
    parent.append(root, button);

    // ---------------------------------------------------------------- drawing
    const say = (text: string): void => {
        message.textContent = text;
    };

    function drawStatus(): void {
        const s = last;
        const time = formatClock(s.elapsedMs);
        status.textContent = s.error !== null && s.phase === 'idle' ? t('sonicrec.error.generic', { reason: s.error }) : t(`sonicrec.status.${s.phase === 'idle' ? 'off' : s.phase}`, { time, frames: s.frames });
        voice.textContent = t(`sonicrec.voice.${s.voice === 'recording' ? 'recording' : s.voice}`, { size: formatBytes(s.voiceBytes) });
        voice.hidden = s.phase === 'idle' || s.phase === 'asking' || s.phase === 'starting';
        const idle = s.phase === 'idle';
        start.disabled = !idle || !agree.checked || busy;
        start.hidden = !idle;
        stop.hidden = s.phase !== 'recording';
        consent.hidden = !idle;
        button.textContent = s.phase === 'recording' ? t('sonicrec.button.recording', { time }) : replayLabel ?? t('sonicrec.button');
        button.classList.toggle('recording', s.phase === 'recording');
        button.classList.toggle('replaying', s.phase !== 'recording' && replayLabel !== null);
        note.textContent = !s.durable ? t('sonicrec.note.memory') : s.persisted === false ? t('sonicrec.note.persist') : '';
        note.hidden = note.textContent === '';
    }

    function drawProfile(): void {
        const p = deps.profile();
        if (document.activeElement !== nickname) nickname.value = p.nickname ?? '';
        minor.checked = p.minor;
        guardian.checked = p.guardianConfirmed;
        guardian.disabled = !p.minor;
        phones.value = p.headphones;
    }

    function stateText(e: SessionEntry): string {
        if (e.id === last.sessionId) return t('sonicrec.state.here');
        if (e.locked) return t('sonicrec.state.locked');
        if (e.state === 'unreadable') return t('sonicrec.state.unreadable', { problem: e.problem ?? '' });
        if (e.state === 'unfinished') return t('sonicrec.state.unfinished');
        return e.complete ? t('sonicrec.state.finished') : t('sonicrec.state.recovered');
    }

    function drawRow(e: SessionEntry): HTMLLIElement {
        const m = e.manifest;
        const line = m === null ? e.id : t('sonicrec.session.line', { when: formatWhen(m.created, locale), length: e.durationMs === null ? '-' : formatClock(e.durationMs), size: formatBytes(e.bytes) });
        const lesson = m?.lesson?.id ?? null;
        const parts = [line, e.voice ? t('sonicrec.session.voice') : t('sonicrec.session.novoice')];
        const buttons: HTMLElement[] = [];
        if (!e.locked) {
            if (e.state === 'unfinished') buttons.push(h('button', { type: 'button', class: 'btn', 'data-action': 'keep', onclick: () => void keep(e) }, t('sonicrec.action.keep')));
            if (e.state === 'finished') buttons.push(h('button', { type: 'button', class: 'btn', 'data-action': 'save', onclick: () => void save(e) }, t('sonicrec.action.save')));
            if (e.state === 'finished' && deps.replay !== undefined) buttons.push(h('button', { type: 'button', class: 'btn', 'data-action': 'replay', onclick: () => replay(e) }, t('sonicrec.action.replay')));
            buttons.push(h('button', { type: 'button', class: 'btn', 'data-action': 'delete', onclick: () => void remove(e) }, confirming === e.id ? t('sonicrec.action.delete.sure') : t('sonicrec.action.delete')));
        }
        return h('li', { class: 'sonicrec-session', 'data-id': e.id },
            h('div', { class: 'sonicrec-line' }, parts.join(' · '), lesson === null ? '' : ` · ${lesson}`),
            h('div', { class: 'sonicrec-state' }, stateText(e), e.notes.savedAt === undefined ? '' : ` ${t('sonicrec.state.savedDisk')}`),
            h('div', { class: 'sonicrec-buttons' }, ...buttons));
    }

    async function refresh(): Promise<void> {
        const seq = ++refreshSeq;
        let entries: SessionEntry[];
        try {
            entries = await listSessions(deps.stores, deps.isLocked);
        } catch (e) {
            if (seq === refreshSeq) say(t('sonicrec.error.generic', { reason: e instanceof Error ? e.message : String(e) }));
            return;
        }
        if (seq !== refreshSeq) return; // a newer refresh is on its way
        clear(list);
        if (entries.length === 0) list.append(h('li', { class: 'sonicrec-empty' }, t('sonicrec.sessions.empty')));
        for (const e of entries) list.append(drawRow(e));
    }

    // ---------------------------------------------------------------- what the buttons do
    async function keep(e: SessionEntry): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            const kept = await deps.resume.keep(e.id);
            say(kept === null ? t('sonicrec.msg.failed', { reason: 'recover' }) : t('sonicrec.msg.kept'));
        } finally {
            busy = false;
            await refresh();
        }
    }

    async function save(e: SessionEntry): Promise<void> {
        if (busy || e.manifest === null) return;
        busy = true;
        try {
            const blob = await packageOf(deps.stores, e.id);
            const name = packageFileName(e.manifest);
            const via = await saveToDisk(blob, name, saveEnv);
            if (via === 'cancelled') say(t('sonicrec.msg.cancelled'));
            else {
                await writeNotes(await deps.stores.open(e.id), { savedAt: deps.nowIso(), savedVia: via });
                say(t('sonicrec.msg.saved', { name }));
            }
        } catch (err) {
            say(t('sonicrec.msg.failed', { reason: err instanceof Error ? err.message : String(err) }));
        } finally {
            busy = false;
            await refresh();
        }
    }

    /** A recording is replayed only while none is being made: the replay pauses the flight and takes the camera. */
    function replay(e: SessionEntry): void {
        if (last.phase !== 'idle') return say(t('sonicrec.replay.busy'));
        void deps.replay?.openSession(e.id);
    }

    async function remove(e: SessionEntry): Promise<void> {
        if (busy) return;
        if (confirming !== e.id) {
            // the first click asks; a second one within 6 s does it
            confirming = e.id;
            if (confirmTimer !== null) clearTimeout(confirmTimer);
            confirmTimer = setTimeout(() => {
                confirming = null;
                void refresh();
            }, 6000);
            say(t('sonicrec.action.delete.sure'));
            await refresh();
            return;
        }
        confirming = null;
        busy = true;
        try {
            await deleteSession(deps.stores, e.id, deps.isLocked);
            deps.resume.forget(e.id);
            say(t('sonicrec.msg.deleted'));
        } catch (err) {
            say(t('sonicrec.msg.failed', { reason: err instanceof Error ? err.message : String(err) }));
        } finally {
            busy = false;
            await refresh();
        }
    }

    agree.addEventListener('change', drawStatus);
    start.addEventListener('click', () => {
        // inside the click: the browser may ask for the microphone only because of it
        void deps.recorder.startByHelper().then((ok) => {
            if (ok) agree.checked = false; // the next recording asks again
        });
    });
    stop.addEventListener('click', () => {
        void deps.recorder.stop(deps.stopOptions?.() ?? {}).then((done) => {
            if (done !== null) say(t('sonicrec.msg.recorded'));
        });
    });
    nickname.addEventListener('change', () => {
        deps.setProfile({ nickname: nickname.value });
        drawProfile();
    });
    minor.addEventListener('change', () => {
        deps.setProfile({ minor: minor.checked });
        drawProfile();
    });
    guardian.addEventListener('change', () => {
        deps.setProfile({ guardianConfirmed: guardian.checked });
        drawProfile();
    });
    phones.addEventListener('change', () => {
        deps.setProfile({ headphones: phones.value as PilotProfile['headphones'] });
    });

    const setOpen = (on: boolean): void => {
        open = on;
        root.hidden = !on;
        button.setAttribute('aria-expanded', on ? 'true' : 'false');
        if (on) {
            drawProfile();
            drawStatus();
            void refresh();
        }
    };
    button.addEventListener('click', () => setOpen(!open));
    close.addEventListener('click', () => {
        setOpen(false);
        button.focus();
        deps.onClose?.();
    });
    // Escape inside the panel closes it, and is not the pause menu's Escape
    root.addEventListener('keydown', (e) => {
        if (e.code === 'Escape') {
            e.stopPropagation();
            setOpen(false);
            button.focus();
            deps.onClose?.();
        }
    });
    drawStatus();

    return {
        root,
        button,
        get isOpen() {
            return open;
        },
        open: () => setOpen(true),
        close: () => setOpen(false),
        setVisible(on) {
            button.hidden = !on;
            if (!on) setOpen(false);
        },
        onStatus(s) {
            const wasIdle = last.phase !== 'idle';
            last = s;
            drawStatus();
            // a recording just ended: the list has a new row
            if (open && wasIdle && s.phase === 'idle') void refresh();
        },
        notify: say,
        onReplay(s) {
            replayView?.update(s);
            replayLabel = s.stage === 'ready' && s.player !== null && s.player.phase === 'playing' ? t('sonicrec.button.replay', { time: formatClock(s.player.tMs) }) : null;
            drawStatus();
        },
        refresh,
        dispose() {
            if (confirmTimer !== null) clearTimeout(confirmTimer);
            replayView?.dispose();
            root.remove();
            button.remove();
        }
    };
}

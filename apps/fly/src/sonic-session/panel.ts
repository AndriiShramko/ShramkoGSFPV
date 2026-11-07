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
import type { SendControl } from './send-control';
import { channelList, sendBlocker, transferLine } from './transfer-view';
import type { TransferLine } from './transfer-view';
import type { ChannelState } from './upload';
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
    /** the sending of a recording to the author (step 8): the panel offers Send on each finished recording and shows where it is */
    send?: SendControl;
    /** the browser can recognise speech (the voice commands' tick is offered only then) */
    speechAvailable?: boolean;
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
    /** a sending made progress or ended (send-control.ts): the lines of the rows are redrawn, the list read again when one started or ended */
    onTransfer(): void;
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
    /** the row whose Send asked for the pilot's agreement, and whether the tick is set */
    let sending: { id: string; agree: boolean } | null = null;
    /** the entries of the last listing, to redraw a row's transfer line without reading the storage again */
    const shown = new Map<string, SessionEntry>();
    let lastLive = '';

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
    const speech = h('input', { type: 'checkbox', id: 'sonicrec-speech', 'aria-describedby': 'sonicrec-speech-help' });
    const speechHelp = h('p', { class: 'sonicrec-help', id: 'sonicrec-speech-help' });
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
        h('label', { for: 'sonicrec-speech' }, speech, ' ', t('sonicrec.pilot.speech')), speechHelp,
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
        // voice commands: offered only where the browser can recognise speech, and for a minor only after the guardian is confirmed
        const can = deps.speechAvailable !== false;
        const blockedMinor = p.minor && !p.guardianConfirmed;
        speech.checked = p.speechRecognition;
        speech.disabled = !can || blockedMinor;
        speechHelp.textContent = !can ? t('sonicrec.pilot.speech.unavailable') : blockedMinor ? t('sonicrec.pilot.speech.guardian') : t('sonicrec.pilot.speech.help');
    }

    // ---------------------------------------------------------------- what is said about sending
    const clockOf = (ms: number): string => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const lookup = (prefix: string, code: string, other: string): string => {
        const text = t(`${prefix}.${code}`);
        return text === `${prefix}.${code}` ? t(other, { code }) : text;
    };
    const channelsText = (channels: Readonly<Record<string, ChannelState>> | null): string =>
        channelList(channels).map((c) => t('sonicrec.channel.name', { name: t(`sonicrec.channel.${c.name}`), status: lookup('sonicrec.channel.status', c.status, 'sonicrec.channel.status.unknown') })).join(', ');

    const refText = (ref: string | null): string => (ref === null ? '' : ` ${t('sonicrec.transfer.ref', { id: ref })}`);

    function transferText(line: TransferLine): string {
        switch (line.kind) {
            case 'none':
                return '';
            case 'working':
                return t('sonicrec.transfer.working');
            case 'uploading':
                return t('sonicrec.transfer.uploading', { done: line.done, of: line.of });
            case 'waiting':
                if (line.problem === 'interrupted') return t('sonicrec.transfer.interrupted');
                return line.retryAt === null ? t('sonicrec.transfer.waiting.soon', { problem: lookup('sonicrec.problem', line.problem, 'sonicrec.problem.other') }) : t('sonicrec.transfer.waiting', { problem: lookup('sonicrec.problem', line.problem, 'sonicrec.problem.other'), time: clockOf(line.retryAt) });
            case 'stored':
                return (line.problem === null ? t('sonicrec.transfer.stored', { channels: channelsText(line.channels) }) : t('sonicrec.transfer.stored.trouble', { problem: lookup('sonicrec.problem', line.problem, 'sonicrec.problem.other') })) + refText(line.ref);
            case 'delivered':
                return t('sonicrec.transfer.delivered', { channels: channelsText(line.channels) }) + refText(line.ref);
            case 'blocked':
                return t('sonicrec.transfer.blocked', { reason: lookup('sonicrec.blocked', line.reason, 'sonicrec.blocked.other') });
        }
    }

    const lineOf = (e: SessionEntry): TransferLine => transferLine(e.transfer, deps.send?.live().get(e.id) ?? null);

    function drawTransfer(el: HTMLElement, e: SessionEntry): void {
        const line = lineOf(e);
        el.textContent = transferText(line);
        el.hidden = el.textContent === '';
        // a part counter ticking along is not read out every time; the stages (stored, delivered, waiting) are
        el.setAttribute('aria-live', line.kind === 'uploading' || line.kind === 'working' ? 'off' : 'polite');
        el.classList.toggle('bad', line.kind === 'waiting' || line.kind === 'blocked');
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
            const line = lineOf(e);
            if (deps.send !== undefined && e.state === 'finished' && line.kind !== 'delivered') {
                if (line.kind === 'working' || line.kind === 'uploading' || line.kind === 'stored') {
                    // going, or with the server: nothing to press (a stored recording is the server's to deliver)
                } else if (line.kind === 'waiting' && deps.send.live().has(e.id)) buttons.push(h('button', { type: 'button', class: 'btn', 'data-action': 'retry', onclick: () => deps.send?.retry(e.id) }, t('sonicrec.action.retry')));
                else buttons.push(h('button', { type: 'button', class: 'btn', 'data-action': 'send', 'aria-expanded': sending?.id === e.id ? 'true' : 'false', onclick: () => void askSend(e) }, t('sonicrec.action.send')));
            }
            buttons.push(h('button', { type: 'button', class: 'btn', 'data-action': 'delete', onclick: () => void remove(e) }, confirming === e.id ? t('sonicrec.action.delete.sure') : t('sonicrec.action.delete')));
        }
        const transfer = h('div', { class: 'sonicrec-transfer', role: 'status' });
        drawTransfer(transfer, e);
        return h('li', { class: 'sonicrec-session', 'data-id': e.id },
            h('div', { class: 'sonicrec-line' }, parts.join(' · '), lesson === null ? '' : ` · ${lesson}`),
            h('div', { class: 'sonicrec-state' }, stateText(e), e.notes.savedAt === undefined ? '' : ` ${t('sonicrec.state.savedDisk')}`),
            transfer,
            sending?.id === e.id ? sendBlock(e) : null,
            h('div', { class: 'sonicrec-buttons' }, ...buttons));
    }

    /** The consent text, the pilot's tick and the buttons, inside the row: nothing is sent until the tick is set and Send is pressed. */
    function sendBlock(e: SessionEntry): HTMLElement {
        const minor = e.manifest?.consent.minor === true;
        const tick = h('input', { type: 'checkbox', id: `sonicrec-send-agree-${e.id}`, 'data-action': 'send-agree' });
        tick.checked = sending?.agree === true;
        const go = h('button', { type: 'button', class: 'btn primary', 'data-action': 'send-go' }, t('sonicrec.send.confirm'));
        go.disabled = !tick.checked;
        tick.addEventListener('change', () => {
            if (sending !== null) sending.agree = tick.checked;
            go.disabled = !tick.checked;
        });
        go.addEventListener('click', () => void sendNow(e));
        return h('div', { class: 'sonicrec-send', role: 'group', 'aria-labelledby': `sonicrec-send-h-${e.id}` },
            h('h4', { id: `sonicrec-send-h-${e.id}` }, t('sonicrec.send.heading')),
            h('p', {}, t('sonicrec.send.consent.text')),
            minor ? h('p', {}, t('sonicrec.send.consent.minor')) : null,
            h('p', {}, h('a', { href: `/${locale}/privacy/#fly-by-sound`, target: '_blank', rel: 'noopener' }, t('sonicrec.send.privacy'))),
            h('label', { for: tick.id }, tick, ' ', t('sonicrec.send.consent.agree')),
            h('div', { class: 'sonicrec-buttons' }, go, h('button', { type: 'button', class: 'btn', 'data-action': 'send-cancel', onclick: () => { sending = null; void refresh(); } }, t('sonicrec.send.cancel'))));
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
        shown.clear();
        for (const e of entries) shown.set(e.id, e);
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

    /** Send: the row opens the consent text and the pilot's tick. A recording that cannot be sent says why instead. */
    async function askSend(e: SessionEntry): Promise<void> {
        if (sending?.id === e.id) {
            sending = null;
            return refresh();
        }
        const blocker = sendBlocker(e, deps.profile());
        if (blocker !== null) return say(t(`sonicrec.send.notice.${blocker}`));
        sending = { id: e.id, agree: false };
        await refresh();
        (list.querySelector(`[data-id="${CSS.escape(e.id)}"] [data-action="send-agree"]`) as HTMLElement | null)?.focus();
    }

    /** The tick is set and Send was pressed. */
    async function sendNow(e: SessionEntry): Promise<void> {
        if (sending?.id !== e.id || !sending.agree || deps.send === undefined) return;
        sending = null;
        const why = await deps.send.sendByHelper(e.id);
        if (why !== null && why !== 'busy') say(t(`sonicrec.send.notice.${why}`));
        await refresh();
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
    speech.addEventListener('change', () => {
        deps.setProfile({ speechRecognition: speech.checked });
        drawProfile();
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
        onTransfer() {
            // the lines are redrawn in place from the last listing; the listing itself is read again when a sending started or ended
            const live = deps.send?.live() ?? new Map();
            for (const [id, entry] of shown) {
                const el = list.querySelector(`[data-id="${CSS.escape(id)}"] .sonicrec-transfer`) as HTMLElement | null;
                if (el !== null) drawTransfer(el, entry);
            }
            const key = [...live.keys()].sort().join(',');
            if (key !== lastLive) {
                lastLive = key;
                if (open) void refresh();
            }
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

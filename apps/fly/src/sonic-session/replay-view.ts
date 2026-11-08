// What the helper sees of a replay (docs/wip/v12-plan.md section 4.3 step 5): a section of the recording panel with real buttons, one labelled
// position slider and a live status line. It draws the controller's state and calls its methods; it decides nothing. Built outside #ui like the
// rest of the panel. The check's own report stays in a details element (the sound package writes it in English).
import './texts';
import { clear, h } from '../ui/dom';
import { t } from '../i18n';
import { setText } from './format';
import { ReplayControl } from './replay-control';
import type { ReplayViewState } from './replay-control';

export interface ReplayView {
    readonly root: HTMLElement;
    /** the "Open a recording file" button (it opens the file picker; the chosen file goes to the controller) */
    readonly openButton: HTMLButtonElement;
    update(s: ReplayViewState): void;
    dispose(): void;
}

export function createReplayView(control: ReplayControl, onTick?: (s: ReplayViewState) => void): ReplayView {
    const title = h('p', { class: 'sonicrec-replay-title' });
    const status = h('p', { class: 'sonicrec-replay-status', role: 'status', 'aria-live': 'polite' });
    const notes = h('ul', { class: 'sonicrec-replay-notes' });
    const toggle = h('button', { type: 'button', class: 'btn primary', 'data-action': 'replay-toggle' }, t('sonicrec.replay.play'));
    const slider = h('input', { type: 'range', class: 'sonicrec-replay-pos', id: 'sonicrec-replay-pos', min: 0, max: 1, step: 100, value: 0, 'aria-label': t('sonicrec.replay.position') });
    const time = h('span', { class: 'sonicrec-replay-time' });
    const close = h('button', { type: 'button', class: 'btn', 'data-action': 'replay-close' }, t('sonicrec.replay.close'));
    const pre = h('pre', { class: 'sonicrec-replay-details' });
    const details = h('details', { class: 'sonicrec-replay-more' }, h('summary', {}, t('sonicrec.replay.details')), pre);
    const controls = h('div', { class: 'sonicrec-replay-controls' }, toggle, slider, time, close);
    const root = h('section', { class: 'sonicrec-replay', role: 'region', 'aria-labelledby': 'sonicrec-replay-h', hidden: true },
        h('h3', { id: 'sonicrec-replay-h' }, t('sonicrec.replay.title')), title, status, notes, controls, details);

    const input = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, 'data-testid': 'replay-file' });
    const openButton = h('button', { type: 'button', class: 'btn', 'data-action': 'replay-open' }, t('sonicrec.replay.openFile'));
    openButton.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        input.value = '';
        if (file !== undefined) void control.openFile(file);
    });
    root.append(input);

    toggle.addEventListener('click', () => control.toggle());
    close.addEventListener('click', () => control.close());
    slider.addEventListener('input', () => control.seek(Number(slider.value)));

    let current: ReplayViewState = control.state;
    let notesShown = '';
    // draw() runs every 250 ms while a replay is open (the position moves): the status line is a live region, so every write below is
    // made only when the text is different (setText), or a screen reader would read the same sentence out four times a second
    const draw = (): void => {
        const s = current;
        root.hidden = s.stage === 'closed';
        if (s.stage === 'closed') return;
        setText(title, s.title);
        title.hidden = s.title === '';
        setText(status, s.stage === 'loading' ? t('sonicrec.replay.loading') : s.stage === 'error' ? (s.error ?? '') : (s.check?.summary ?? ''));
        // a recording of an older build is not a fault of the flight (W10): only an error and a FAIL are marked
        status.classList.toggle('bad', s.stage === 'error' || (s.check !== null && s.check.verdict === 'fail'));
        const notesKey = s.notes.join('\n');
        if (notesKey !== notesShown) {
            notesShown = notesKey;
            clear(notes);
            for (const n of s.notes) notes.append(h('li', {}, n));
        }
        const ready = s.stage === 'ready' && s.player !== null;
        controls.hidden = !ready;
        details.hidden = !ready || s.details === '';
        setText(pre, s.details);
        if (ready && s.player !== null) {
            const p = s.player;
            setText(toggle, p.phase === 'playing' ? t('sonicrec.replay.pause') : t('sonicrec.replay.play'));
            slider.max = String(Math.max(1, Math.round(p.durationMs)));
            if (document.activeElement !== slider) slider.value = String(Math.round(p.tMs));
            const text = ReplayControl.clock(p);
            setText(time, text);
            if (slider.getAttribute('aria-valuetext') !== text) slider.setAttribute('aria-valuetext', text);
        }
    };
    // the position moves while it plays: the controller reports a phase change, the clock is read here
    const timer = setInterval(() => {
        if (current.stage === 'ready') {
            current = control.state;
            draw();
            onTick?.(current);
        }
    }, 250);

    return {
        root,
        openButton,
        update(s) {
            current = s;
            draw();
        },
        dispose() {
            clearInterval(timer);
            root.remove();
            openButton.remove();
        }
    };
}

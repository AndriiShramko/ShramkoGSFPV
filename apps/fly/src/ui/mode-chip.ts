// The HUD mode chip (docs/architecture-v03.md B.2, B.3; the owner's item 15: "click the ACRO label
// to pick another mode"). The OSD's top-left line is rebuilt every 100 ms inside pointer-events
// none (ui/hud.ts), so it cannot hold a button: the chip is its own .interactive element, placed
// right beside that line (below it when the line and the chip would reach the right-hand OSD
// line, as on a phone). A click opens a popover with the three modes, what each does and the M
// key-cap; M itself works without it (app/builtin/modes.ts). When the radio's mode switch decides,
// the chip shows the radio's mode, says so, and its choices are off.
import type { FlightMode } from '@gsfpv/sim-core';
import type { KeyHint } from '@gsfpv/prefs';
import { h } from './dom';
import { t } from '../i18n';
import './mode-chip.css';

export const CHIP_MODES: readonly FlightMode[] = ['acro', 'angle', 'horizon'];

export interface ModeChipHost {
    /** the mode flying now (the radio's, when its switch decides) */
    current(): FlightMode;
    /** the radio's switch ("CH6") when it decides the mode, else null */
    radio(): string | null;
    /** the pilot picked a mode */
    pick(m: FlightMode): void;
    /** the keys of the mode action (the keymap's M) */
    caps: readonly KeyHint[];
}

const GAP = 8;

export class ModeChip {
    readonly el: HTMLDivElement;
    private btn: HTMLButtonElement;
    private label: HTMLSpanElement;
    private src: HTMLSpanElement;
    private pop: HTMLDivElement;
    private note: HTMLParagraphElement;
    private items: { m: FlightMode; b: HTMLButtonElement }[] = [];
    private host: ModeChipHost;
    private shown = '';
    private placed = '';

    constructor(host: ModeChipHost) {
        this.host = host;
        const kbd = (): HTMLElement | null => (host.caps.length ? h('span', { class: 'mc-caps', 'aria-hidden': 'true' }, ...host.caps.map((k) => h('kbd', {}, k.cap))) : null);
        this.label = h('span', { class: 'mc-mode' });
        this.src = h('span', { class: 'mc-src', hidden: true });
        this.btn = h('button', {
            type: 'button', class: 'mc-chip', 'data-action': 'mode-chip', 'data-testid': 'mode-chip',
            'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'mode-pop',
            'aria-keyshortcuts': host.caps.map((k) => k.aria).join(' ') || undefined,
            onclick: (e: Event) => this.toggle((e as MouseEvent).detail === 0)
        }, this.label, this.src, kbd());
        this.note = h('p', { class: 'mc-note', hidden: true });
        for (const m of CHIP_MODES) {
            const b = h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': 'false', 'data-action': `mode-${m}`, tabindex: -1, onclick: (e: Event) => this.choose(m, (e as MouseEvent).detail === 0) },
                h('span', { class: 'mc-name' }, t(`mode.${m}`)), h('span', { class: 'mc-about' }, t(`mode.about.${m}`)));
            this.items.push({ m, b });
        }
        const foot = host.caps.length ? h('p', { class: 'mc-foot' }, ...host.caps.map((k) => h('kbd', {}, k.cap)), ` ${t('mode.next')}`) : null;
        this.pop = h('div', { class: 'mc-pop', id: 'mode-pop', role: 'menu', 'aria-label': t('mode.chip.title'), hidden: true },
            ...this.items.map((i) => i.b), this.note, foot);
        this.el = h('div', { class: 'mode-chip interactive' }, this.btn, this.pop);
        this.pop.addEventListener('keydown', (e) => this.onKey(e));
        this.btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' && this.pop.hidden) { e.preventDefault(); this.open(); }
        });
        this.update();
    }

    get isOpen(): boolean {
        return !this.pop.hidden;
    }

    /** Text, state and the popover's choices; cheap when nothing changed (called at 10 Hz). */
    update(): void {
        const m = this.host.current();
        const radio = this.host.radio();
        const key = `${m}|${radio ?? ''}`;
        if (key === this.shown) return;
        this.shown = key;
        this.label.textContent = t(`mode.${m}`);
        this.src.hidden = radio === null;
        this.src.textContent = radio ?? '';
        this.btn.dataset.mode = m;
        this.btn.classList.toggle('radio', radio !== null);
        this.btn.setAttribute('aria-label', `${t('mode.chip.aria', { mode: t(`mode.${m}`) })}${radio ? `. ${t('mode.radioDecides', { src: radio })}` : ''}`);
        this.btn.title = radio ? t('mode.radioDecides', { src: radio }) : t('mode.chip.title');
        this.note.hidden = radio === null;
        this.note.textContent = radio ? t('mode.radioDecides', { src: radio }) : '';
        for (const i of this.items) {
            i.b.setAttribute('aria-checked', String(i.m === m));
            i.b.setAttribute('aria-disabled', String(radio !== null));
        }
    }

    /** `byKey`: Enter / Space on the chip (focus goes back to it on close); a click leaves no focus behind. */
    toggle(byKey = false): void {
        if (this.isOpen) this.close(byKey);
        else this.open();
    }

    open(): void {
        if (this.isOpen) return;
        this.update();
        this.pop.hidden = false;
        this.btn.setAttribute('aria-expanded', 'true');
        (this.items.find((i) => i.b.getAttribute('aria-checked') === 'true') ?? this.items[0]).b.focus({ preventScroll: true });
        addEventListener('pointerdown', this.outside, { capture: true });
    }

    /**
     * `focusChip`: closed from the keyboard, the focus goes back to the chip. Otherwise nothing of
     * the chip keeps the focus: a mouse pilot who then flies with the keyboard must not have Space
     * or Enter land on the chip.
     */
    close(focusChip = false): void {
        if (!this.isOpen) return;
        this.pop.hidden = true;
        this.btn.setAttribute('aria-expanded', 'false');
        removeEventListener('pointerdown', this.outside, { capture: true });
        if (focusChip) this.btn.focus({ preventScroll: true });
        else if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    }

    /**
     * Beside the OSD's top line, vertically centred on it; below it when the two would reach the
     * right-hand line. Hidden while that line is not shown (H, cinema, a screen over the view).
     */
    place(tl: HTMLElement | null, tr: HTMLElement | null): void {
        if (!tl || tl.offsetParent === null || tl.getClientRects().length === 0) {
            if (!this.el.hidden) { this.close(); this.el.hidden = true; }
            return;
        }
        if (this.el.hidden) this.el.hidden = false;
        const a = tl.getBoundingClientRect();
        const w = this.btn.offsetWidth;
        const ch = this.btn.offsetHeight;
        const r = tr && tr.offsetParent !== null ? tr.getBoundingClientRect() : null;
        let left = a.right + GAP;
        let top = a.top + a.height / 2 - ch / 2;
        if (left + w > (r ? r.left : innerWidth - 16) - GAP) { left = a.left; top = a.bottom + 4; }
        const key = `${Math.round(left)}|${Math.round(top)}`;
        if (key === this.placed) return;
        this.placed = key;
        this.el.style.left = `${Math.round(left)}px`;
        this.el.style.top = `${Math.round(top)}px`;
    }

    dispose(): void {
        this.close();
        this.el.remove();
    }

    private choose(m: FlightMode, byKey: boolean): void {
        if (this.host.radio() !== null) return; // the radio's switch decides: the choices are off
        this.host.pick(m);
        this.update();
        this.close(byKey);
    }

    private onKey(e: KeyboardEvent): void {
        const list = this.items.map((i) => i.b);
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'Escape') {
            // the menu's own Esc: it closes the popover, not the flight (the page's P / Esc router never sees it)
            e.preventDefault();
            e.stopPropagation();
            this.close(true);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = list.length;
            list[(at + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n].focus({ preventScroll: true });
        } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            list[e.key === 'Home' ? 0 : list.length - 1].focus({ preventScroll: true });
        } else if (e.key === 'Tab') {
            this.close();
        }
    }

    private outside = (e: Event): void => {
        if (!this.el.contains(e.target as Node)) this.close();
    };
}

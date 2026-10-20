// The "How to fly" card (v0.10 lane K, docs/wip/v10-k.md): draws the model of ui/controls-card-logic.ts as a dialog over the
// flight view. A panel (ui/dom.ts: role dialog, aria-modal, the x, and the Esc that app/builtin/pause.ts routes to the topmost
// panel's x), so while it is up flying keys and the pause menu stay out of it (devices/keyboard.ts dialogOpen). Focus goes to
// the Start button; Tab stays inside the card; the "Do not show again" box is a labelled input that writes the setting at once
// (app/builtin/how-to-fly.ts), so closing with x or Esc keeps it.
import { h, panel } from './dom';
import { t } from '../i18n';
import type { CardModel, CardRow, HeroKey } from './controls-card-logic';
import './controls-card.css';

export interface HowToFlyCard {
    root: HTMLDivElement;
    start: HTMLButtonElement;
    hide: HTMLInputElement;
    /** the Start button takes the focus (the card's first stop for a keyboard and a screen reader) */
    focusStart(): void;
    /** every control inside the card, in Tab order (the Tab trap and the tests read it) */
    focusables(): HTMLElement[];
}

export interface HowToFlyOptions {
    /** "Do not show again" is ticked now (the setting is off) */
    hideChecked: boolean;
    /** Start flying: the card goes and the flight goes on (and, for the game scheme, the mouse is captured: app/builtin/how-to-fly.ts) */
    onStart(): void;
    /** the x or Esc: the card goes, nothing else changes */
    onClose(): void;
    /** the box was (un)ticked */
    onHide(hidden: boolean): void;
}

const caps = (cs: readonly string[], big = false): HTMLSpanElement => h('span', { class: 'htf-caps' }, ...cs.map((c) => h('kbd', { class: big ? 'htf-cap big' : 'htf-cap' }, c)));

/** One key of the vertical pair: the cap, an arrow, the word and the small line. The colour says up or down, the arrow and the word say it too. */
function heroKey(side: 'up' | 'down', k: HeroKey): HTMLDivElement {
    return h('div', { class: `htf-pair ${side}`, 'data-testid': `htf-${side}` },
        caps(k.caps, true),
        h('span', { class: 'htf-what' },
            h('span', { class: 'htf-arrow', 'aria-hidden': 'true' }, side === 'up' ? '↑' : '↓'),
            h('span', { class: 'htf-word' },
                h('strong', {}, k.word),
                h('small', {}, k.sub))));
}

function rowEl(r: CardRow): HTMLLIElement {
    const keys = r.caps.length > 0 ? caps(r.caps) : h('span', { class: 'htf-tag' }, r.tag ?? '');
    return h('li', { 'data-row': r.id }, keys, h('span', { class: 'htf-text' }, r.text));
}

function padEl(name: string, text: string, side: 'left' | 'right'): HTMLDivElement {
    return h('div', { class: `htf-pad ${side}` },
        h('span', { class: 'htf-pad-art', 'aria-hidden': 'true' }),
        h('span', { class: 'htf-pad-text' }, h('strong', {}, name), h('span', {}, text)));
}

export function buildHowToFlyCard(model: CardModel, o: HowToFlyOptions): HowToFlyCard {
    const p = panel(model.title, () => o.onClose());
    p.root.classList.add('how-to-fly');
    p.root.setAttribute('data-testid', 'how-to-fly');
    p.root.setAttribute('data-kind', model.kind);
    // the panel's x already carries "Close" for a screen reader and the Esc key
    const x = p.root.querySelector<HTMLButtonElement>('.panel-x');
    if (x) {
        x.setAttribute('data-action', 'htf-close');
        x.setAttribute('aria-label', t('common.close'));
        x.setAttribute('aria-keyshortcuts', 'Escape');
        x.title = `${t('common.close')} (Esc)`;
    }
    p.root.querySelector('h2')?.setAttribute('id', 'htf-title');
    p.root.setAttribute('aria-labelledby', 'htf-title');
    p.root.removeAttribute('aria-label');

    const start = h('button', { type: 'button', class: 'btn primary htf-start', 'data-action': 'htf-start', onclick: () => o.onStart() }, t('play.card.start'));
    const hide = h('input', { type: 'checkbox', 'data-testid': 'htf-hide', id: 'htf-hide' });
    hide.checked = o.hideChecked;
    hide.addEventListener('change', () => o.onHide(hide.checked));
    const label = h('label', { class: 'htf-check', for: 'htf-hide' }, hide, h('span', {}, t('play.card.hide')));

    const body = p.body;
    body.classList.add('htf-body');
    body.append(h('p', { class: 'htf-sub' }, model.sub));
    if (model.hero) body.append(h('div', { class: 'htf-hero' }, heroKey('up', model.hero.up), heroKey('down', model.hero.down)));
    if (model.pads) body.append(h('div', { class: 'htf-pads' }, padEl(model.pads.left, model.pads.leftText, 'left'), padEl(model.pads.right, model.pads.rightText, 'right')));
    if (model.rows.length > 0) {
        const list = h('ul', { class: 'htf-rows' }, ...model.rows.map(rowEl));
        list.style.setProperty('--htf-rows', String(Math.ceil(model.rows.length / 2)));
        body.append(list);
    }
    if (model.note) body.append(h('p', { class: 'htf-note' }, model.note));
    body.append(h('div', { class: 'htf-actions' }, start, label));
    if (model.foot) body.append(h('p', { class: 'htf-foot' }, model.foot));

    const focusables = (): HTMLElement[] => [...p.root.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
    // Tab stays inside the card (aria-modal): from the last control to the first and back
    p.root.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        const at = document.activeElement;
        if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    });
    return { root: p.root, start, hide, focusStart: () => start.focus({ preventScroll: true }), focusables };
}

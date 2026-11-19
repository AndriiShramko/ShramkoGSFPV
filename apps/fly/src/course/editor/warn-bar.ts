// The warning box of the course editor (lane edit4c, stage C1w, complaint E11; design edit4.md 5 C1). The owner's words
// (brief 561): while he moves or turns a gate into a place that breaks the course, warn him at once, and let him keep it.
// While a gate drags the box is a tag above it with the warnings (warn.ts placeWarnings, words pieces-texts.ts); on a release
// with a warning it asks 'Keep it here?' with Keep, Put back (the undo key's row) and its 44 px cross; no answer in
// KEEP_ASK_MS keeps the gate. No modal: the scene stays usable; another edit closes it (the page keeps the gate silently).
import { t } from '../../i18n';
import type { Warning } from './warn';
import { KEEP_ASK_MS, warnPlace } from './warn';
import { ASK_KEY, CLOSE_KEY, KEEP_KEY, PUT_BACK_KEY, warnLines, type TextRef } from './pieces-texts';
import './pieces.css';

export interface WarnBarHost {
    /** the selected gate on the page (CSS px) and its depth (above 0: in front); null: none */
    where(): readonly [number, number, number] | null;
    /** the bottom of the editor's top bar on the page, CSS px (the box never goes under it) */
    topClear(): number;
    /** Put back: the release becomes undone (the undo key's row) */
    putBack(): void;
    /** the gate stays where the pilot put it (Keep, the cross, no answer in time, or another edit) */
    kept(gate: string): void;
}

/** What the box shows now, for the page probes (read only). */
export interface WarnBarState {
    readonly mode: 'off' | 'tag' | 'ask';
    readonly gate: string | null;
    readonly codes: readonly string[];
    readonly lines: readonly string[];
}

const words = (r: TextRef): string => t(r.key, r.vars);

export class WarnBar {
    readonly root: HTMLElement;
    private readonly list: HTMLElement;
    private readonly askRow: HTMLElement;
    private mode: WarnBarState['mode'] = 'off';
    private gate: string | null = null;
    private codes: string[] = [];
    private lines: string[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private frame = 0;

    constructor(ui: HTMLElement, private readonly host: WarnBarHost) {
        const root = document.createElement('div');
        root.className = 'ce-warn interactive';
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');
        root.dataset.testid = 'ce-warn';
        root.hidden = true;
        const list = document.createElement('div');
        list.className = 'ce-warn-lines';
        const askRow = document.createElement('div');
        askRow.className = 'ce-warn-ask';
        askRow.hidden = true;
        const q = document.createElement('span');
        q.className = 'ce-warn-q';
        q.textContent = t(ASK_KEY);
        const keep = this.button(t(KEEP_KEY), 'keep', () => this.keep());
        const back = this.button(t(PUT_BACK_KEY), 'put-back', () => {
            this.close();
            host.putBack();
        });
        askRow.append(q, keep, back);
        const cross = this.button('×', 'close', () => this.keep());
        cross.classList.add('ce-warn-x');
        cross.title = t(CLOSE_KEY);
        cross.setAttribute('aria-label', t(CLOSE_KEY));
        root.append(cross, list, askRow);
        ui.append(root);
        this.root = root;
        this.list = list;
        this.askRow = askRow;
    }

    private button(label: string, id: string, run: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ce-warn-b';
        b.dataset.warn = id;
        b.textContent = label;
        // the press gives the focus back, so the editor's keys go on working at once
        b.addEventListener('click', () => {
            b.blur();
            run();
        });
        return b;
    }

    /** While a gate drags: the tag with its warnings (none: the tag goes). A question still open is answered Keep first. */
    live(gate: string, ws: readonly Warning[]): void {
        if (this.mode === 'ask') this.keep();
        if (ws.length === 0) {
            this.close();
            return;
        }
        this.fill('tag', gate, ws);
    }

    /** On a release: with a warning the question for KEEP_ASK_MS; without one the box goes. */
    ask(gate: string, ws: readonly Warning[]): void {
        if (this.mode === 'ask') this.keep();
        if (ws.length === 0) {
            this.close();
            return;
        }
        this.fill('ask', gate, ws);
        this.timer = setTimeout(() => this.keep(), KEEP_ASK_MS);
    }

    /** the pilot ends the question without a press on it (key Esc, Add armed): as its cross, the gate is kept */
    dismiss(): void {
        this.keep();
    }

    /** the gate the open question is about (null: no question) */
    asking(): string | null {
        return this.mode === 'ask' ? this.gate : null;
    }

    debug(): WarnBarState {
        return { mode: this.mode, gate: this.gate, codes: [...this.codes], lines: [...this.lines] };
    }

    private fill(mode: 'tag' | 'ask', gate: string, ws: readonly Warning[]): void {
        this.mode = mode;
        this.gate = gate;
        this.codes = ws.map((w) => w.code);
        this.lines = warnLines(ws).map(words);
        this.list.replaceChildren(...this.lines.map((l) => {
            const p = document.createElement('div');
            p.textContent = l;
            return p;
        }));
        this.askRow.hidden = mode !== 'ask';
        this.root.hidden = false;
        this.root.dataset.mode = mode;
        if (!this.frame) this.frame = requestAnimationFrame(this.tick);
    }

    private keep(): void {
        const gate = this.gate;
        const was = this.mode;
        this.close();
        if (was === 'ask' && gate) this.host.kept(gate);
    }

    /** the box goes without an answer (a drag that left the warnings, the editor closing) */
    close(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.mode = 'off';
        this.gate = null;
        this.codes = [];
        this.lines = [];
        this.root.hidden = true;
        cancelAnimationFrame(this.frame);
        this.frame = 0;
    }

    private tick = (): void => {
        this.frame = 0;
        if (this.mode === 'off') return;
        const pos = warnPlace(this.host.where(), window.innerWidth, window.innerHeight, this.root.offsetWidth || 320, this.root.offsetHeight || 60, this.host.topClear());
        if (!pos) this.root.style.visibility = 'hidden';
        else {
            this.root.style.visibility = 'visible';
            this.root.style.transform = `translate(${pos[0]}px, ${pos[1]}px)`;
        }
        this.frame = requestAnimationFrame(this.tick);
    };

    destroy(): void {
        this.close();
        this.root.remove();
    }
}

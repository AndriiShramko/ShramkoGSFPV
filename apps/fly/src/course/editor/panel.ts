// The course editor's window (tracks-plan.md 2.11, lane tracks, stage T3-editor-ui): the selected gate, the problems, the
// last action or refusal (said through a live region, so it works without seeing), the key table as buttons (a click runs
// the same row as the key), "Save as my course" with a name, "Save for everyone", and the scene's courses with their marks
// and votes. The window needs the cursor: '.course-editor' is in CURSOR_WINDOWS (play/mouse-look.ts).
import { t } from '../../i18n';
import type { CourseRow } from '../store';
import type { KeyPress } from './keys';
import { KEY_ROWS } from './keys';
import { markText } from './words';
import { mayVote } from './rules';
import './editor.css';

export interface PanelHost {
    key(press: KeyPress): void;
    saveMine(name: string, title: string): void;
    saveAll(): void;
    /** stage F1-finish: the admin's version of the edited gates (offered only with an admin session) */
    saveAdmin(title: string): void;
    vote(id: string, v: 1 | -1): void;
    open(id: string): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
};

export class EditorPanel {
    readonly root: HTMLElement;
    private readonly gate: HTMLElement;
    private readonly problems: HTMLElement;
    private readonly live: HTMLElement;
    private readonly name: HTMLInputElement;
    private readonly title: HTMLInputElement;
    private readonly mine: HTMLButtonElement;
    private readonly all: HTMLButtonElement;
    private readonly admin: HTMLButtonElement;
    private readonly rows: HTMLElement;

    constructor(ui: HTMLElement, private readonly host: PanelHost) {
        const root = el('section', 'course-editor interactive');
        root.setAttribute('aria-label', t('course.edit.title'));
        root.append(el('h2', 'ce-title', t('course.edit.title')));
        this.gate = el('p', 'ce-gate');
        this.problems = el('p', 'ce-problems');
        this.live = el('p', 'ce-live');
        this.live.setAttribute('aria-live', 'polite');
        this.live.setAttribute('role', 'status');
        root.append(this.gate, this.problems, this.live);

        const keys = el('div', 'ce-keys');
        keys.setAttribute('role', 'group');
        keys.setAttribute('aria-label', t('course.edit.keys'));
        for (const r of KEY_ROWS) {
            const b = el('button', 'ce-key');
            b.type = 'button';
            b.dataset.code = r.press.code + (r.press.shiftKey ? '+shift' : '');
            b.append(el('kbd', undefined, r.caps), el('span', undefined, t(r.labelKey)));
            b.addEventListener('click', () => host.key(r.press));
            keys.append(b);
        }
        root.append(keys);

        const save = el('div', 'ce-save');
        this.name = el('input', 'ce-name');
        this.name.placeholder = t('course.edit.name');
        this.name.setAttribute('aria-label', t('course.edit.name'));
        this.name.maxLength = 32;
        this.title = el('input', 'ce-course-title');
        this.title.placeholder = t('course.edit.courseTitle');
        this.title.setAttribute('aria-label', t('course.edit.courseTitle'));
        this.title.maxLength = 60;
        this.mine = el('button', 'ce-save-mine', t('course.edit.saveMine'));
        this.mine.type = 'button';
        this.mine.addEventListener('click', () => host.saveMine(this.name.value, this.title.value));
        this.all = el('button', 'ce-save-all', t('course.edit.saveAll'));
        this.all.type = 'button';
        this.all.addEventListener('click', () => host.saveAll());
        this.admin = el('button', 'ce-save-admin', t('course.edit.saveAdmin'));
        this.admin.type = 'button';
        this.admin.hidden = true;
        this.admin.addEventListener('click', () => host.saveAdmin(this.title.value));
        save.append(this.name, this.title, this.mine, this.all, this.admin);
        root.append(save);

        root.append(el('h3', 'ce-list-title', t('course.edit.list')));
        this.rows = el('ul', 'ce-list');
        root.append(this.rows);
        ui.append(root);
        this.root = root;
    }

    status(gate: string, problems: string, bad: boolean): void {
        this.gate.textContent = gate;
        this.problems.textContent = problems;
        this.problems.classList.toggle('bad', bad);
    }

    say(text: string, refused = false): void {
        this.live.textContent = text;
        this.live.classList.toggle('bad', refused);
    }

    defaults(name: string, title: string): void {
        if (!this.name.value) this.name.value = name;
        this.title.value = title;
    }

    buttons(canAll: boolean): void {
        this.all.disabled = !canAll;
    }

    /** the admin's save button: shown only when an admin session answered */
    adminOn(on: boolean): void {
        this.admin.hidden = !on;
    }

    /** Enter to save without a name: the name field takes the focus (true when it did) */
    askName(): boolean {
        if (this.name.value.trim()) return false;
        this.name.focus();
        return true;
    }

    /** F6 (review TK-3): the keyboard's way into the window; Tab then walks its fields and buttons */
    focusName(): void {
        this.name.focus();
    }

    names(): { name: string; title: string } {
        return { name: this.name.value, title: this.title.value };
    }

    /** a text field of the window has the keys (the editor's key table stands aside) */
    typing(target: EventTarget | null): boolean {
        return target === this.name || target === this.title;
    }

    /** `lapped`: the course ids flown to a lap in this browser; only their rows may vote (tracks-plan 2.9) */
    list(rows: readonly CourseRow[], mine: Record<string, number>, current: string | null, lapped: ReadonlySet<string> = new Set()): void {
        this.rows.replaceChildren();
        if (rows.length === 0) {
            this.rows.append(el('li', 'ce-empty', t('course.edit.listEmpty')));
            return;
        }
        for (const r of rows) {
            const li = el('li', 'ce-row');
            li.dataset.id = r.id;
            if (r.id === current) li.classList.add('current');
            const head = el('div', 'ce-row-head');
            head.append(el('b', undefined, r.title), el('span', 'ce-gates', ` ${t('course.edit.gates', { n: r.gates })}`));
            const marks = el('div', 'ce-marks');
            const by = markText(r.creator);
            if (by) marks.append(el('span', 'ce-by', t('course.edit.by', { name: by })));
            const ed = markText(r.editor);
            if (ed) marks.append(el('span', 'ce-edited', t('course.edit.editedBy', { name: ed })));
            const votes = el('div', 'ce-votes');
            const mv = mine[r.id] ?? 0;
            const up = el('button', 'ce-up', `+ ${r.up ?? 0}`);
            up.type = 'button';
            up.setAttribute('aria-label', `${t('course.edit.voteUp')}: ${r.up ?? 0}`);
            up.setAttribute('aria-pressed', String(mv === 1));
            up.addEventListener('click', () => this.host.vote(r.id, 1));
            const down = el('button', 'ce-down', `- ${r.down ?? 0}`);
            down.type = 'button';
            down.setAttribute('aria-label', `${t('course.edit.voteDown')}: ${r.down ?? 0}`);
            down.setAttribute('aria-pressed', String(mv === -1));
            down.addEventListener('click', () => this.host.vote(r.id, -1));
            const open = el('button', 'ce-open', t('course.edit.open'));
            open.type = 'button';
            open.addEventListener('click', () => this.host.open(r.id));
            votes.append(up, down, open);
            if (!mayVote(r.id, lapped)) {
                up.disabled = true;
                down.disabled = true;
                votes.append(el('span', 'ce-lap', t('course.edit.voteAfterLap')));
            }
            if (mv !== 0) votes.append(el('span', 'ce-mine', t('course.edit.mine')));
            li.append(head, marks, votes);
            this.rows.append(li);
        }
    }

    destroy(): void {
        this.root.remove();
    }
}

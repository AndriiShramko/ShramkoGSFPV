// The course editor's window (tracks-plan.md 2.11, lane tracks, stage T3-editor-ui): the selected gate, the problems, the
// last action or refusal (said through a live region, so it works without seeing), the key table as buttons (a click runs
// the same row as the key), "Save as my course" with a name, "Save for everyone", and the scene's courses with their marks
// and votes. The window needs the cursor: '.course-editor' is in CURSOR_WINDOWS (play/mouse-look.ts).
import { t } from '../../i18n';
import type { CourseRow } from '../store';
import type { KeyPress } from './keys';
import { CAM_ROWS, KEY_ROWS } from './keys';
import { markText } from './words';
import { mayVote } from './rules';
import { flashPart } from './flash';
import './editor.css';
import './keep.css';
import { clockOf, type DraftEntry } from './drafts';
import { draftByKey } from './keep-texts';

export interface PanelHost {
    key(press: KeyPress): void;
    saveMine(name: string, title: string): void;
    saveAll(): void;
    /** stage F1-finish: the admin's version of the edited gates (offered only with an admin session) */
    saveAdmin(title: string): void;
    vote(id: string, v: 1 | -1): void;
    open(id: string): void;
    /** lane edit4s: Versions, back to the kept draft at this index (newest first) */
    back?(index: number): void;
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
    private readonly drawer: HTMLButtonElement;
    private readonly keys: HTMLElement;
    private readonly listTitle: HTMLElement;
    private readonly versionsBox: HTMLElement;
    private readonly versionRows: HTMLElement;

    constructor(ui: HTMLElement, private readonly host: PanelHost) {
        const root = el('section', 'course-editor interactive');
        root.setAttribute('aria-label', t('course.edit.title'));
        // lane editor3 E4.6: on a phone the window is a drawer, closed by default (only its title and the gate line); its
        // title opens and closes it (editor.css); on a desktop the press changes nothing. Focus goes back to the page so
        // Tab still takes the next gate.
        const title = el('h2', 'ce-title');
        const drawer = el('button', 'ce-drawer', t('course.edit.title'));
        drawer.setAttribute('type', 'button');
        drawer.setAttribute('aria-expanded', 'false');
        drawer.addEventListener('click', () => {
            const open = root.classList.toggle('ce-open');
            drawer.setAttribute('aria-expanded', String(open));
            drawer.blur();
        });
        title.append(drawer);
        root.append(title);
        this.drawer = drawer;
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
        // review ED-7: the camera's keys and the mouse as lines of the same table
        for (const r of CAM_ROWS) {
            const line = el('div', 'ce-key ce-cam');
            if (r.caps) line.append(el('kbd', undefined, r.caps));
            line.append(el('span', undefined, t(r.labelKey)));
            keys.append(line);
        }
        root.append(keys);
        this.keys = keys;

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

        // lane edit4s (E6): the drafts this browser kept, each with a way back (parts/keep.ts)
        this.versionsBox = el('div', 'ce-versions');
        this.versionsBox.append(el('h3', 'ce-versions-title', t('course.keep.versions')), el('p', 'ce-versions-note', t('course.keep.versionsNote')));
        this.versionRows = el('ul', 'ce-version-list');
        this.versionsBox.append(this.versionRows);
        root.append(this.versionsBox);
        this.versions([]);

        this.listTitle = el('h3', 'ce-list-title', t('course.edit.list'));
        root.append(this.listTitle);
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
        this.reveal('save');
        this.name.focus();
        return true;
    }

    /** F6 (review TK-3): the keyboard's way into the window; Tab then walks its fields and buttons */
    focusName(): void {
        this.reveal('save');
        this.name.focus();
    }

    /** review ED-7: the window opens (on a phone its drawer) and shows that part; the focus stays on the page */
    /** lane edit4s (E6): the kept drafts, newest first: time, gates, what changed, and a button back to each */
    versions(list: readonly Pick<DraftEntry, 't' | 'gates' | 'by' | 'saved'>[]): void {
        this.versionRows.replaceChildren();
        if (list.length === 0) {
            this.versionRows.append(el('li', 'ce-empty', t('course.keep.versionsEmpty')));
            return;
        }
        list.forEach((d, i) => {
            const li = el('li', 'ce-version');
            const what = t(draftByKey(d.by)) + (d.saved ? ` · ${t('course.keep.versionSaved')}` : '');
            const b = el('button', 'ce-version-back', t('course.keep.version', { time: clockOf(d.t), n: d.gates, what }));
            b.type = 'button';
            b.title = t('course.keep.back');
            b.setAttribute('aria-label', `${t('course.keep.back')}: ${b.textContent ?? ''}`);
            b.addEventListener('click', () => {
                this.host.back?.(i);
                b.blur();
            });
            li.append(b);
            this.versionRows.append(li);
        });
    }

    /** lane edit4s: Course > Versions opens the window at the kept drafts */
    revealVersions(): void {
        this.root.classList.add('ce-open');
        this.drawer.setAttribute('aria-expanded', 'true');
        this.versionsBox.scrollIntoView({ block: 'nearest' });
        flashPart(this.versionRows);
    }

    reveal(part: 'save' | 'keys' | 'courses'): void {
        this.root.classList.add('ce-open');
        this.drawer.setAttribute('aria-expanded', 'true');
        const at = part === 'keys' ? this.keys : part === 'courses' ? this.listTitle : this.name;
        at.scrollIntoView({ block: 'nearest' });
        // editfix E2.4: the part lights up, so the press has a visible effect even when it was already on screen
        flashPart(part === 'courses' ? this.rows : at);
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

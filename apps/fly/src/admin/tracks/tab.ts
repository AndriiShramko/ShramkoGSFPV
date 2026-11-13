// The admin's Tracks tab (train 2, lane tracks, stage T4-admin; tracks-plan 2.10, requirement R8): the courses pilots and the generator
// saved for everyone, per scene. The owner sees every course, hidden ones too, with its versions, who created and who edited it, its votes
// and broken reports; he hides and shows a course, renames it (a new version marked "edited by the admin", the creator kept), deletes one
// version or the whole course, resets votes or broken reports, and opens a course in the simulator's editor (a new tab). Deletes and
// resets ask "sure?" and wait for a second click. The server (apps/api/tracks_admin.py) checks everything again and logs each action.
import { h, clear } from '../../ui/dom';
import { locale, t } from '../i18n';
import type { AdminClient } from '../api';
import { ApiError } from '../api';
import { TracksAdminClient } from './api';
import { confirmStep, editorLink, isHidden, markParts, matches, renamed, sortRows, sortScenes, titleIssue } from './model';
import type { AdminTrackRow, Mark, SceneCount, SortBy } from './model';

const CONFIRM_MS = 6000;

function dateTime(iso: string | null | undefined): string {
    const d = iso ? new Date(iso) : null;
    return d !== null && !Number.isNaN(d.getTime()) ? d.toLocaleString(locale, { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
}

function markText(m: Mark | null): string {
    const p = markParts(m);
    if (!p) return '';
    const who = t(`admin.tracks.kind.${p.kind}`);
    return p.name ? t('admin.tracks.mark.named', { name: p.name, kind: who }) : who;
}

export class TracksTab {
    readonly root: HTMLElement;
    private readonly client: TracksAdminClient;
    private readonly head = h('section', { class: 'card t-head', 'data-testid': 't-head' });
    private listBox: HTMLElement = h('div', { class: 't-list', 'data-testid': 't-list' });
    private scenes: SceneCount[] = [];
    private scene = '';
    private rows: AdminTrackRow[] = [];
    private sort: SortBy = 'new';
    private query = '';
    /** the row being renamed */
    private renaming: string | null = null;
    /** the action that asked "sure?": `delete:<id>`, `delete:<id>:<n>`, `reset-votes:<id>`, `reset-broken:<id>` */
    private confirming: string | null = null;
    private confirmTimer: ReturnType<typeof setTimeout> | null = null;
    private askedAt = 0;
    private busy = false;

    constructor(api: AdminClient, private readonly say: (msg: string, bad?: boolean) => void) {
        this.client = new TracksAdminClient(api);
        this.root = h('div', { class: 'tab-body tracks', 'data-testid': 'tracks' }, this.head, this.listBox);
    }

    async flush(): Promise<void> {
        if (this.confirmTimer !== null) clearTimeout(this.confirmTimer);
    }

    async load(): Promise<void> {
        this.scenes = sortScenes((await this.client.scenes()).scenes ?? []);
        if (!this.scenes.some((s) => s.scene === this.scene)) this.scene = this.scenes[0]?.scene ?? '';
        await this.loadRows();
    }

    private async loadRows(): Promise<void> {
        this.rows = this.scene ? (await this.client.rows(this.scene)).tracks ?? [] : [];
        this.renderHead();
        this.renderList();
    }

    private fail(e: unknown): void {
        const why = e instanceof ApiError ? e.reason || `http-${e.status}` : e instanceof Error ? e.message : String(e);
        const key = `admin.tracks.reason.${why}`;
        const w = t(key);
        this.say(t('admin.tracks.error', { why: w === key ? why : w }), true);
    }

    private async act(fn: () => Promise<unknown>, done: string): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        this.confirming = null;
        try {
            await fn();
            this.say(done);
            this.renaming = null;
            const keep = this.scene;
            this.scenes = sortScenes((await this.client.scenes()).scenes ?? []);
            this.scene = this.scenes.some((s) => s.scene === keep) ? keep : this.scenes[0]?.scene ?? '';
            await this.loadRows();
        } catch (e) {
            this.fail(e);
        } finally {
            // the rows were drawn while busy (buttons disabled): draw them again enabled (browser run A2: Show stayed disabled after Hide)
            this.busy = false;
            this.renderList();
        }
    }

    /** The first click asks "sure?" (the button's words change), the second within CONFIRM_MS does it. */
    private sure(key: string, fn: () => void): void {
        const step = confirmStep(this.confirming, this.askedAt, key, Date.now());
        if (step === 'ignore') return;
        if (step === 'do') {
            if (this.confirmTimer !== null) clearTimeout(this.confirmTimer);
            this.confirming = null;
            fn();
            return;
        }
        this.confirming = key;
        this.askedAt = Date.now();
        if (this.confirmTimer !== null) clearTimeout(this.confirmTimer);
        this.confirmTimer = setTimeout(() => {
            this.confirming = null;
            this.renderList();
        }, CONFIRM_MS);
        this.renderList();
    }

    private renderHead(): void {
        clear(this.head);
        const pick = h('select', { 'data-testid': 't-scene', 'aria-label': t('admin.tracks.scene') }) as HTMLSelectElement;
        for (const s of this.scenes) {
            pick.append(h('option', { value: s.scene, selected: s.scene === this.scene }, t('admin.tracks.sceneOption', { scene: s.scene, n: s.tracks, hidden: s.hidden })));
        }
        pick.addEventListener('change', () => {
            this.scene = pick.value;
            this.renaming = null;
            void this.loadRows().catch((e) => this.fail(e));
        });
        const sort = h('select', { 'data-testid': 't-sort', 'aria-label': t('admin.tracks.sort') }) as HTMLSelectElement;
        for (const k of ['new', 'votes', 'broken'] as const) sort.append(h('option', { value: k, selected: k === this.sort }, t(`admin.tracks.sort.${k}`)));
        sort.addEventListener('change', () => {
            this.sort = sort.value as SortBy;
            this.renderList();
        });
        const search = h('input', { type: 'search', value: this.query, 'data-testid': 't-search', placeholder: t('admin.tracks.search'), 'aria-label': t('admin.tracks.search') }) as HTMLInputElement;
        search.addEventListener('input', () => {
            this.query = search.value;
            this.renderList();
        });
        const refresh = h('button', { type: 'button', class: 'btn small', 'data-action': 't-refresh', onclick: () => void this.load().then(() => this.say(t('admin.tracks.refreshed'))).catch((e) => this.fail(e)) }, t('admin.tracks.refresh'));
        this.head.append(
            h('h2', {}, t('admin.tracks.title')),
            h('p', { class: 'muted' }, t('admin.tracks.help')),
            this.scenes.length === 0
                ? h('p', { 'data-testid': 't-empty' }, t('admin.tracks.noScenes'))
                : h('div', { class: 'toolbar' }, h('label', { class: 'field' }, h('span', {}, t('admin.tracks.scene')), pick), h('label', { class: 'field' }, h('span', {}, t('admin.tracks.sort')), sort), search, refresh)
        );
    }

    private renderList(): void {
        const box = h('div', { class: 't-list', 'data-testid': 't-list' });
        const shown = sortRows(this.rows, this.sort).filter((r) => matches(r, this.query));
        if (this.scene) box.append(h('p', { class: 'muted', 'data-testid': 't-count' }, t('admin.tracks.count', { shown: shown.length, all: this.rows.length, hidden: this.rows.filter(isHidden).length })));
        const ul = h('ul', { class: 'rows' });
        for (const r of shown) ul.append(this.renderRow(r));
        box.append(ul);
        this.listBox.replaceWith(box);
        this.listBox = box;
    }

    private renderRow(r: AdminTrackRow): HTMLElement {
        const hidden = isHidden(r);
        const ask = (key: string, words: string, fn: () => void, testid: string): HTMLElement =>
            h('button', { type: 'button', class: `btn small${this.confirming === key ? ' primary' : ''}`, 'data-action': testid, disabled: this.busy, onclick: () => this.sure(key, fn) }, this.confirming === key ? t('admin.tracks.sure') : words);
        const info = h('div', { class: 'row-info' },
            h('strong', { 'data-testid': 't-title' }, r.title),
            h('span', { class: 'muted' }, t('admin.tracks.line', { id: r.id, gates: r.gates, length: Math.round(r.lengthM), created: dateTime(r.created) })),
            h('span', { 'data-testid': 't-marks' }, [t('admin.tracks.createdBy', { who: markText(r.creator) }), r.editor ? t('admin.tracks.editedBy', { who: markText(r.editor), at: dateTime(r.edited) }) : ''].filter(Boolean).join('; ')),
            h('span', { 'data-testid': 't-votes' }, t('admin.tracks.votes', { up: r.up, down: r.down, broken: r.broken })),
            h('span', { 'data-testid': 't-versions' }, t('admin.tracks.versions', { list: r.versions.map((n) => `v${n}`).join(', '), latest: r.version })),
            hidden ? h('span', { class: 'bad', 'data-testid': 't-hidden' }, t(r.hidden === 'cap' ? 'admin.tracks.hiddenCap' : 'admin.tracks.hiddenNote')) : '',
            r.origin ? h('span', { class: 'muted' }, t('admin.tracks.forkOf', { id: r.origin.id, n: r.origin.version })) : ''
        );
        const actions = h('div', { class: 'row-actions' },
            hidden
                ? h('span', { class: 'muted', 'data-testid': 't-open-hidden' }, t('admin.tracks.openHidden'))
                : h('a', { class: 'btn small', href: editorLink(locale, this.scene, r.id, r.version), target: '_blank', rel: 'noopener', 'data-action': 't-open' }, t('admin.tracks.open')),
            h('button', { type: 'button', class: 'btn small', 'data-action': 't-hide', disabled: this.busy, onclick: () => void this.act(() => this.client.hide(r.id, !hidden), t(hidden ? 'admin.tracks.shownDone' : 'admin.tracks.hiddenDone')) }, t(hidden ? 'admin.tracks.show' : 'admin.tracks.hide')),
            h('button', { type: 'button', class: 'btn small', 'data-action': 't-rename', disabled: this.busy, onclick: () => { this.renaming = this.renaming === r.id ? null : r.id; this.renderList(); } }, t('admin.tracks.rename')),
            ask(`reset-votes:${r.id}`, t('admin.tracks.resetVotes'), () => void this.act(() => this.client.reset(r.id, 'votes'), t('admin.tracks.resetDone')), 't-reset-votes'),
            ask(`reset-broken:${r.id}`, t('admin.tracks.resetBroken'), () => void this.act(() => this.client.reset(r.id, 'broken'), t('admin.tracks.resetDone')), 't-reset-broken'),
            ...r.versions.map((n) => ask(`delete:${r.id}:${n}`, t('admin.tracks.deleteVersion', { n }), () => void this.act(() => this.client.remove(r.id, n), t('admin.tracks.deletedVersion', { n })), `t-delete-v${n}`)),
            ask(`delete:${r.id}`, t('admin.tracks.delete'), () => void this.act(() => this.client.remove(r.id, null), t('admin.tracks.deleted')), 't-delete')
        );
        const li = h('li', { class: `row${hidden ? ' is-hidden' : ''}`, 'data-id': r.id }, h('div', { class: 'row-main' }, info), actions);
        if (this.renaming === r.id) li.append(this.renameForm(r));
        return li;
    }

    private renameForm(r: AdminTrackRow): HTMLElement {
        const input = h('input', { type: 'text', value: r.title, maxlength: 120, 'data-testid': 't-rename-input', 'aria-label': t('admin.tracks.newTitle') }) as HTMLInputElement;
        const err = h('p', { class: 'bad', role: 'alert' });
        const form = h('form', { class: 'field t-rename' }, h('span', {}, t('admin.tracks.newTitle')), input, h('button', { type: 'submit', class: 'btn small primary', 'data-action': 't-rename-save' }, t('admin.tracks.renameSave')), err);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const issue = titleIssue(input.value, r.title);
            if (issue) {
                err.textContent = t(`admin.tracks.title.${issue}`, { min: 3, max: 60 });
                return;
            }
            void this.act(async () => this.client.version(r.id, renamed(await this.client.file(r.id, r.version), input.value)), t('admin.tracks.renamed'));
        });
        queueMicrotask(() => input.focus());
        return form;
    }
}

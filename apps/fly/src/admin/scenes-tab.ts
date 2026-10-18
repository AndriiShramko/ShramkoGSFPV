// The admin's Scenes tab: the catalogue pilots see in the picker, edited like a shop's front page.
// Every change saves the draft on the server (a short pause after the last one); pilots see nothing
// until Publish. What Publish would change is always on screen (catalogDiff: the sticky bar counts the
// changes and lists them, every changed row carries a badge, Publish is highlighted only then, and the
// browser asks before leaving with unpublished changes). Reorder by drag and drop, by the arrow keys on a
// row's handle, or by the up/down buttons (touch). Adding a scene: a SuperSplat link (read by lane R's
// one link parser, parseSceneLink; its ?budget= and ?stochastic go to the entry's render as the
// catalogue stores it, catalogueRender) or words from a title; SuperSplat's facts (title, author,
// licence, description, date, poster, walls, format, size) come through the server
// (/api/admin/superspl/<id>), the CDN check says whether the simulator opens it. "Refresh from SuperSplat"
// on a scene lists what SuperSplat says differently and applies the ticked fields.
import { CATALOG_SCALE_MAX, CATALOG_SCALE_MIN, SceneError, SuperSplatCatalog, applyFacts, catalogDiff, catalogueRender, collectionId, entryFromFacts, factChanges, formatVerdict, moveItem, parseSceneLink, posterUrl, resolveScene } from '@gsfpv/scenes';
import type { CatalogDiff, CatalogKind, CatalogScene, ExploreItem, FactField, LocalText, SceneCatalog, SceneRender, SuperSplatFacts } from '@gsfpv/scenes';
import { h, clear } from '../ui/dom';
import { t, locale } from './i18n';
import { ApiError } from './api';
import type { AdminClient, CatalogState } from './api';
import { placeEditor } from './place-editor';

const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const KINDS: CatalogKind[] = ['interior', 'exterior', 'other'];
const SAVE_AFTER_MS = 500;

const poster = (s: Pick<CatalogScene, 'id' | 'thumb' | 'version'>): string => s.thumb ?? posterUrl(s.id, 'm', s.version ?? 1);
const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : '');
/** SuperSplat's licence code as the credit line writes it ("by-nc" -> "CC BY-NC 4.0"). */
const licence = (code: string | null): string => (code ? `CC ${code.toUpperCase()} 4.0` : '');

export class ScenesTab {
    readonly root: HTMLElement;
    private draft: SceneCatalog = { collections: [], scenes: [] };
    private state: CatalogState | null = null;
    private editing = new Set<string>();
    private timer: number | null = null;
    private saving: Promise<void> | null = null;
    private dragFrom = -1;
    private readonly status = h('p', { class: 'status', role: 'status', 'data-testid': 'draft-status' });
    private readonly publishBtn = h('button', { type: 'button', class: 'btn primary', 'data-action': 'publish' }, t('admin.publish'));
    private readonly changesBox = h('details', { class: 'changes', 'data-testid': 'draft-changes', hidden: true });
    private diff: CatalogDiff = { scenes: [], collections: false, dirty: false };
    private readonly list = h('ol', { class: 'rows', 'data-testid': 'scene-list' });
    private readonly cols = h('div', { class: 'cols' });
    private readonly hist = h('ul', { class: 'history' });
    private readonly found = h('div', { class: 'found', 'aria-live': 'polite' });
    private readonly listHead = h('h2', {});
    private readonly ss = new SuperSplatCatalog();

    constructor(private readonly api: AdminClient, private readonly say: (msg: string, bad?: boolean) => void) {
        const q = h('input', { type: 'text', class: 'grow', 'aria-label': t('admin.add.label'), placeholder: t('admin.add.label'), autocomplete: 'off', 'data-testid': 'add-input' }) as HTMLInputElement;
        const find = (): void => { if (q.value.trim()) void this.find(q.value.trim()); };
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') find(); });
        const colName = h('input', { type: 'text', class: 'grow', maxlength: 40, 'aria-label': t('admin.collection.new'), placeholder: t('admin.collection.new') }) as HTMLInputElement;
        const addCol = (): void => {
            const title = colName.value.trim();
            if (!title) return;
            this.draft.collections.push({ id: collectionId(title, this.draft.collections.map((c) => c.id)), title: { en: title } });
            colName.value = '';
            this.changed(true);
        };
        colName.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCol(); });
        this.publishBtn.addEventListener('click', () => void this.publish());
        // the browser asks before the page goes away with changes pilots do not see yet
        window.addEventListener('beforeunload', (e) => { if (this.root.isConnected && this.diff.dirty) e.preventDefault(); });
        this.root = h('div', { class: 'tab-body' },
            h('div', { class: 'bar sticky' },
                this.status,
                this.publishBtn,
                h('button', { type: 'button', class: 'btn', 'data-action': 'discard', onclick: () => void this.discard() }, t('admin.discard')),
                h('a', { class: 'btn', href: '/en/fly/', target: '_blank', rel: 'noopener' }, t('admin.openPicker')),
                this.changesBox),
            h('section', { class: 'card' }, h('h2', {}, t('admin.add.title')),
                h('div', { class: 'bar' }, q, h('button', { type: 'button', class: 'btn', 'data-action': 'find', onclick: find }, t('admin.add.find'))), this.found),
            h('section', { class: 'card' }, h('h2', {}, t('admin.collections')), this.cols,
                h('div', { class: 'bar' }, colName, h('button', { type: 'button', class: 'btn', onclick: addCol }, t('admin.collection.add')))),
            h('section', { class: 'card' }, this.listHead, h('p', { class: 'muted' }, t('admin.list.help')), this.list),
            h('section', { class: 'card' }, h('h2', {}, t('admin.history')), this.hist)
        );
    }

    async load(): Promise<void> {
        this.take(await this.api.get<CatalogState>('catalog'), true);
    }

    /** Before the tab goes away: the last change still reaches the server. */
    async flush(): Promise<void> {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
            this.saving = this.save();
        }
        await this.saving;
    }

    private take(s: CatalogState, replaceDraft: boolean): void {
        this.state = s;
        if (replaceDraft) {
            this.draft = structuredClone(s.draft);
            this.renderAll();
        } else {
            this.renderStatus();
            this.renderHistory();
        }
    }

    private renderAll(): void {
        this.renderStatus();
        this.renderCollections();
        this.renderList();
        this.renderHistory();
    }

    /** A change by the admin: saved after a short pause; `structural` redraws the list (order, flags). */
    private changed(structural: boolean): void {
        if (structural) {
            this.renderCollections();
            this.renderList();
        }
        this.renderDiff();
        this.status.textContent = t('admin.status.saving');
        this.status.className = 'status';
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = window.setTimeout(() => { this.timer = null; this.saving = this.save(); }, SAVE_AFTER_MS);
    }

    private async save(): Promise<void> {
        try {
            this.take(await this.api.post<CatalogState>('catalog/draft', { catalog: this.draft }), false);
        } catch (e) {
            this.status.textContent = t('admin.status.error', { why: e instanceof ApiError ? e.reason || String(e.status) : t('admin.error.network') });
            this.status.className = 'status bad';
        }
    }

    private renderStatus(): void {
        this.renderDiff();
        const n = this.changeCount();
        this.status.textContent = this.diff.dirty ? t('admin.status.changes', { n }) : t('admin.status.live');
        this.status.className = `status ${this.diff.dirty ? 'warn' : 'ok'}`;
    }

    private changeCount(): number {
        return this.diff.scenes.length + (this.diff.collections ? 1 : 0);
    }

    /**
     * What Publish would change (the local draft against the live list): Publish highlighted only then,
     * the list of changes under the bar, a badge on every changed row (updated in place, no redraw).
     */
    private renderDiff(): void {
        this.diff = catalogDiff(this.draft, this.state?.published ?? null);
        const dirty = this.diff.dirty;
        this.publishBtn.disabled = !dirty;
        this.publishBtn.classList.toggle('attention', dirty);
        this.publishBtn.textContent = dirty ? `${t('admin.publish')} (${this.changeCount()})` : t('admin.publish');
        clear(this.changesBox);
        this.changesBox.hidden = !dirty;
        if (dirty) {
            const list = h('ul', {});
            for (const c of this.diff.scenes) {
                const fields = (c.fields ?? []).map((f) => fieldLabel(f)).join(', ');
                list.append(h('li', { 'data-change': c.kind, 'data-scene': c.id }, t(`admin.changes.${c.kind}`, { title: c.title, fields })));
            }
            if (this.diff.collections) list.append(h('li', { 'data-change': 'collections' }, t('admin.changes.collections')));
            this.changesBox.append(h('summary', {}, t('admin.changes.title')), list);
        }
        const kinds = new Map(this.diff.scenes.map((c) => [c.id, c.kind]));
        for (const badge of this.list.querySelectorAll<HTMLElement>('.change-badge')) {
            const kind = kinds.get(badge.dataset.scene ?? '');
            badge.hidden = !kind || kind === 'removed';
            badge.textContent = kind && kind !== 'removed' ? t(`admin.badge.${kind}`) : '';
            badge.className = `badge change-badge ${kind ?? ''}`;
        }
    }

    private async publish(): Promise<void> {
        await this.flush();
        try {
            this.take(await this.api.post<CatalogState>('catalog/publish', {}), true);
            this.say(t('admin.publish.done'));
        } catch (e) {
            this.say(e instanceof ApiError ? e.reason || String(e.status) : t('admin.error.network'), true);
        }
    }

    private async discard(): Promise<void> {
        if (!confirm(t('admin.discard.confirm'))) return;
        await this.flush();
        this.take(await this.api.post<CatalogState>('catalog/discard', {}), true);
    }

    private async restore(name: string, time: string): Promise<void> {
        if (!confirm(t('admin.history.confirm', { time }))) return;
        await this.flush();
        this.take(await this.api.post<CatalogState>('catalog/restore', { name }), true);
        this.say(t('admin.publish.done'));
    }

    private renderHistory(): void {
        clear(this.hist);
        const rows = this.state?.history ?? [];
        if (!rows.length) this.hist.append(h('li', { class: 'muted' }, t('admin.history.empty')));
        for (const v of rows) {
            const time = when(v.published);
            this.hist.append(h('li', {}, h('span', { class: 'grow' }, t('admin.history.row', { time, n: v.scenes }), v.note.startsWith('restore') ? ' ↺' : ''),
                h('button', { type: 'button', class: 'btn small', 'data-version': v.name, onclick: () => void this.restore(v.name, time) }, t('admin.history.restore'))));
        }
    }

    private renderCollections(): void {
        clear(this.cols);
        for (const c of this.draft.collections) {
            const inputs = LANGS.map((l) => {
                const i = h('input', { type: 'text', maxlength: 40, value: c.title[l] ?? '', 'aria-label': `${c.id} (${l})`, placeholder: l }) as HTMLInputElement;
                i.addEventListener('input', () => { setText(c.title, l, i.value); this.changed(false); });
                return i;
            });
            this.cols.append(h('div', { class: 'col-row', 'data-collection': c.id }, h('code', {}, c.id), ...inputs,
                h('button', { type: 'button', class: 'btn small', 'aria-label': t('admin.collection.remove'), title: t('admin.collection.remove'),
                    onclick: () => {
                        this.draft.collections = this.draft.collections.filter((x) => x !== c);
                        for (const s of this.draft.scenes) s.collections = s.collections?.filter((x) => x !== c.id);
                        this.changed(true);
                    } }, '×')));
        }
    }

    private move(from: number, to: number, focus = false): void {
        if (to < 0 || to >= this.draft.scenes.length || from === to) return;
        this.draft.scenes = moveItem(this.draft.scenes, from, to);
        this.changed(true);
        if (focus) this.list.querySelectorAll<HTMLElement>('.handle')[to]?.focus();
    }

    private renderList(): void {
        clear(this.list);
        this.listHead.textContent = t('admin.list.title', { n: this.draft.scenes.length });
        if (!this.draft.scenes.length) this.list.append(h('li', { class: 'muted' }, t('admin.list.empty')));
        this.draft.scenes.forEach((s, i) => this.list.append(this.row(s, i)));
        this.renderDiff();
    }

    private row(s: CatalogScene, i: number): HTMLLIElement {
        const open = this.editing.has(s.id);
        const li = h('li', { class: `row${s.hidden ? ' is-hidden' : ''}${s.pinned ? ' is-pinned' : ''}`, 'data-scene': s.id, draggable: open ? 'false' : 'true' });
        li.addEventListener('dragstart', (e) => { this.dragFrom = i; li.classList.add('dragging'); e.dataTransfer?.setData('text/plain', s.id); });
        li.addEventListener('dragend', () => { li.classList.remove('dragging'); this.dragFrom = -1; });
        li.addEventListener('dragover', (e) => { if (this.dragFrom >= 0) { e.preventDefault(); li.classList.add('drop'); } });
        li.addEventListener('dragleave', () => li.classList.remove('drop'));
        li.addEventListener('drop', (e) => { e.preventDefault(); li.classList.remove('drop'); if (this.dragFrom >= 0) this.move(this.dragFrom, i); });
        const handle = h('button', { type: 'button', class: 'handle', 'aria-label': t('admin.row.handle', { title: s.title }), title: t('admin.list.help'), 'aria-keyshortcuts': 'ArrowUp ArrowDown' }, '⠇');
        handle.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); this.move(i, i + (e.key === 'ArrowUp' ? -1 : 1), true); }
        });
        const flag = (on: boolean, cls: string, key: string): HTMLElement | null => (on ? h('span', { class: `badge ${cls}` }, t(key)) : null);
        const btn = (label: string, action: string, fn: () => void, pressed?: boolean): HTMLButtonElement =>
            h('button', { type: 'button', class: 'btn small', 'data-action': action, 'aria-pressed': pressed === undefined ? undefined : String(pressed), onclick: fn }, label);
        li.append(
            h('div', { class: 'row-main' },
                handle,
                h('img', { src: poster(s), alt: '', width: 96, height: 54, loading: 'lazy' }),
                h('div', { class: 'row-info' },
                    h('strong', { class: 'row-title' }, s.title),
                    h('span', { class: 'muted' }, [s.author, t(`admin.kind.${s.kind}`), s.license, s.id].filter(Boolean).join(' · ')),
                    h('span', { class: 'badges' }, h('span', { class: 'badge change-badge', 'data-scene': s.id, hidden: true }),
                        flag(!!s.pinned, 'pin', 'admin.badge.pinned'), flag(!!s.hidden, 'hid', 'admin.badge.hidden'),
                        flag(!s.collision, 'warn', 'admin.badge.noWalls'), flag(s.collision && s.walls === 'off', 'warn', 'admin.badge.wallsOff'))),
                h('div', { class: 'row-actions' },
                    btn('↑', 'up', () => this.move(i, i - 1)),
                    btn('↓', 'down', () => this.move(i, i + 1)),
                    btn(s.pinned ? t('admin.row.unpin') : t('admin.row.pin'), 'pin', () => { s.pinned = !s.pinned || undefined; this.changed(true); }, !!s.pinned),
                    btn(s.hidden ? t('admin.row.show') : t('admin.row.hide'), 'hide', () => { s.hidden = !s.hidden || undefined; this.changed(true); }, !!s.hidden),
                    btn(t('admin.row.edit'), 'edit', () => { if (open) this.editing.delete(s.id); else this.editing.add(s.id); this.renderList(); }, open),
                    h('a', { class: 'btn small', href: `/${locale}/scenes/${s.id}/`, target: '_blank', rel: 'noopener', 'data-action': 'scene-page' }, t('admin.scenePage')),
                    btn(t('admin.row.remove'), 'remove', () => {
                        if (!confirm(t('admin.row.removeConfirm', { title: s.title }))) return;
                        this.draft.scenes = this.draft.scenes.filter((x) => x !== s);
                        this.changed(true);
                    })))
        );
        if (open) li.append(this.editor(s, li));
        return li;
    }

    /** The fields of one scene; typing saves without redrawing the list (the cursor stays put). */
    private editor(s: CatalogScene, li: HTMLElement): HTMLElement {
        const bag = s as unknown as Record<string, unknown>;
        const text = (key: 'title' | 'author' | 'license' | 'thumb', max: number): HTMLElement => {
            const i = h('input', { type: key === 'thumb' ? 'url' : 'text', maxlength: max, value: (bag[key] as string | undefined) ?? '' }) as HTMLInputElement;
            i.addEventListener('input', () => {
                if (i.value.trim() || key === 'title') bag[key] = i.value; else delete bag[key];
                if (key === 'title') li.querySelector('.row-title')!.textContent = i.value;
                this.changed(false);
            });
            return field(t(`admin.field.${key}`), i);
        };
        const number = (key: 'dropFloaters' | 'scale' | 'voxelCm' | 'sizeMb' | 'version', min: number, max: number, step: number): HTMLElement => {
            const i = h('input', { type: 'number', min, max, step, inputmode: 'decimal', value: bag[key] === undefined ? '' : String(bag[key]), 'data-field': key }) as HTMLInputElement;
            i.addEventListener('input', () => {
                const v = i.valueAsNumber;
                if (Number.isFinite(v) && v >= min && v <= max) bag[key] = v; else delete bag[key];
                this.changed(false);
            });
            return field(t(`admin.field.${key}`), i);
        };
        const kind = h('select', {}) as HTMLSelectElement;
        for (const k of KINDS) kind.append(h('option', { value: k }, t(`admin.kind.${k}`)));
        kind.value = s.kind;
        kind.addEventListener('change', () => { s.kind = kind.value as CatalogKind; this.changed(true); });
        const walls = h('input', { type: 'checkbox' }) as HTMLInputElement;
        walls.checked = s.walls !== 'off';
        walls.addEventListener('change', () => { s.walls = walls.checked ? 'on' : 'off'; this.changed(true); });
        const pitch = LANGS.map((l) => {
            const i = h('input', { type: 'text', maxlength: 140, value: s.pitch?.[l] ?? '', 'data-pitch': l }) as HTMLInputElement;
            i.addEventListener('input', () => { s.pitch = setText(s.pitch ?? {}, l, i.value); this.changed(false); });
            return field(t('admin.field.pitch', { lang: l }), i);
        });
        const cols = this.draft.collections.map((c) => {
            const box = h('input', { type: 'checkbox', value: c.id }) as HTMLInputElement;
            box.checked = s.collections?.includes(c.id) ?? false;
            box.addEventListener('change', () => {
                const now = new Set(s.collections ?? []);
                if (box.checked) now.add(c.id); else now.delete(c.id);
                s.collections = this.draft.collections.map((x) => x.id).filter((x) => now.has(x));
                this.changed(false);
            });
            return h('label', { class: 'check' }, box, ' ', c.title.en ?? c.id);
        });
        return h('div', { class: 'editor' },
            this.refreshBlock(s, li),
            text('title', 120), text('author', 80), text('license', 40), field(t('admin.field.kind'), kind),
            ...pitch,
            h('label', { class: 'check' }, walls, ' ', t('admin.field.walls')),
            number('dropFloaters', 0, 64, 1), number('scale', CATALOG_SCALE_MIN, CATALOG_SCALE_MAX, 0.05), number('voxelCm', 0.1, 100, 0.1), number('sizeMb', 0.01, 100000, 0.1),
            number('version', 1, 999999, 1), text('thumb', 300),
            cols.length ? h('fieldset', { class: 'checks' }, h('legend', {}, t('admin.collections')), ...cols) : null,
            placeEditor(s, this.api, () => this.changed(false))
        );
    }

    /**
     * "Refresh from SuperSplat": asks the server for the scene's facts again (no cache) and lists every field
     * SuperSplat states differently, ticked except the title (often the owner's own wording) and empty
     * values; Apply takes the ticked ones into the entry and redraws the list.
     */
    private refreshBlock(s: CatalogScene, li: HTMLElement): HTMLElement {
        const out = h('div', { class: 'refresh', 'aria-live': 'polite' });
        const go = h('button', { type: 'button', class: 'btn small', 'data-action': 'refresh' }, t('admin.refresh'));
        go.addEventListener('click', async () => {
            go.disabled = true;
            clear(out);
            out.append(h('p', { class: 'muted' }, t('admin.refresh.checking')));
            let facts: SuperSplatFacts | null = null;
            let why = '';
            try {
                facts = await this.api.facts(s.id, true);
            } catch (e) {
                why = e instanceof ApiError ? e.reason || String(e.status) : t('admin.error.network');
            }
            go.disabled = false;
            clear(out);
            if (!facts) {
                out.append(h('p', { class: 'bad' }, t('admin.add.factsFailed', { why: why || 'bad-data' })));
                return;
            }
            const got = facts;
            const changes = factChanges(s, got);
            if (!changes.length) {
                out.append(h('p', { class: 'ok' }, t('admin.refresh.same')));
                return;
            }
            const boxes = changes.map((c) => {
                const box = h('input', { type: 'checkbox', value: c.field, 'data-refresh': c.field }) as HTMLInputElement;
                box.checked = c.field !== 'title' && !isEmpty(c.to);
                return { box, row: h('label', { class: 'check refresh-row' }, box, ' ', t('admin.refresh.field', { field: fieldLabel(c.field), from: show(c.from), to: show(c.to) })) };
            });
            const apply = h('button', { type: 'button', class: 'btn small primary', 'data-action': 'refresh-apply', onclick: () => {
                const fields = boxes.filter((b) => b.box.checked).map((b) => b.box.value as FactField);
                const i = this.draft.scenes.indexOf(s);
                if (i < 0) return;
                this.draft.scenes[i] = applyFacts(s, got, fields);
                this.changed(true);
            } }, t('admin.refresh.apply'));
            out.append(...boxes.map((b) => b.row), apply);
            li.querySelector<HTMLInputElement>('[data-refresh]')?.focus();
        });
        return h('div', { class: 'refresh-block wide' }, go, out);
    }

    // ---------------- adding a scene ----------------

    private async find(q: string): Promise<void> {
        clear(this.found);
        const link = parseSceneLink(q);
        // a link's ?budget= and ?stochastic become the entry's render (the catalogue contract, v0.7 lane R):
        // a budget outside 0.25..32 M is dropped; stochastic=0 is kept as an explicit "sorted" (v0.9: stochastic
        // is the desktop default, so the owner's "draw THIS scene the classic way" has to be stored)
        const render = catalogueRender(link?.render);
        if (link) return this.preview(render ? { id: link.id, render } : { id: link.id }, null);
        try {
            const page = await this.ss.explore({ sort: 'trending', order: -1, search: q, skip: 0, limit: 12 });
            if (!page.items.length) { this.found.append(h('p', { class: 'muted' }, t('admin.add.noResults'))); return; }
            const grid = h('div', { class: 'results' });
            for (const it of page.items) {
                grid.append(h('div', { class: 'result', 'data-scene': it.id },
                    h('img', { src: it.thumb, alt: '', width: 160, height: 90, loading: 'lazy' }),
                    h('span', {}, it.title), h('span', { class: 'muted' }, `${it.author} · ${it.format || '?'}`),
                    h('button', { type: 'button', class: 'btn small', onclick: () => { clear(this.found); void this.preview(fromItem(it), it); } }, t('admin.add.use'))));
            }
            this.found.append(grid);
        } catch (e) {
            this.found.append(h('p', { class: 'bad' }, e instanceof Error ? e.message : String(e)));
        }
    }

    /**
     * A candidate: SuperSplat's facts through the server (title, author, licence, description, date, poster,
     * walls, format, size) and the CDN check the simulator itself makes (does it open, walls, CDN folder),
     * both at once; the fields stay editable, then the entry goes on top of the list. Without the facts
     * (SuperSplat did not answer) the search result's fields, else the owner types them.
     */
    private async preview(base: Partial<CatalogScene> & { id: string }, item: ExploreItem | null): Promise<void> {
        const box = h('div', { class: 'preview', 'data-testid': 'add-preview' }, h('p', { class: 'muted' }, t('admin.add.checking')));
        this.found.append(box);
        const warn: string[] = [];
        let ok = '';
        let factsLine = '';
        const [cdn, facts] = await Promise.allSettled([resolveScene(base.id), this.api.facts(base.id)]);
        const f = facts.status === 'fulfilled' ? facts.value : null;
        // SuperSplat's facts when they came (the link's render kept), else what the search result knew
        const known = Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined)) as Partial<CatalogScene> & { id: string };
        const entry: CatalogScene = f
            ? { ...entryFromFacts(f), ...(base.render ? { render: base.render } : {}) }
            : { title: '', author: '', license: '', kind: 'other', collision: true, ...known };
        if (f) {
            factsLine = t('admin.add.facts', { title: f.facts.title ?? '', author: f.facts.author || '-', license: f.facts.license || t('admin.add.noLicense') });
        } else {
            const why = facts.status === 'rejected' && facts.reason instanceof ApiError ? facts.reason.reason || String(facts.reason.status) : 'bad-data';
            warn.push(t('admin.add.factsFailed', { why }));
        }
        if (item && formatVerdict(item.format) === 'unsupported') warn.push(t('admin.warn.unsupported', { format: item.format }));
        if (cdn.status === 'fulfilled') {
            const r = cdn.value;
            entry.version = r.version;
            entry.collision = r.collisionUrl !== null; // the same probe the simulator makes
            ok = t('admin.add.opens', { format: item?.format || entry.format || r.contentKind, version: r.version });
        } else {
            const code = cdn.reason instanceof SceneError ? cdn.reason.code : 'network';
            warn.push(code === 'unsupported' ? t('admin.warn.unsupported', { format: item?.format || entry.format || 'compressed.ply' }) : code === 'not-found' ? t('admin.warn.notFound') : t('admin.warn.network'));
        }
        if (!entry.collision) warn.push(t('admin.warn.noWalls'));
        clear(box);
        const already = this.draft.scenes.some((s) => s.id === entry.id);
        const title = h('input', { type: 'text', maxlength: 120, value: entry.title, 'data-testid': 'add-title' }) as HTMLInputElement;
        const author = h('input', { type: 'text', maxlength: 80, value: entry.author }) as HTMLInputElement;
        const lic = h('input', { type: 'text', maxlength: 40, value: entry.license }) as HTMLInputElement;
        const add = h('button', { type: 'button', class: 'btn primary', 'data-action': 'add', disabled: already }, already ? t('admin.add.already') : t('admin.add.add'));
        // a scene that is in the list already, pasted again with a drawing (?budget=8&stochastic): the way to give the
        // listed scene that drawing (v0.9: the button used to stop at "Already in the list", the link's drawing was lost)
        const listed = this.draft.scenes.find((x) => x.id === entry.id);
        const setDrawing = already && listed && entry.render
            ? h('button', { type: 'button', class: 'btn', 'data-action': 'update-render', onclick: () => {
                const r = entry.render;
                if (!r) return;
                const i = this.draft.scenes.indexOf(listed);
                if (i >= 0) this.draft.scenes[i] = { ...listed, render: { ...listed.render, ...r } };
                clear(this.found);
                this.changed(true);
            } }, t('admin.add.updateRender'))
            : null;
        const sync = (): void => { add.disabled = already || !title.value.trim(); };
        title.addEventListener('input', sync);
        sync();
        add.addEventListener('click', () => {
            this.draft.scenes.unshift({ ...entry, title: title.value.trim(), author: author.value.trim(), license: lic.value.trim() });
            clear(this.found);
            this.changed(true);
        });
        box.append(
            h('img', { src: poster(entry), alt: '', width: 320, height: 180 }),
            h('div', { class: 'preview-fields' },
                h('code', {}, entry.id),
                ok ? h('p', { class: 'ok' }, ok) : null,
                factsLine ? h('p', { class: 'ok', 'data-testid': 'add-facts' }, factsLine) : null,
                entry.render ? h('p', { class: 'ok', 'data-testid': 'add-render' }, renderLine(entry.render)) : null,
                ...[...new Set(warn)].map((w) => h('p', { class: 'warn' }, w)),
                item || f ? null : h('p', { class: 'muted' }, t('admin.add.unknown')),
                field(t('admin.field.title'), title), field(t('admin.field.author'), author), field(t('admin.field.license'), lic),
                add, setDrawing));
    }
}

/** What the added link asks for, in one line: "Drawn as the link asks: stochastic, 8 M splats." */
function renderLine(r: SceneRender): string {
    const parts: string[] = [];
    if (r.stochastic === true) parts.push(t('admin.add.render.stochastic'));
    if (r.stochastic === false) parts.push(t('admin.add.render.sorted'));
    if (r.budgetM !== undefined) parts.push(t('admin.add.render.budget', { m: r.budgetM }));
    return t('admin.add.render', { what: parts.join(', ') });
}

/**
 * The short name of a catalogue field in the change lists (admin.key.<field>; every CatalogScene field has
 * one in every language, packages/i18n/test/admin-parity.test.ts). A field the type does not know (an
 * older or newer server's extra) keeps its own name.
 */
function fieldLabel(f: string): string {
    const key = `admin.key.${f}`;
    const s = t(key);
    return s === key ? f : s;
}

/**
 * A value in the refresh list, in words and short: "(empty)", yes/no, a size as 25.3 × 10 × 17.7, an object
 * (SuperSplat's origin) as its values without field names (link · description · tags · date), at most 160 characters.
 */
function show(v: unknown): string {
    if (isEmpty(v)) return t('admin.refresh.empty');
    if (typeof v === 'boolean') return t(v ? 'admin.value.yes' : 'admin.value.no');
    if (Array.isArray(v)) return v.join(' × ');
    if (typeof v === 'object') {
        const parts = Object.values(v as Record<string, unknown>).filter((x) => !isEmpty(x));
        return parts.map((x) => (Array.isArray(x) ? x.join(', ') : String(x))).join(' · ').slice(0, 160);
    }
    return String(v);
}

function isEmpty(v: unknown): boolean {
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

function field(label: string, input: HTMLElement): HTMLElement {
    return h('label', { class: 'field' }, h('span', {}, label), input);
}

/** Set or clear one language of a text; returns the object (undefined values never reach the server). */
function setText(o: LocalText, l: keyof LocalText, v: string): LocalText {
    if (v.trim()) o[l] = v; else delete o[l];
    return o;
}

/** A catalogue entry from SuperSplat's list: what the explore proxy knows about the scene. */
function fromItem(it: ExploreItem): Partial<CatalogScene> & { id: string } {
    return {
        id: it.id,
        version: it.version,
        title: it.title,
        author: it.author,
        license: licence(it.license),
        thumb: it.thumbs.m ?? undefined,
        sizeMb: it.sizeBytes ? Math.round(it.sizeBytes / 1e5) / 10 : undefined,
        format: it.format || undefined
    };
}

// The admin's Drawing tab (v0.10 lane R, the owner's items 3 and 4): what a pilot's device draws with when nothing asks
// for anything else, edited here instead of in the code. Three parts:
//   - the presets, one per class of device (desktop with strong graphics, desktop with weak graphics, tablet, phone):
//     the drawing (sorted or stochastic), the top splat budget and the top render scale, over the built-in table
//     (@gsfpv/render-pc presets.ts, shown next to every value so a change is a visible one);
//   - who decides, in order, so the owner sees where the preset sits (link > the pilot's settings > the scene's own
//     entry > the preset);
//   - the scene entries: every scene's own drawing and budget (the same `render` the scene's editor in the Scenes
//     tab writes), for the owner who wants to see them all at once.
// It works on the same catalogue draft as the Scenes tab: every change saves the draft on the server a moment later,
// pilots see nothing until Publish, the changes are listed and counted, the history can bring an older version back
// (apps/api/admin.py CatalogStore keeps the drawing defaults in the catalogue document, with the same history).
import { catalogDiff } from '@gsfpv/scenes';
import type { CatalogDiff, CatalogScene, SceneCatalog } from '@gsfpv/scenes';
import { BUILTIN_PRESETS, DEVICE_CLASSES, PRESET_BUDGET_MAX, PRESET_BUDGET_MIN, PRESET_SCALE_MAX, PRESET_SCALE_MIN, PRESET_DRAWINGS, presetFor, readDrawingDefaults } from '@gsfpv/render-pc/policy';
import type { DeviceClass, DrawingDefaults, DrawingPreset, PresetDrawing } from '@gsfpv/render-pc/policy';
import { h, clear } from '../ui/dom';
import { t } from './i18n';
import { ApiError } from './api';
import type { AdminClient, CatalogState } from './api';

const SAVE_AFTER_MS = 500;
const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : '');

/** A number field's value, or undefined when it is empty or outside [lo, hi]. */
function read(input: HTMLInputElement, lo: number, hi: number): number | undefined {
    if (input.value.trim() === '') return undefined;
    const n = Number(input.value);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
}

export class DrawingTab {
    readonly root: HTMLElement;
    private draft: SceneCatalog = { collections: [], scenes: [] };
    private state: CatalogState | null = null;
    private diff: CatalogDiff = { scenes: [], collections: false, drawing: false, dirty: false };
    private timer: number | null = null;
    private saving: Promise<void> | null = null;
    private filter = '';
    private readonly status = h('p', { class: 'status', role: 'status', 'data-testid': 'draft-status' });
    private readonly publishBtn = h('button', { type: 'button', class: 'btn primary', 'data-action': 'publish' }, t('admin.publish'));
    private readonly changesBox = h('details', { class: 'changes', 'data-testid': 'draft-changes', hidden: true });
    private readonly presets = h('div', { class: 'presets', 'data-testid': 'drawing-presets' });
    private readonly entries = h('ol', { class: 'rows', 'data-testid': 'drawing-scenes' });
    private readonly entriesHead = h('h2', {});
    private readonly hist = h('ul', { class: 'history' });

    constructor(private readonly api: AdminClient, private readonly say: (msg: string, bad?: boolean) => void) {
        this.publishBtn.addEventListener('click', () => void this.publish());
        window.addEventListener('beforeunload', (e) => { if (this.root.isConnected && this.diff.dirty) e.preventDefault(); });
        const search = h('input', { type: 'search', class: 'grow', 'aria-label': t('admin.drawing.scenes.search'), placeholder: t('admin.drawing.scenes.search'), autocomplete: 'off', 'data-testid': 'drawing-filter' }) as HTMLInputElement;
        search.addEventListener('input', () => { this.filter = search.value.trim().toLowerCase(); this.renderEntries(); });
        this.root = h('div', { class: 'tab-body', 'data-testid': 'drawing-tab' },
            h('div', { class: 'bar sticky' },
                this.status,
                this.publishBtn,
                h('button', { type: 'button', class: 'btn', 'data-action': 'discard', onclick: () => void this.discard() }, t('admin.discard')),
                h('a', { class: 'btn', href: '/en/fly/', target: '_blank', rel: 'noopener' }, t('admin.openPicker')),
                this.changesBox),
            h('section', { class: 'card' }, h('h2', {}, t('admin.drawing.title')), h('p', { class: 'muted' }, t('admin.drawing.intro')), this.presets,
                h('div', { class: 'bar' }, h('button', { type: 'button', class: 'btn small', 'data-action': 'drawing-reset-all', onclick: () => this.resetAll() }, t('admin.drawing.resetAll'))),
                h('p', { class: 'muted small' }, t('admin.drawing.cannot'))),
            h('section', { class: 'card' }, h('h2', {}, t('admin.drawing.order.title')), h('ol', { class: 'order' }, ...[1, 2, 3, 4].map((n) => h('li', {}, t(`admin.drawing.order.${n}`))))),
            h('section', { class: 'card' }, this.entriesHead, h('p', { class: 'muted' }, t('admin.drawing.scenes.help')), h('div', { class: 'bar' }, search), this.entries),
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
        this.renderPresets();
        this.renderEntries();
        this.renderStatus();
        this.renderHistory();
    }

    /** The owner's changes now, as the draft holds them. */
    private owner(): DrawingDefaults | undefined {
        return readDrawingDefaults(this.draft.drawing);
    }

    private setOwner(next: DrawingDefaults | undefined): void {
        if (next && Object.keys(next.presets).length) this.draft.drawing = next;
        else delete this.draft.drawing;
    }

    /** One field of one class changed by the owner (undefined: back to following the built-in table). */
    private setField<K extends keyof DrawingPreset>(cls: DeviceClass, key: K, value: DrawingPreset[K] | undefined): void {
        const cur = this.owner() ?? { presets: {} };
        const mine: Partial<DrawingPreset> = { ...(cur.presets[cls] ?? {}) };
        if (value === undefined) delete mine[key]; else mine[key] = value;
        const presets = { ...cur.presets };
        if (Object.keys(mine).length) presets[cls] = mine; else delete presets[cls];
        this.setOwner({ presets });
        this.changed(false);
    }

    private resetClass(cls: DeviceClass): void {
        const cur = this.owner();
        if (!cur) return;
        const presets = { ...cur.presets };
        delete presets[cls];
        this.setOwner({ presets });
        this.renderPresets();
        this.changed(false);
    }

    private resetAll(): void {
        if (!this.owner()) return;
        if (!confirm(t('admin.drawing.resetAll.confirm'))) return;
        this.setOwner(undefined);
        this.renderPresets();
        this.changed(false);
    }

    /** A change by the owner: saved after a short pause. */
    private changed(redrawPresets: boolean): void {
        if (redrawPresets) this.renderPresets();
        else this.refreshPresetMarks();
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

    // ------------------------------------------------------------------ the presets
    private renderPresets(): void {
        clear(this.presets);
        const owner = this.owner();
        const head = h('div', { class: 'preset-row preset-head', role: 'row' },
            h('span', { role: 'columnheader' }, t('admin.drawing.col.class')),
            h('span', { role: 'columnheader' }, t('admin.drawing.col.drawing')),
            h('span', { role: 'columnheader' }, t('admin.drawing.col.budget')),
            h('span', { role: 'columnheader' }, t('admin.drawing.col.scale')),
            h('span', { role: 'columnheader' }, ''));
        this.presets.setAttribute('role', 'table');
        this.presets.append(head);
        for (const cls of DEVICE_CLASSES) this.presets.append(this.presetRow(cls, presetFor(cls, owner)));
    }

    private presetRow(cls: DeviceClass, p: DrawingPreset): HTMLElement {
        const built = BUILTIN_PRESETS[cls];
        const drawing = h('select', { 'aria-label': `${t(`admin.drawing.class.${cls}`)}: ${t('admin.drawing.col.drawing')}`, 'data-field': 'drawing' },
            ...PRESET_DRAWINGS.map((m) => h('option', { value: m }, t(`admin.drawing.opt.${m}`)))) as HTMLSelectElement;
        drawing.value = p.drawing;
        drawing.addEventListener('change', () => this.setField(cls, 'drawing', drawing.value as PresetDrawing));
        const budget = h('input', { type: 'number', min: PRESET_BUDGET_MIN, max: PRESET_BUDGET_MAX, step: 0.25, value: String(p.budgetM), 'aria-label': `${t(`admin.drawing.class.${cls}`)}: ${t('admin.drawing.col.budget')}`, 'data-field': 'budgetM' }) as HTMLInputElement;
        budget.addEventListener('input', () => {
            const v = read(budget, PRESET_BUDGET_MIN, PRESET_BUDGET_MAX);
            budget.setAttribute('aria-invalid', String(v === undefined));
            if (v !== undefined) this.setField(cls, 'budgetM', v);
        });
        // the render scale is shown and typed as a percentage of the display's pixels
        const scale = h('input', { type: 'number', min: Math.round(PRESET_SCALE_MIN * 100), max: Math.round(PRESET_SCALE_MAX * 100), step: 5, value: String(Math.round(p.renderScale * 100)), 'aria-label': `${t(`admin.drawing.class.${cls}`)}: ${t('admin.drawing.col.scale')}`, 'data-field': 'renderScale' }) as HTMLInputElement;
        scale.addEventListener('input', () => {
            const v = read(scale, PRESET_SCALE_MIN * 100, PRESET_SCALE_MAX * 100);
            scale.setAttribute('aria-invalid', String(v === undefined));
            if (v !== undefined) this.setField(cls, 'renderScale', Math.round(v) / 100);
        });
        const mark = h('span', { class: 'preset-mark', 'data-testid': `preset-mark-${cls}` });
        const reset = h('button', { type: 'button', class: 'btn small', 'data-action': `drawing-reset-${cls}`, onclick: () => this.resetClass(cls) }, t('admin.drawing.reset'));
        const row = h('div', { class: 'preset-row', role: 'row', 'data-class': cls },
            h('span', { class: 'preset-name', role: 'cell' }, h('strong', {}, t(`admin.drawing.class.${cls}`)), h('span', { class: 'muted small' }, t(`admin.drawing.class.${cls}.what`))),
            h('span', { role: 'cell' }, drawing),
            h('span', { role: 'cell' }, budget, ' ', t('admin.drawing.unit.m')),
            h('span', { role: 'cell' }, scale, ' %'),
            h('span', { class: 'preset-actions', role: 'cell' }, mark, reset),
            h('span', { class: 'muted small preset-builtin' }, t('admin.drawing.builtin', { drawing: t(`admin.drawing.opt.${built.drawing}`), budget: built.budgetM, scale: Math.round(built.renderScale * 100) })));
        return row;
    }

    /** "changed" badges and Reset buttons follow the draft without redrawing the inputs the owner is typing in. */
    private refreshPresetMarks(): void {
        const owner = this.owner();
        for (const row of this.presets.querySelectorAll<HTMLElement>('.preset-row[data-class]')) {
            const cls = row.dataset.class as DeviceClass;
            const mine = owner?.presets[cls];
            const differs = !!mine && (Object.keys(mine) as (keyof DrawingPreset)[]).some((k) => mine[k] !== BUILTIN_PRESETS[cls][k]);
            const mark = row.querySelector<HTMLElement>('.preset-mark');
            if (mark) mark.textContent = differs ? t('admin.drawing.changed') : mine ? t('admin.drawing.pinned') : '';
            row.classList.toggle('is-changed', differs);
            const btn = row.querySelector<HTMLButtonElement>('.preset-actions button');
            if (btn) btn.disabled = !mine;
        }
    }

    // ------------------------------------------------------------------ the scene entries
    private renderEntries(): void {
        clear(this.entries);
        const all = this.draft.scenes;
        const rows = this.filter ? all.filter((s) => `${s.title} ${s.id}`.toLowerCase().includes(this.filter)) : all;
        this.entriesHead.textContent = t('admin.drawing.scenes.title', { n: all.length, shown: rows.length });
        if (!rows.length) this.entries.append(h('li', { class: 'muted' }, t('admin.drawing.scenes.none')));
        for (const s of rows) this.entries.append(this.entry(s));
        this.refreshPresetMarks();
    }

    private entry(s: CatalogScene): HTMLLIElement {
        const mode = h('select', { 'aria-label': `${s.title}: ${t('admin.drawing.col.drawing')}`, 'data-field': 'render' },
            h('option', { value: '' }, t('admin.render.auto')),
            h('option', { value: 'stochastic' }, t('admin.render.stochastic')),
            h('option', { value: 'sorted' }, t('admin.render.sorted'))) as HTMLSelectElement;
        mode.value = s.render?.stochastic === true ? 'stochastic' : s.render?.stochastic === false ? 'sorted' : '';
        const budget = h('input', { type: 'number', min: PRESET_BUDGET_MIN, max: PRESET_BUDGET_MAX, step: 0.25, value: s.render?.budgetM === undefined ? '' : String(s.render.budgetM), placeholder: t('admin.drawing.scenes.auto'), 'aria-label': `${s.title}: ${t('admin.drawing.col.budget')}`, 'data-field': 'budgetM' }) as HTMLInputElement;
        const set = (): void => {
            const b = read(budget, PRESET_BUDGET_MIN, PRESET_BUDGET_MAX);
            budget.setAttribute('aria-invalid', String(budget.value.trim() !== '' && b === undefined));
            const r = { ...(b !== undefined ? { budgetM: b } : {}), ...(mode.value ? { stochastic: mode.value === 'stochastic' } : {}) };
            if (Object.keys(r).length) s.render = r; else delete s.render;
            this.changed(false);
        };
        mode.addEventListener('change', set);
        budget.addEventListener('input', set);
        return h('li', { class: `row${s.hidden ? ' is-hidden' : ''}`, 'data-scene': s.id },
            h('div', { class: 'row-main' },
                h('div', { class: 'row-info' }, h('strong', {}, s.title), h('span', { class: 'muted' }, s.id)),
                mode, budget, ' ', h('span', { class: 'muted' }, t('admin.drawing.unit.m')))) as HTMLLIElement;
    }

    // ------------------------------------------------------------------ the bar and the history
    private changeCount(): number {
        return this.diff.scenes.length + (this.diff.collections ? 1 : 0) + (this.diff.drawing ? 1 : 0);
    }

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
            for (const c of this.diff.scenes) list.append(h('li', { 'data-change': c.kind, 'data-scene': c.id }, t(`admin.changes.${c.kind}`, { title: c.title, fields: (c.fields ?? []).join(', ') })));
            if (this.diff.collections) list.append(h('li', { 'data-change': 'collections' }, t('admin.changes.collections')));
            if (this.diff.drawing) list.append(h('li', { 'data-change': 'drawing' }, t('admin.changes.drawing')));
            this.changesBox.append(h('summary', {}, t('admin.changes.title')), list);
        }
    }

    private renderStatus(): void {
        this.renderDiff();
        this.status.textContent = this.diff.dirty ? t('admin.status.changes', { n: this.changeCount() }) : t('admin.status.live');
        this.status.className = `status ${this.diff.dirty ? 'warn' : 'ok'}`;
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
}

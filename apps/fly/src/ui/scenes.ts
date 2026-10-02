// Scene picker: paste a link, the catalogue the owner curates at /admin/ (Featured row, collections,
// the rest in his order), recent, favourites, filters, the SuperSplat tab. History, favourites and the
// filter live in the browser only and survive a reload.
import { parseSceneInput, toggleFavourite, getFilter, setFilter, posterUrl, knownVersion, getLibrary, lastScene, pickerRows, readCatalog, storefront, localText } from '@gsfpv/scenes';
import type { CatalogCollection, CatalogScene, PickerRow, SceneCatalog, SceneFilter } from '@gsfpv/scenes';
import { h, clear } from './dom';
import { t, locale } from '../i18n';
import { pickerTabs } from './picker-tabs';
import type { PickSource, PickerTab } from './picker-tabs';

/** A scene of the curated catalogue with the admin's per-scan defaults (walls, dropFloaters, scale). */
export type ShowcaseScene = CatalogScene;

/**
 * The published catalogue (GET /api/catalog, the admin's list; the browser revalidates it by ETag),
 * else the static list shipped with the release when the API cannot answer in time.
 */
export async function loadCatalog(): Promise<SceneCatalog> {
    const sources: [string, RequestInit][] = [['/api/catalog', { signal: AbortSignal.timeout(4000) }], [`${import.meta.env.BASE_URL}showcase.json`, {}]];
    for (const [url, init] of sources) {
        try {
            const r = await fetch(url, init);
            const c = r.ok ? readCatalog(await r.json()) : null;
            if (c && c.scenes.length) return c;
        } catch {
            /* the next source */
        }
    }
    return { collections: [], scenes: [] };
}

export class ScenePicker {
    readonly root: HTMLDivElement;
    private list: HTMLDivElement;
    /** a built-in tab, or the id of a registered PickerTab (ui/picker-tabs.ts) */
    private tab: string = 'showcase';
    private filter: SceneFilter = getFilter();
    private showcase: ShowcaseScene[] = [];
    private catalog: SceneCatalog;
    /** the collection chip chosen on the catalogue tab (null: all) */
    private collection: string | null = null;
    private err: HTMLDivElement;
    private filters: HTMLDivElement;
    /** the registered tabs as the picker opened (a later registration shows in the next picker) */
    private extra: readonly PickerTab[] = pickerTabs().slice();
    private unmountExtra: (() => void) | null = null;
    onPick: ((id: string, source: PickSource) => void) | null = null;

    constructor(parent: HTMLElement, showcase: ShowcaseScene[], collections: CatalogCollection[] = []) {
        this.showcase = showcase;
        this.catalog = { scenes: showcase, collections };
        const input = h('input', { type: 'url', inputmode: 'url', class: 'scene-input', placeholder: 'superspl.at/scene/…', 'aria-label': t('scenes.paste'), autocomplete: 'off' }) as HTMLInputElement;
        this.err = h('div', { class: 'scene-error', role: 'alert' });
        const go = () => {
            const id = parseSceneInput(input.value);
            if (!id) {
                this.err.textContent = t('error.invalid-link');
                return;
            }
            this.err.textContent = '';
            this.onPick?.(id, 'paste');
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        const tabs = h('div', { class: 'tabs', role: 'tablist' });
        for (const k of ['showcase', 'recent', 'favourites'] as const) {
            tabs.append(h('button', { type: 'button', role: 'tab', class: 'tab', 'data-tab': k, 'aria-selected': String(k === this.tab), onclick: () => { this.tab = k; this.render(tabs); } }, t(`scenes.tab.${k}`)));
        }
        for (const x of this.extra) {
            tabs.append(h('button', { type: 'button', role: 'tab', class: 'tab', 'data-tab': x.id, 'aria-selected': 'false', onclick: () => { this.tab = x.id; this.render(tabs); } }, t(x.labelKey)));
        }
        const fCol = h('input', { type: 'checkbox', id: 'f-col' }) as HTMLInputElement;
        fCol.checked = this.filter.collisionOnly;
        fCol.addEventListener('change', () => { this.filter.collisionOnly = fCol.checked; setFilter(this.filter); this.render(tabs); });
        const fKind = h('select', { 'aria-label': t('scenes.filter.kind') }) as HTMLSelectElement;
        for (const k of ['all', 'interior', 'exterior'] as const) fKind.append(h('option', { value: k }, t(`scenes.filter.${k}`)));
        fKind.value = this.filter.kind;
        fKind.addEventListener('change', () => { this.filter.kind = fKind.value as SceneFilter['kind']; setFilter(this.filter); this.render(tabs); });
        const fFlown = h('select', { 'aria-label': t('scenes.filter.flown') }) as HTMLSelectElement;
        for (const k of ['all', 'flown', 'new'] as const) fFlown.append(h('option', { value: k }, k === 'all' ? t('scenes.filter.all') : t(`scenes.filter.${k}`)));
        fFlown.value = this.filter.flown;
        fFlown.addEventListener('change', () => { this.filter.flown = fFlown.value as SceneFilter['flown']; setFilter(this.filter); this.render(tabs); });
        this.list = h('div', { class: 'scene-grid' });
        // E.8: "Continue: <last scene>" comes first, whatever the tab
        const last = lastScene(getLibrary());
        const lastTitle = last ? showcase.find((s) => s.id === last.id)?.title ?? last.title ?? last.id : '';
        const cont = last
            ? h('button', { type: 'button', class: 'scene-card scene-continue', 'data-testid': 'scene-continue', 'data-scene': last.id, onclick: () => this.onPick?.(last.id, 'history') },
                h('img', { src: posterUrl(last.id), alt: '', loading: 'lazy', width: 160, height: 90 }),
                h('span', { class: 'scene-title' }, t('scenes.continue', { title: lastTitle })))
            : null;
        this.filters = h('div', { class: 'filters' }, h('label', { for: 'f-col' }, fCol, ' ', t('scenes.filter.collision')), fKind, fFlown);
        this.root = h('div', { class: 'screen scenes interactive' },
            h('h1', {}, t('scenes.title')),
            h('div', { class: 'scene-paste' }, input, h('button', { type: 'button', class: 'btn primary', onclick: go }, t('scenes.go'))),
            this.err,
            cont,
            tabs,
            this.filters,
            this.list
        );
        parent.append(this.root);
        this.render(tabs);
    }

    showError(code: string, msg?: string): void {
        // a scene in a format we cannot open yet is not "missing": its text lives with the picker
        this.err.textContent = code === 'unsupported' ? t('scenes.unsupported') : t(`error.${code}`, { msg: msg ?? '' });
    }

    /** The built-in tab's cards (@gsfpv/scenes pickerRows): favourites keep the title and walls they were starred with. */
    private items(): (PickerRow & { meta?: ShowcaseScene })[] {
        const tab = this.tab === 'recent' || this.tab === 'favourites' ? this.tab : 'showcase';
        const byId = new Map(this.showcase.map((s) => [s.id, s]));
        return pickerRows(tab, this.showcase, getLibrary(), this.filter).map((r) => ({ ...r, meta: byId.get(r.id) }));
    }

    private render(tabs: HTMLElement): void {
        for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === this.tab));
        this.unmountExtra?.();
        this.unmountExtra = null;
        clear(this.list);
        const x = this.extra.find((e) => e.id === this.tab);
        this.filters.hidden = !!x?.ownFilters;
        if (x) {
            const pick = (raw: string, source: PickSource): void => {
                const id = parseSceneInput(raw);
                if (!id) { this.err.textContent = t('error.invalid-link'); return; }
                this.err.textContent = '';
                this.onPick?.(id, source);
            };
            this.unmountExtra = x.mount(this.list, { pick, showError: (c, m) => this.showError(c, m), filter: this.filter }) || null;
            return;
        }
        const items = this.items();
        if (items.length === 0) {
            this.list.append(h('p', { class: 'empty' }, this.tab === 'showcase' ? t('scenes.empty.filter') : t(`scenes.empty.${this.tab}`)));
            return;
        }
        if (this.tab !== 'showcase') {
            for (const s of items) this.list.append(this.cell(s, tabs, false));
            return;
        }
        // the storefront: Featured (pinned) on top, collection chips, then the rest in the admin's order
        const shop = storefront(items, this.catalog, this.collection);
        if (shop.featured.length) {
            const row = h('div', { class: 'sf-row', role: 'list', 'data-testid': 'featured' });
            row.addEventListener('keydown', (e) => arrowFocus(e, row));
            for (const s of shop.featured) row.append(h('div', { role: 'listitem', class: 'sf-item' }, this.cell(s, tabs, true)));
            this.list.append(h('section', { class: 'sf-featured', 'aria-label': t('scenes.featured') }, h('h2', { class: 'sf-head' }, t('scenes.featured')), row));
        }
        if (shop.collections.length) {
            const chip = (id: string | null, label: string): HTMLButtonElement => h('button', {
                type: 'button', class: 'tab sf-chip', 'data-collection': id ?? '', 'aria-pressed': String(this.collection === id),
                onclick: () => { this.collection = id; this.render(tabs); }
            }, label);
            this.list.append(h('div', { class: 'sf-chips', role: 'group', 'aria-label': t('scenes.collections') },
                chip(null, t('scenes.collection.all')), ...shop.collections.map((c) => chip(c.id, localText(c.title, locale)))));
        }
        if (shop.featured.length && shop.rest.length) this.list.append(h('h2', { class: 'sf-head' }, t('scenes.more')));
        for (const s of shop.rest) this.list.append(this.cell(s, tabs, false));
    }

    /** One card and its favourite star; `big`: a Featured card (large poster, the admin's pitch line). */
    private cell(s: PickerRow & { meta?: ShowcaseScene }, tabs: HTMLElement, big: boolean): HTMLElement {
        const m = s.meta;
        const star = h('button', { type: 'button', class: `star ${s.fav ? 'on' : ''}`, 'aria-label': s.fav ? t('scenes.card.unfav') : t('scenes.card.fav'), 'aria-pressed': String(s.fav), onclick: (e: Event) => { e.stopPropagation(); toggleFavourite(s.id, { title: s.title, hasCollision: s.collision }); this.render(tabs); } }, '★');
        const pitch = big ? localText(m?.pitch, locale) : '';
        // walls not known (a favourite starred before it was opened, by an older release): nothing said
        const walls = s.collision === null ? null
            : h('span', { class: `sf-badge ${s.collision ? 'walls' : 'nowalls'}` }, s.collision ? `${t('scenes.card.walls')}${m?.voxelCm ? ` · ${m.voxelCm} cm` : ''}` : t('scenes.card.noWalls'));
        const extra = [m?.sizeMb ? `${m.sizeMb} MB` : '', m?.license ?? '', s.flights ? t('scenes.card.flown', { n: s.flights }) : ''].filter(Boolean).join(' · ');
        const card = h('button', { type: 'button', class: `scene-card${big ? ' sf-big' : ''}`, 'data-scene': s.id, onclick: () => this.onPick?.(s.id, this.tab === 'showcase' ? 'showcase' : 'history') },
            h('img', { src: m?.thumb ?? posterUrl(s.id, big ? 'l' : 'm', m?.version ?? knownVersion(s.id)), alt: '', loading: big ? 'eager' : 'lazy', width: big ? 640 : 320, height: big ? 360 : 180 }),
            h('span', { class: 'scene-title' }, s.title),
            pitch ? h('span', { class: 'sf-pitch' }, pitch) : null,
            m?.author ? h('span', { class: 'scene-meta' }, t('scenes.card.by', { author: m.author })) : null,
            h('span', { class: 'scene-meta sf-meta' }, walls, extra ? h('span', {}, extra) : null)
        );
        return h('div', { class: 'scene-cell' }, card, star);
    }

    remove(): void {
        this.unmountExtra?.();
        this.unmountExtra = null;
        this.root.remove();
    }
}

/** Left/Right (and Home/End) move between the cards of a horizontal row; Tab still leaves it. */
function arrowFocus(e: KeyboardEvent, row: HTMLElement): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const cards = [...row.querySelectorAll<HTMLElement>('.scene-card')];
    const i = cards.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? cards.length - 1 : Math.max(0, Math.min(cards.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
    e.preventDefault();
    cards[j].focus();
    cards[j].scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

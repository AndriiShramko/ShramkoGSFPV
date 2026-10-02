// Scene picker: paste a link, Andrii's scans (static showcase.json), recent, favourites, filters.
// History, favourites and the filter live in the browser only and survive a reload.
import { parseSceneInput, getHistory, getFavourites, toggleFavourite, getFilter, setFilter, posterUrl, getLibrary, lastScene } from '@gsfpv/scenes';
import type { SceneFilter } from '@gsfpv/scenes';
import { h, clear } from './dom';
import { t } from '../i18n';
import { pickerTabs } from './picker-tabs';
import type { PickSource, PickerTab } from './picker-tabs';

export interface ShowcaseScene {
    id: string;
    title: string;
    author: string;
    license: string;
    kind: 'interior' | 'exterior';
    collision: boolean;
    voxelCm?: number;
    sizeMb?: number;
    /** the admin's default for the walls switch: "off" for a noisy scan (floating splats make phantom walls); absent = on */
    walls?: 'on' | 'off';
}

export async function loadShowcase(): Promise<ShowcaseScene[]> {
    try {
        const r = await fetch(`${import.meta.env.BASE_URL}showcase.json`);
        return ((await r.json()) as { scenes: ShowcaseScene[] }).scenes;
    } catch {
        return [];
    }
}

export class ScenePicker {
    readonly root: HTMLDivElement;
    private list: HTMLDivElement;
    /** a built-in tab, or the id of a registered PickerTab (ui/picker-tabs.ts) */
    private tab: string = 'showcase';
    private filter: SceneFilter = getFilter();
    private showcase: ShowcaseScene[] = [];
    private err: HTMLDivElement;
    private filters: HTMLDivElement;
    /** the registered tabs as the picker opened (a later registration shows in the next picker) */
    private extra: readonly PickerTab[] = pickerTabs().slice();
    private unmountExtra: (() => void) | null = null;
    onPick: ((id: string, source: PickSource) => void) | null = null;

    constructor(parent: HTMLElement, showcase: ShowcaseScene[]) {
        this.showcase = showcase;
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

    private items(): (ShowcaseScene & { flights: number; fav: boolean })[] {
        const hist = getHistory();
        const favs = getFavourites();
        const byId = new Map(this.showcase.map((s) => [s.id, s]));
        let base: ShowcaseScene[];
        if (this.tab === 'showcase') base = this.showcase;
        else if (this.tab === 'recent') base = hist.map((e) => byId.get(e.id) ?? { id: e.id, title: e.title ?? e.id, author: '', license: '', kind: 'interior', collision: e.hasCollision ?? false });
        else base = favs.map((id) => byId.get(id) ?? { id, title: hist.find((e) => e.id === id)?.title ?? id, author: '', license: '', kind: 'interior', collision: hist.find((e) => e.id === id)?.hasCollision ?? false });
        return base
            .map((s) => ({ ...s, flights: hist.find((e) => e.id === s.id)?.flights ?? 0, fav: favs.includes(s.id) }))
            .filter((s) => !this.filter.collisionOnly || s.collision)
            .filter((s) => this.filter.kind === 'all' || this.tab !== 'showcase' || s.kind === this.filter.kind)
            .filter((s) => this.filter.flown === 'all' || (this.filter.flown === 'flown' ? s.flights > 0 : s.flights === 0));
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
        for (const s of items) {
            const star = h('button', { type: 'button', class: `star ${s.fav ? 'on' : ''}`, 'aria-label': s.fav ? t('scenes.card.unfav') : t('scenes.card.fav'), 'aria-pressed': String(s.fav), onclick: (e: Event) => { e.stopPropagation(); toggleFavourite(s.id); this.render(tabs); } }, '★');
            const card = h('button', { type: 'button', class: 'scene-card', 'data-scene': s.id, onclick: () => this.onPick?.(s.id, this.tab === 'showcase' ? 'showcase' : 'history') },
                h('img', { src: posterUrl(s.id), alt: '', loading: 'lazy', width: 320, height: 180 }),
                h('span', { class: 'scene-title' }, s.title),
                h('span', { class: 'scene-meta' },
                    s.collision ? `${t('scenes.card.walls')}${s.voxelCm ? ` · ${s.voxelCm} cm` : ''}` : t('scenes.card.noWalls'),
                    s.sizeMb ? ` · ${s.sizeMb} MB` : '',
                    s.license ? ` · ${s.license}` : '',
                    s.flights ? ` · ${t('scenes.card.flown', { n: s.flights })}` : ''
                )
            );
            this.list.append(h('div', { class: 'scene-cell' }, card, star));
        }
    }

    remove(): void {
        this.unmountExtra?.();
        this.unmountExtra = null;
        this.root.remove();
    }
}

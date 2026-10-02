// The SuperSplat tab of the scene picker (docs/architecture-v03.md E.6, E.8; decision D35; owner's
// items 9 and 10): what superspl.at's catalogue shows, with its filters (walkable, downloadable, time,
// sort, search), paging, "Random top-rated" (pickRandomTopRated over the best-liked walkable scenes),
// favourites (the picker's own star list) and "Open on SuperSplat". The list comes from OUR caching
// proxy (/api/superspl/explore) through SuperSplatCatalog; the browser never asks PlayCanvas. A scene
// is opened through the picker's host, like a card or a pasted link. Registered once by main.ts.
import { SuperSplatCatalog, supersplSearchUrl, getFavourites, toggleFavourite, getHistory, parseSceneInput, formatVerdict, EXPLORE_TIMES } from '@gsfpv/scenes';
import type { CatalogStore, ExploreItem, ExplorePage } from '@gsfpv/scenes';
import { h, clear } from './dom';
import { t, locale } from '../i18n';
import { registerPickerTab } from './picker-tabs';
import type { PickerTab, PickerTabHost } from './picker-tabs';
import { SORT_KEYS, appendPage, countLabel, defaultFilters, errorView, filtersFromStore, filtersToStore, hasMore, licenceLabel, nextSkip, randomExclusions, sizeParts, timeApplies, toQuery } from './superspl-tab-logic';
import type { SortKey, TabFilters } from './superspl-tab-logic';
import './superspl.css';

const STORE_FILTERS = 'gsfpv.superspl.filters.v1';
const STORE_FAILED = 'gsfpv.superspl.failed.v1';
const SEARCH_DELAY_MS = 450;

function session(): Storage | null {
    try {
        const s = window.sessionStorage;
        s.getItem(STORE_FAILED);
        return s;
    } catch {
        return null;
    }
}

let catalog: SuperSplatCatalog | null = null;
/** One catalogue per page, its pages kept in this tab's session storage (D35: at most the proxy's freshness). */
function cat(): SuperSplatCatalog {
    catalog ??= new SuperSplatCatalog({ store: (session() as CatalogStore | null) ?? undefined });
    return catalog;
}

function readLocal(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
}

function writeLocal(k: string, v: string): void {
    try { localStorage.setItem(k, v); } catch { /* storage blocked: the filters last this visit */ }
}

function readFailed(): string[] {
    try {
        const v = JSON.parse(session()?.getItem(STORE_FAILED) ?? '[]') as unknown;
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

function writeFailed(ids: readonly string[]): void {
    try { session()?.setItem(STORE_FAILED, JSON.stringify(ids)); } catch { /* full or blocked */ }
}

function sceneInAddress(): string | null {
    const raw = new URL(location.href).searchParams.get('scene');
    return raw ? parseSceneInput(raw) : null;
}

function mount(host: HTMLElement, ctx: PickerTabHost): () => void {
    const filters: TabFilters = filtersFromStore(readLocal(STORE_FILTERS), defaultFilters(ctx.filter.collisionOnly));
    let shown: ExploreItem[] = [];
    let last: ExplorePage | null = null;
    let seq = 0;
    let alive = true;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    // ---- the filter row, as superspl.at has it ----
    const search = h('input', { type: 'search', class: 'ss-search', 'aria-label': t('superspl.search'), placeholder: t('superspl.search.placeholder'), maxlength: 80, autocomplete: 'off', enterkeyhint: 'search', spellcheck: 'false' });
    const sort = h('select', { class: 'ss-sort', 'aria-label': t('superspl.sort') });
    for (const k of SORT_KEYS) sort.append(h('option', { value: k }, t(`superspl.sort.${k}`)));
    sort.value = filters.sort;
    const time = h('select', { class: 'ss-time', 'aria-label': t('superspl.time') });
    for (const k of EXPLORE_TIMES) time.append(h('option', { value: k }, t(`superspl.time.${k}`)));
    time.value = filters.time;
    const walk = h('input', { type: 'checkbox', id: 'ss-walk', class: 'ss-walk' });
    walk.checked = filters.walkable;
    const dl = h('input', { type: 'checkbox', id: 'ss-dl', class: 'ss-dl' });
    dl.checked = filters.downloadable;

    const random = h('button', { type: 'button', class: 'btn primary ss-random' }, t('superspl.random'));
    const open = h('a', { class: 'btn ss-open', target: '_blank', rel: 'noopener noreferrer' }, t('superspl.open'));
    const status = h('p', { class: 'ss-status muted', role: 'status', 'aria-live': 'polite' });
    const errText = h('span', { class: 'ss-error-text' });
    const retry = h('button', { type: 'button', class: 'btn ss-retry' }, t('superspl.retry'));
    const err = h('div', { class: 'ss-error', role: 'alert' }, errText, retry);
    err.hidden = true;
    const grid = h('div', { class: 'scene-grid ss-grid', 'aria-label': t('superspl.tab') });
    const more = h('button', { type: 'button', class: 'btn block ss-more' }, t('superspl.more'));
    more.hidden = true;
    let retryRun: (() => void) | null = null;

    const root = h('div', { class: 'ss-tab', 'data-testid': 'superspl-tab' },
        h('div', { class: 'ss-filters', role: 'search' },
            search, sort, time,
            h('label', { class: 'ss-check', for: 'ss-walk' }, walk, ' ', t('superspl.walkable')),
            h('label', { class: 'ss-check', for: 'ss-dl' }, dl, ' ', t('superspl.downloadable'))
        ),
        h('div', { class: 'ss-actions' }, random, open),
        status,
        err,
        grid,
        more,
        h('p', { class: 'ss-credit muted small' }, t('superspl.credit'))
    );
    host.append(root);

    const syncControls = (): void => {
        time.disabled = !timeApplies(filters.sort);
        open.setAttribute('href', supersplSearchUrl(toQuery(filters)));
    };

    const showError = (e: unknown, again: () => void): void => {
        const v = errorView(e, navigator.onLine !== false);
        errText.textContent = t(`superspl.error.${v.key}`) + (v.retryAfterS ? ` ${t('superspl.error.wait', { s: v.retryAfterS })}` : '');
        retryRun = again;
        err.hidden = false;
    };
    const hideError = (): void => {
        err.hidden = true;
        retryRun = null;
    };
    retry.addEventListener('click', () => retryRun?.());

    const card = (it: ExploreItem): HTMLElement => {
        const fav = getFavourites().includes(it.id);
        const title = it.title || it.id;
        const img = h('img', { src: it.thumb, alt: '', loading: 'lazy', decoding: 'async', width: 320, height: 180, referrerpolicy: 'no-referrer' });
        img.addEventListener('error', () => img.classList.add('broken'), { once: true });
        const size = sizeParts(it.sizeBytes, locale);
        const stats = [t('superspl.likes', { n: countLabel(it.likes, locale) }), size ? t(`superspl.size.${size.key}`, { n: size.n }) : '', licenceLabel(it.license)].filter(Boolean).join(' · ');
        const badges = h('span', { class: 'ss-badges' },
            it.walkable ? h('span', { class: 'ss-badge walk' }, t('superspl.badge.walkable')) : null,
            it.downloadable ? h('span', { class: 'ss-badge dl' }, t('superspl.badge.downloadable')) : null,
            formatVerdict(it.format) === 'unsupported' ? h('span', { class: 'ss-badge old' }, t('superspl.badge.old')) : null
        );
        const btn = h('button', { type: 'button', class: 'scene-card ss-card', 'data-scene': it.id, onclick: () => ctx.pick(it.id, 'superspl') },
            img, badges,
            h('span', { class: 'scene-title' }, title),
            it.author ? h('span', { class: 'scene-meta ss-author' }, t('superspl.by', { author: it.author })) : null,
            h('span', { class: 'scene-meta ss-stats' }, stats)
        );
        const star = h('button', { type: 'button', class: `star${fav ? ' on' : ''}`, 'data-fav': it.id, 'aria-pressed': String(fav), 'aria-label': t(fav ? 'superspl.unfav' : 'superspl.fav', { title }) }, '★');
        star.addEventListener('click', (e) => {
            e.stopPropagation();
            const on = toggleFavourite(it.id);
            star.classList.toggle('on', on);
            star.setAttribute('aria-pressed', String(on));
            star.setAttribute('aria-label', t(on ? 'superspl.unfav' : 'superspl.fav', { title }));
        });
        return h('div', { class: 'scene-cell' }, btn, star);
    };

    const load = async (reset: boolean): Promise<void> => {
        const my = ++seq;
        if (reset) {
            shown = [];
            last = null;
            clear(grid);
        }
        const skip = last ? nextSkip(last) : 0;
        hideError();
        more.hidden = true;
        grid.setAttribute('aria-busy', 'true');
        status.textContent = t('superspl.loading');
        try {
            const page = await cat().explore(toQuery(filters, skip));
            if (!alive || my !== seq) return;
            last = page;
            const before = shown.length;
            shown = appendPage(shown, page.items);
            for (const it of shown.slice(before)) grid.append(card(it));
            status.textContent = page.total === 0 || shown.length === 0
                ? t('superspl.empty')
                : t('superspl.count', { shown: shown.length, total: new Intl.NumberFormat(locale).format(page.total) }) + (page.proxy === 'stale' ? ` ${t('superspl.stale')}` : '');
            more.hidden = !hasMore(page);
        } catch (e) {
            if (!alive || my !== seq) return;
            status.textContent = '';
            showError(e, () => void load(shown.length === 0));
        } finally {
            if (my === seq) grid.removeAttribute('aria-busy');
        }
    };

    const changed = (): void => {
        writeLocal(STORE_FILTERS, filtersToStore(filters));
        syncControls();
        void load(true);
    };
    sort.addEventListener('change', () => { filters.sort = sort.value as SortKey; changed(); });
    time.addEventListener('change', () => { filters.time = time.value as TabFilters['time']; changed(); });
    walk.addEventListener('change', () => { filters.walkable = walk.checked; changed(); });
    dl.addEventListener('change', () => { filters.downloadable = dl.checked; changed(); });
    const applySearch = (): void => {
        clearTimeout(searchTimer);
        if (search.value === filters.search) return;
        filters.search = search.value;
        syncControls();
        void load(true);
    };
    search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(applySearch, SEARCH_DELAY_MS); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') applySearch(); });
    more.addEventListener('click', () => void load(false));

    const pickRandom = async (): Promise<void> => {
        const pickerError = host.closest('.scenes')?.querySelector('.scene-error')?.textContent ?? '';
        const ex = randomExclusions({ urlScene: sceneInAddress(), pickerError, invalidLinkText: t('error.invalid-link'), failed: readFailed() });
        writeFailed(ex.broken);
        random.disabled = true;
        random.setAttribute('aria-busy', 'true');
        hideError();
        try {
            const r = await cat().randomTopRated({ current: ex.current, broken: ex.broken, recent: getHistory().slice(0, 10).map((e) => e.id) });
            if (!alive) return;
            if (!r) {
                status.textContent = t('superspl.random.none');
                return;
            }
            ctx.pick(r.item.id, 'random');
        } catch (e) {
            if (alive) showError(e, () => void pickRandom());
        } finally {
            random.disabled = false;
            random.removeAttribute('aria-busy');
        }
    };
    random.addEventListener('click', () => void pickRandom());

    syncControls();
    void load(true);
    return () => {
        alive = false;
        seq++;
        clearTimeout(searchTimer);
        root.remove();
    };
}

export const superSplatTab: PickerTab = { id: 'superspl', labelKey: 'superspl.tab', order: 40, ownFilters: true, mount };

let registered = false;
/** Adds the tab to every picker opened from now on (once). */
export function installSuperSplatTab(): void {
    if (registered) return;
    registered = true;
    registerPickerTab(superSplatTab);
}

installSuperSplatTab();

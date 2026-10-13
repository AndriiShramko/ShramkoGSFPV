// The v0.7 fields of one scene in the admin's editor (packages/scenes/src/catalog.ts has their meaning and
// ranges, apps/api/admin.py checks them again on save): where the place is (with "Find place" by name), the
// compass heading of the scene's forward axis, the wind (typed, or the place's prevailing wind from five
// years of weather), the collision ceiling, how SuperSplat draws it (budget, stochastic) and our own words
// for the scene's page in four languages. Every input writes straight into the entry and calls `changed`;
// a value out of range or emptied removes the field, so the draft never holds half a value.
import type { CatalogScene, LocalText } from '@gsfpv/scenes';
import { h, clear } from '../ui/dom';
import { t, locale } from './i18n';
import { ApiError } from './api';
import type { AdminClient } from './api';

const LANGS = ['en', 'es', 'pl', 'ru'] as const;

function field(label: string, input: HTMLElement): HTMLElement {
    return h('label', { class: 'field' }, h('span', {}, label), input);
}

function numberInput(value: number | undefined, min: number, max: number, step: number, data: string): HTMLInputElement {
    return h('input', { type: 'number', min, max, step, inputmode: 'decimal', value: value === undefined ? '' : String(value), 'data-field': data }) as HTMLInputElement;
}

/** The number typed in, when it is one and in range; else undefined. */
function read(i: HTMLInputElement, min: number, max: number): number | undefined {
    const v = i.valueAsNumber;
    return Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

/** The editor's "Place, wind and drawing" block for one entry. */
export function placeEditor(s: CatalogScene, api: AdminClient, changed: () => void): HTMLElement {
    // ---- geo ----
    const lat = numberInput(s.geo?.lat, -90, 90, 0.001, 'lat');
    const lon = numberInput(s.geo?.lon, -180, 180, 0.001, 'lon');
    const place = h('input', { type: 'text', maxlength: 80, value: s.geo?.place ?? '', 'data-field': 'place' }) as HTMLInputElement;
    const climateBtn = h('button', { type: 'button', class: 'btn small', 'data-action': 'climate' }, t('admin.wind.climate'));
    const setGeo = (): void => {
        const a = read(lat, -90, 90);
        const b = read(lon, -180, 180);
        if (a === undefined || b === undefined) delete s.geo;
        else s.geo = { lat: Math.round(a * 1000) / 1000, lon: Math.round(b * 1000) / 1000, ...(place.value.trim() ? { place: place.value.trim() } : {}) };
        climateBtn.disabled = !s.geo;
        changed();
    };
    for (const i of [lat, lon, place]) i.addEventListener('input', setGeo);
    climateBtn.disabled = !s.geo;

    const q = h('input', { type: 'text', class: 'grow', maxlength: 80, 'aria-label': t('admin.place.findLabel'), placeholder: t('admin.place.findLabel'), 'data-field': 'find-place' }) as HTMLInputElement;
    const hits = h('div', { class: 'place-hits', 'aria-live': 'polite' });
    const find = async (): Promise<void> => {
        const text = q.value.trim();
        if (text.length < 2) return;
        clear(hits);
        try {
            const found = await api.findPlace(text, locale);
            if (!found.length) hits.append(h('p', { class: 'muted' }, t('admin.place.none')));
            for (const p of found) {
                hits.append(h('button', { type: 'button', class: 'btn small', 'data-place': p.place, onclick: () => {
                    lat.value = String(p.lat);
                    lon.value = String(p.lon);
                    place.value = p.place;
                    clear(hits);
                    setGeo();
                } }, `${t('admin.place.use')}: ${p.place} (${p.lat}, ${p.lon})`));
            }
        } catch (e) {
            hits.append(h('p', { class: 'bad' }, e instanceof ApiError ? e.reason || String(e.status) : t('admin.error.network')));
        }
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void find(); } });
    const clearGeo = h('button', { type: 'button', class: 'btn small', onclick: () => { lat.value = ''; lon.value = ''; place.value = ''; setGeo(); } }, t('admin.place.clear'));

    // ---- compass, ceiling ----
    const compass = numberInput(s.compassDeg, 0, 360, 1, 'compassDeg');
    compass.addEventListener('input', () => { const v = read(compass, 0, 360); if (v === undefined) delete s.compassDeg; else s.compassDeg = v; changed(); });
    const ceiling = numberInput(s.ceilingM, -10000, 10000, 0.5, 'ceilingM');
    ceiling.addEventListener('input', () => { const v = read(ceiling, -10000, 10000); if (v === undefined) delete s.ceilingM; else s.ceilingM = v; changed(); });

    // ---- wind ----
    const wFrom = numberInput(s.wind?.fromDeg, 0, 360, 1, 'windFrom');
    const wSpeed = numberInput(s.wind?.speed, 0, 30, 0.1, 'windSpeed');
    const wGust = numberInput(s.wind?.gust, 0, 20, 0.1, 'windGust');
    const source = h('p', { class: 'muted', 'data-field': 'windSource' });
    const showSource = (): void => { source.textContent = s.wind ? t(s.wind.source === 'climate' ? 'admin.wind.climate' : 'admin.wind.manual') : ''; };
    const setWind = (): void => {
        const f = read(wFrom, 0, 360);
        const sp = read(wSpeed, 0, 30);
        const g = read(wGust, 0, 20);
        // typing changes a climate wind into the owner's own
        if (f === undefined || sp === undefined || g === undefined) delete s.wind;
        else s.wind = { fromDeg: f, speed: sp, gust: g, source: 'manual' };
        showSource();
        changed();
    };
    for (const i of [wFrom, wSpeed, wGust]) i.addEventListener('input', setWind);
    showSource();
    const climateNote = h('p', { class: 'muted', 'aria-live': 'polite' });
    climateBtn.addEventListener('click', async () => {
        if (!s.geo) { climateNote.textContent = t('admin.wind.climateNeedsGeo'); return; }
        climateBtn.disabled = true;
        climateNote.textContent = '…';
        try {
            const c = await api.climateWind(s.geo.lat, s.geo.lon);
            s.wind = { fromDeg: c.wind.fromDeg, speed: c.wind.speed, gust: c.wind.gust, source: 'climate' };
            wFrom.value = String(c.wind.fromDeg);
            wSpeed.value = String(c.wind.speed);
            wGust.value = String(c.wind.gust);
            climateNote.textContent = t('admin.wind.climateDone', { from: c.years[0], to: c.years[1], steady: Math.round(c.wind.steadiness * 100) });
            showSource();
            changed();
        } catch (e) {
            climateNote.textContent = e instanceof ApiError ? e.reason || String(e.status) : t('admin.error.network');
        } finally {
            climateBtn.disabled = !s.geo;
        }
    });
    const noWind = h('button', { type: 'button', class: 'btn small', onclick: () => { wFrom.value = ''; wSpeed.value = ''; wGust.value = ''; setWind(); } }, t('admin.wind.clear'));

    // ---- how SuperSplat draws it ----
    const budget = numberInput(s.render?.budgetM, 0.25, 32, 0.25, 'budgetM');
    const stochastic = h('input', { type: 'checkbox', 'data-field': 'stochastic' }) as HTMLInputElement;
    stochastic.checked = s.render?.stochastic === true;
    const setRender = (): void => {
        const b = read(budget, 0.25, 32);
        const r = { ...(b !== undefined ? { budgetM: b } : {}), ...(stochastic.checked ? { stochastic: true } : {}) };
        if (Object.keys(r).length) s.render = r; else delete s.render;
        changed();
    };
    budget.addEventListener('input', setRender);
    stochastic.addEventListener('change', setRender);

    // ---- our words for the scene page ----
    const about = LANGS.map((l) => {
        const a = h('textarea', { maxlength: 1500, rows: 3, 'data-about': l }) as HTMLTextAreaElement;
        a.value = s.about?.[l] ?? '';
        a.addEventListener('input', () => {
            const next: LocalText = { ...(s.about ?? {}) };
            if (a.value.trim()) next[l] = a.value; else delete next[l];
            if (Object.keys(next).length) s.about = next; else delete s.about;
            changed();
        });
        return field(t('admin.field.about', { lang: l }), a);
    });

    return h('fieldset', { class: 'place-editor', 'data-testid': 'place-editor' },
        h('legend', {}, t('admin.place.title')),
        field(t('admin.field.lat'), lat), field(t('admin.field.lon'), lon), field(t('admin.field.place'), place),
        h('div', { class: 'bar wide' }, q, h('button', { type: 'button', class: 'btn small', 'data-action': 'find-place', onclick: () => void find() }, t('admin.place.find')), clearGeo),
        hits,
        field(t('admin.field.compassDeg'), compass),
        field(t('admin.field.windFrom'), wFrom), field(t('admin.field.windSpeed'), wSpeed), field(t('admin.field.windGust'), wGust),
        h('div', { class: 'bar wide' }, climateBtn, noWind, source),
        climateNote,
        field(t('admin.field.ceilingM'), ceiling),
        field(t('admin.field.budgetM'), budget),
        h('label', { class: 'check' }, stochastic, ' ', t('admin.field.stochastic')),
        ...about
    );
}

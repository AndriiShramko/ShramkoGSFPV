// Scene links (v0.7 lane R, the owner's item 1): a SuperSplat link is a scene id plus how SuperSplat's
// viewer was asked to draw it, e.g. https://superspl.at/scene/2f1ddf5f?budget=8&stochastic. Everywhere
// a link is pasted (the picker, the landing, the admin) the id AND these parameters are kept; the fly
// page's own deep link carries them as /fly/?scene=<id>&budget=<M>&stochastic. Pure: no DOM, no fetch.
//
// What SuperSplat's viewer does (@playcanvas/supersplat-viewer 1.37.0, public/index.html, read
// 2026-10-13): budget = Number(?budget) in millions of splats, used when finite and > 0; stochastic =
// searchParams.has('stochastic'), any value. Here, on purpose: the budget must be a plain decimal in the
// catalogue contract's range (0.25..32 M, catalog.ts readRender), and stochastic=0/false/no/off is an
// explicit "sorted" instead of "on"; any other stochastic value is dropped.
import type { SceneRender } from './catalog';

/** Scene ids seen so far are 8 hex chars; accept 6..32 so a longer id is not rejected blindly. */
export const SCENE_ID_RE = /^[0-9a-f]{6,32}$/i;

/** The budget range a link or the catalogue may ask for, millions of splats (catalog.ts readRender). */
export const BUDGET_MIN_M = 0.25;
export const BUDGET_MAX_M = 32;

/** A pasted text longer than this is not a scene link (nothing real comes close). */
const MAX_LINK_CHARS = 2048;

/** A plain decimal: digits, at most one point; no sign, exponent, hex, spaces or units. */
const DECIMAL = /^(?:\d{1,3}(?:\.\d{1,4})?|\.\d{1,4})$/;
const ON = new Set(['', '1', 'true', 'yes', 'on']);
const OFF = new Set(['0', 'false', 'no', 'off']);

/**
 * A scene and how its link asks it to be drawn. `render.stochastic` false is a link that asked for the
 * sorted drawing explicitly (stochastic=0); absent means the link said nothing.
 */
export interface SceneLink {
    id: string;
    render?: SceneRender;
}

/**
 * The drawing parameters of a link or page, from the raw values of `budget` and `stochastic`
 * (URLSearchParams.get: null = absent, '' = present without a value). undefined when neither is usable.
 */
export function renderParams(budget: string | null, stochastic: string | null): SceneRender | undefined {
    const r: SceneRender = {};
    if (budget !== null && DECIMAL.test(budget)) {
        const m = Number(budget);
        if (m >= BUDGET_MIN_M && m <= BUDGET_MAX_M) r.budgetM = m;
    }
    if (stochastic !== null) {
        const v = stochastic.trim().toLowerCase();
        if (ON.has(v)) r.stochastic = true;
        else if (OFF.has(v)) r.stochastic = false;
    }
    return r.budgetM === undefined && r.stochastic === undefined ? undefined : r;
}

/**
 * Accepts a bare id, https://superspl.at/scene/<id>[?...] or https://superspl.at/s?id=<id>[&...]
 * (with or without the scheme, www. allowed). Returns the lower-case id and the link's drawing
 * parameters, or null when the text is not a SuperSplat scene link.
 */
export function parseSceneLink(raw: string): SceneLink | null {
    const s = raw.trim();
    if (!s || s.length > MAX_LINK_CHARS) return null;
    if (SCENE_ID_RE.test(s)) return { id: s.toLowerCase() };
    let u: URL;
    try {
        u = new URL(s.includes('://') ? s : `https://${s}`);
    } catch {
        return null;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase();
    if (host !== 'superspl.at' && host !== 'www.superspl.at') return null;
    let id: string | null = null;
    const m = u.pathname.match(/^\/scene\/([0-9a-f]+)\/?$/i);
    if (m && SCENE_ID_RE.test(m[1])) id = m[1];
    else if (u.pathname === '/s' || u.pathname === '/s/') {
        const q = u.searchParams.get('id');
        if (q && SCENE_ID_RE.test(q)) id = q;
    }
    if (!id) return null;
    const render = renderParams(u.searchParams.get('budget'), u.searchParams.get('stochastic'));
    return render ? { id: id.toLowerCase(), render } : { id: id.toLowerCase() };
}

/**
 * What a scene is asked to draw with: each field of the link (or the page) wins, the catalogue's
 * `render` (the admin's choice) is the default. undefined when neither says anything.
 */
export function sceneRender(link: SceneRender | undefined, catalogue: SceneRender | undefined): SceneRender | undefined {
    const r: SceneRender = {};
    const budgetM = link?.budgetM ?? catalogue?.budgetM;
    const stochastic = link?.stochastic ?? catalogue?.stochastic;
    if (budgetM !== undefined) r.budgetM = budgetM;
    if (stochastic !== undefined) r.stochastic = stochastic;
    return r.budgetM === undefined && r.stochastic === undefined ? undefined : r;
}

/** Two drawing requests ask for the same thing (none and none, or the same budget and flag). */
export function sameRender(a: SceneRender | undefined, b: SceneRender | undefined): boolean {
    return a?.budgetM === b?.budgetM && a?.stochastic === b?.stochastic;
}

/**
 * A link's request as the catalogue stores it (the contract field `render`): only a budget in range and
 * stochastic: true; an explicit "sorted" is the catalogue's default already. undefined when nothing is left.
 */
export function catalogueRender(r: SceneRender | undefined): SceneRender | undefined {
    if (!r) return undefined;
    const out: SceneRender = {};
    if (r.budgetM !== undefined && r.budgetM >= BUDGET_MIN_M && r.budgetM <= BUDGET_MAX_M) out.budgetM = r.budgetM;
    if (r.stochastic === true) out.stochastic = true;
    return Object.keys(out).length ? out : undefined;
}

/**
 * Write a scene and its drawing parameters into a fly page's query: scene=<id>, budget=<M> and the
 * stochastic flag when the link asked for them; a budget or flag left from another scene is removed.
 * Other parameters stay. Serialise with flyQueryString to get the bare `&stochastic` flag.
 */
export function writeSceneQuery(q: URLSearchParams, id: string, render?: SceneRender): void {
    q.set('scene', id);
    if (render?.budgetM !== undefined) q.set('budget', String(render.budgetM));
    else q.delete('budget');
    if (render?.stochastic === true) q.set('stochastic', '');
    else if (render?.stochastic === false) q.set('stochastic', '0');
    else q.delete('stochastic');
}

/** The query as text, with the stochastic flag bare (`&stochastic`, as SuperSplat writes it) rather than `stochastic=`. */
export function flyQueryString(q: URLSearchParams): string {
    return q.toString().replace(/(^|&)stochastic=(?=&|$)/, '$1stochastic');
}

/** The fly deep link of a scene under `flyPath` (e.g. "/en/fly/"): /en/fly/?scene=<id>&budget=<M>&stochastic. */
export function flyDeepLink(flyPath: string, id: string, render?: SceneRender): string {
    const q = new URLSearchParams();
    writeSceneQuery(q, id, render);
    return `${flyPath}?${flyQueryString(q)}`;
}

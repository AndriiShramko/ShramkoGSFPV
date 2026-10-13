// Whose scan a scene is, and the credit that goes with it wherever it leaves the page: the share
// picture and caption (share/), the line burned into every video (cinema.ts, app/builtin/cinema.ts)
// and the author notice of a recording (docs/wip/v07-d1.md section 2, decision D36).
//
// Facts come from the owner's catalogue (GET /api/catalog or showcase.json: title, author, licence)
// and, for any other scan, from what the picker's SuperSplat tab showed when the pilot picked it
// (@gsfpv/scenes rememberSceneFacts). A pasted link knows only the id: the credit is then the scan's
// address on SuperSplat, which is where its author and licence are.
//
// Pure: no DOM, no clock (tools/bench/test/flight-ux.test.ts runs it in Node).
import type { SceneFacts } from '@gsfpv/scenes';

/** The product's name in every credit (the owner's rule: every project carries Shramko). */
export const BRAND = 'ShramkoGSFPV';
/** The site's host, the way into the simulator from a picture or a video. */
export const SITE_HOST = 'gsfpv.flyreelstudio.eu';

/** What the page knows of the scan flown or shown. */
export interface SceneCredit {
    id: string;
    title: string | null;
    author: string | null;
    license: string | null;
    /** a scan of the owner's catalogue (the admin's list): its authors agreed to recordings (D34) */
    inCatalogue: boolean;
}

/** The catalogue's fields this module reads (a CatalogScene has them). */
export interface CatalogueFacts { title?: string; author?: string; license?: string }

const clean = (s: string | undefined | null): string | null => {
    const v = typeof s === 'string' ? s.trim() : '';
    return v ? v : null;
};

/**
 * The scene's credit facts: the catalogue's when the scene is in it (`meta`), else what a listing
 * showed (`listed`, from the scene library), else the id alone.
 */
export function creditFacts(id: string, meta: CatalogueFacts | undefined, listed: SceneFacts = {}): SceneCredit {
    const src = meta ?? listed;
    return { id, title: clean(src.title) ?? clean(listed.title), author: clean(src.author), license: clean(src.license), inCatalogue: !!meta };
}

/** The scan's page on SuperSplat, without the scheme (it reads as an address in a picture or a video). */
export function sceneSource(id: string): string {
    return `superspl.at/scene/${id}`;
}

/**
 * "Title — Author, Licence" with what is known; without an author the scan's SuperSplat address
 * stands in for it (that page names the author and the licence).
 */
export function creditText(c: SceneCredit): string {
    const who = c.author ? [c.author, c.license].filter(Boolean).join(', ') : sceneSource(c.id);
    return c.title ? `${c.title} — ${who}` : who;
}

/** The line burned into every frame of every video (D34, D36): the scan's credit, the product, the site. */
export function videoCredit(c: SceneCredit): string {
    return `${creditText(c)} · ${BRAND} · ${SITE_HOST}`;
}

/** The author notice's text: its i18n key and the values it names. */
export interface NoticeText { key: 'rec.notice' | 'rec.notice.author' | 'rec.notice.unknown'; vars: Record<string, string> }

/**
 * The one line a recording of a scan outside the owner's catalogue starts with (item 2): shown the
 * first time such a scan is recorded in this page (`shownFor` holds the scans it was shown for),
 * never while the pilot has turned it off (`enabled`: recording.authorNotice), never for a catalogue
 * scan (its authors agreed). null: nothing to show.
 */
export function authorNotice(c: SceneCredit, o: { enabled: boolean; shownFor: ReadonlySet<string> }): NoticeText | null {
    if (c.inCatalogue || !o.enabled || o.shownFor.has(c.id)) return null;
    if (c.author && c.license) return { key: 'rec.notice', vars: { author: c.author, license: c.license } };
    if (c.author) return { key: 'rec.notice.author', vars: { author: c.author } };
    return { key: 'rec.notice.unknown', vars: {} };
}

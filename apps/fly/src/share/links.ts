// Sharing, the part without a page: which link a share carries from each place it starts, which
// words go with it, the share-intent URLs and the Instagram caption (docs/wip/v07-d1.md section 1;
// the owner's message 18, item 6: "a pilot can share the scene they fly or flew at any moment").
//
// The link (contract with lane A, docs/wip/v07-plan.md):
//  - in a flight a picture of the view can be made: POST /api/share answers /s/<id>, a page whose
//    Open Graph card is that picture (share/picture.ts, apps/api/server.py);
//  - without one (the picker, no frame, the API down): the scene's page, /{lang}/scenes/<id>/ for a
//    scan of the owner's catalogue (lane A builds those pages); a scan outside it has no page, so the
//    simulator's own deep link /{lang}/fly/?scene=<id>, with the page's budget / stochastic drawing
//    parameters kept (lane R's link contract).
//
// Pure: no DOM, no clock, no fetch (tools/bench/test/flight-ux.test.ts). share/panel.ts is the page.

/**
 * Where a share starts. In a flight: `top` (the button on the top bar), `key` (L), `pause` (the pause
 * menu, which is the summary panel, and its "Nice flight" row), `card` (the stats card after a
 * disarm), `crash` (the crash panel), `video` (after a recording stops). Outside one: `picker` (a card
 * of the scene picker) and `recent` (the picker's Continue card, a recent scene).
 */
export type ShareEntry = 'top' | 'key' | 'pause' | 'card' | 'crash' | 'video' | 'picker' | 'recent';

/** Every entry point, in the order above (tests walk them). */
export const SHARE_ENTRIES: readonly ShareEntry[] = ['top', 'key', 'pause', 'card', 'crash', 'video', 'picker', 'recent'];

/** Which words a share uses: a line flown, a crash, a scene not flown yet, a video of the flight. */
export type ShareKind = 'flight' | 'crash' | 'scene' | 'video';

/** The entry is inside a flight: the view is on screen and can become the share picture. */
export function inFlight(e: ShareEntry): boolean {
    return e !== 'picker' && e !== 'recent';
}

/** The words for an entry: the crash panel brags about the crash, a video about the line, the picker invites. */
export function kindOf(e: ShareEntry): ShareKind {
    if (e === 'crash') return 'crash';
    if (e === 'video') return 'video';
    return inFlight(e) ? 'flight' : 'scene';
}

/** Where the page is: its origin, its language (the /{lang}/ of the path) and its query (for lane R's drawing parameters). */
export interface PagePlace { origin: string; locale: string; search?: string }

/** SuperSplat's drawing parameters a fly link keeps (lane R): ?budget=<millions> and the bare ?stochastic flag. */
function drawingParams(search: string | undefined): string {
    if (!search) return '';
    const q = new URLSearchParams(search);
    let out = '';
    const budget = q.get('budget');
    if (budget !== null && /^\d+(\.\d+)?$/.test(budget)) out += `&budget=${budget}`;
    if (q.has('stochastic')) out += '&stochastic';
    return out;
}

/**
 * The scene's own page: /{lang}/scenes/<id>/ for a scan of the owner's catalogue, else the simulator's
 * deep link /{lang}/fly/?scene=<id> (no page exists for a scan outside the catalogue).
 */
export function scenePageUrl(id: string, inCatalogue: boolean, at: PagePlace): string {
    return inCatalogue ? `${at.origin}/${at.locale}/scenes/${id}/` : `${at.origin}/${at.locale}/fly/?scene=${id}${drawingParams(at.search)}`;
}

/**
 * The link a share carries: the picture page (/s/<id>) when the share started in a flight and the
 * picture's page could be made (`pictureUrl`), else the scene's page.
 */
export function shareLink(o: { entry: ShareEntry; sceneId: string; inCatalogue: boolean; at: PagePlace; pictureUrl: string | null }): string {
    if (inFlight(o.entry) && o.pictureUrl) return o.pictureUrl;
    return scenePageUrl(o.sceneId, o.inCatalogue, o.at);
}

/** The i18n key of the words for a kind (packages/i18n/locales/fly/share/). */
export function wordsKey(kind: ShareKind): string {
    return `share.text.${kind}`;
}

/** A share target's URL from its template in @gsfpv/i18n/share.json: {url}, {text} and {title}, percent-encoded. */
export function targetHref(template: string, url: string, text: string, title: string): string {
    return template.replace('{url}', encodeURIComponent(url)).replace('{text}', encodeURIComponent(text)).replace('{title}', encodeURIComponent(title));
}

/**
 * Instagram's caption (it has no web share link, so the pilot pastes this under the picture or the
 * video): the words, the link, the scan's credit (CC BY wants it) and the tags, one per line.
 */
export function instagramCaption(o: { text: string; url: string; credit: string | null; tags: string }): string {
    return [o.text, o.url, o.credit ?? '', o.tags].filter((s) => s.length > 0).join('\n\n');
}

/** A data: URL (the share picture) as bytes and type, without fetch (the page's CSP has no data: in connect-src). */
export function dataUrlBytes(url: string): { type: string; bytes: Uint8Array<ArrayBuffer> } | null {
    const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]*)$/.exec(url);
    if (!m) return null;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { type: m[1], bytes };
}

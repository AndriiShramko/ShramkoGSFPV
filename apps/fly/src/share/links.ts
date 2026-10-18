// Sharing, the part without a page: which link a share carries from each place it starts, which
// words go with it, the share-intent URLs and the Instagram caption (docs/wip/v07-d1.md section 1;
// the owner's message 18, item 6: "a pilot can share the scene they fly or flew at any moment").
//
// The link (contract with lane A, docs/wip/v07-plan.md):
//  - in a flight a picture of the view can be made: POST /api/share answers /s/<id>, a page whose
//    Open Graph card is that picture (share/picture.ts, apps/api/server.py); the body sends how the
//    scene is drawn (`render`), so the page opens the same deep link (server.py fly_link);
//  - without one (the picker, no frame, the API down): the scene's page, /{lang}/scenes/<id>/ for a
//    scan of the owner's catalogue drawn as the catalogue says (lane A builds those pages); any other
//    scan, or a catalogue scan whose link asked for a drawing of its own, the simulator's deep link
//    /{lang}/fly/?scene=<id>&budget=<M>&stochastic.
// How a scene is drawn is lane R's alone: @gsfpv/scenes reads a link (parseSceneLink, renderParams)
// and writes the deep link (flyDeepLink, the same table as the server's fly_link). Nothing here reads
// a query: the drawing a share carries is the one of the scene shared, taken when the share starts
// (flightDrawing: the scene flown NOW, also after an in-page scene switch; cardDrawing: a picker
// card's scene, which opens as the catalogue says).
//
// A link carries ITS OWN fields only. The owner's per-scene entry (the catalogue's `render`) is never
// written into a link: a link parameter outranks the visitor's Display -> Render and Splat budget
// (link > pilot > owner > device, packages/render-pc drawing.ts), and the simulator applies the
// owner's entry itself whenever the link names nothing. So `render` below is the link's, `catalogue`
// the owner's, and only the first one ever reaches a URL or the /api/share body.
//
// The sharer's scene settings (v0.9 item 15: Scene size, walls, floater cleanup, wind, collision ceiling, drone)
// go after the deep link as compact parameters (@gsfpv/scenes shared-settings.ts; share/shared.ts decides
// which differ from the scene's defaults), so a scene with some of them is shared as its deep link, not as
// its static page. How the scene is DRAWN stays lane R's alone: the pilot's own Display drawing / budget choice is
// a choice about his device, not about the scene, so a share never carries it (decision D69).
//
// Pure: no DOM, no clock, no fetch (tools/bench/test/flight-ux.test.ts). share/panel.ts is the page.
import { appendShared, flyDeepLink, isEmptyShared, sameRender, sceneRender } from '@gsfpv/scenes';
import type { SceneRender, SharedSettings } from '@gsfpv/scenes';

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

/** Where the page is: its origin and its language (the /{lang}/ of the path). */
export interface PagePlace { origin: string; locale: string }

/**
 * How the shared scene is drawn (lane R's SceneRender: SuperSplat's ?budget= and ?stochastic):
 * `render`, what the scene's own LINK asked for (the only part a URL or the share body may carry), and
 * `catalogue`, the owner's entry (what its scene page flies it with; used to choose between the scene
 * page and the deep link, never written into either). Both absent: the engine's default.
 */
export interface ShareDrawing {
    render?: SceneRender;
    catalogue?: SceneRender;
}

/** A scene as the flight holds it (app/context.ts SceneRef): the link's render and the catalogue entry's. */
export interface DrawnScene {
    render?: SceneRender;
    meta?: { render?: SceneRender };
}

/**
 * The drawing of the scene flown now. Read when the share starts, from the flight's current scene, so a
 * share after an in-page scene switch carries the new scene's drawing (app/context.ts SceneRef: the
 * scene's link `render`, and `meta.render`, the owner's entry, which is kept apart).
 */
export function flightDrawing(scene: DrawnScene): ShareDrawing {
    return { render: scene.render, catalogue: scene.meta?.render };
}

/** The drawing of a picker card's scene: a card opens it as the catalogue says (a card passes no link). */
export function cardDrawing(meta: { render?: SceneRender } | undefined): ShareDrawing {
    return { render: undefined, catalogue: meta?.render };
}

/**
 * The scene's own page: /{lang}/scenes/<id>/ for a scan of the owner's catalogue drawn as the
 * catalogue says (that page flies it so, i.e. the link's fields laid over the owner's entry change
 * nothing); else the simulator's deep link with the LINK's own fields (@gsfpv/scenes flyDeepLink): a
 * scan outside the catalogue has no page, and a catalogue scan whose link asked for another drawing
 * would lose it there. The owner's entry is not written into the deep link (see the top of the file).
 */
export function scenePageUrl(id: string, inCatalogue: boolean, at: PagePlace, drawing: ShareDrawing = {}, shared: SharedSettings = {}): string {
    const asCatalogue = sceneRender(undefined, drawing.catalogue);
    // the static page cannot carry settings: a scene shared with some goes out as its deep link
    if (inCatalogue && isEmptyShared(shared) && sameRender(sceneRender(drawing.render, drawing.catalogue), asCatalogue)) return `${at.origin}/${at.locale}/scenes/${id}/`;
    return `${at.origin}${appendShared(flyDeepLink(`/${at.locale}/fly/`, id, drawing.render), shared)}`;
}

/**
 * The link a share carries: the picture page (/s/<id>) when the share started in a flight and the
 * picture's page could be made (`pictureUrl`), else the scene's page (scenePageUrl, with `drawing`,
 * the shared scene's drawing).
 */
export function shareLink(o: { entry: ShareEntry; sceneId: string; inCatalogue: boolean; at: PagePlace; pictureUrl: string | null; drawing?: ShareDrawing; shared?: SharedSettings }): string {
    if (inFlight(o.entry) && o.pictureUrl) return o.pictureUrl;
    return scenePageUrl(o.sceneId, o.inCatalogue, o.at, o.drawing, o.shared);
}

/**
 * The body of POST /api/share (apps/api/server.py): the picture, the scene, its words, and `render`,
 * what the scene's link asked for (never the owner's entry), from which the server writes the /s/<id> page's deep link (fly_link, the
 * same table as flyDeepLink: packages/scenes/test/fixtures/fly-deep-links.json), and `shared`, the sharer's scene
 * settings that differ from the scene's defaults (shared_query, packages/scenes/test/fixtures/shared-links.json).
 * `hp`: the honeypot.
 */
export function shareApiBody(o: { image: string; sceneId: string; title: string | null; credit: string; locale: string; drawing: ShareDrawing; shared?: SharedSettings }): Record<string, unknown> {
    return { image: o.image, scene: o.sceneId, render: o.drawing.render ?? null, shared: o.shared && !isEmptyShared(o.shared) ? o.shared : null, title: o.title ?? '', credit: o.credit, locale: o.locale, hp: '' };
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

/** The size in bytes, rounded up, of the data inside a base64 data: URL with `prefixLength` characters before the data (data:image/jpeg;base64, = 23). */
export function dataUrlSize(url: string, prefixLength = 23): number {
    return Math.ceil((url.length - prefixLength) * 0.75);
}

/**
 * The first encoding of a picture, trying `qualities` in order, whose data is at most `maxBytes`; null when
 * even the last one is over (a grainy frame at a size the API refuses): the caller says so and the share
 * falls back to the scene's page, instead of uploading a picture the API will turn away.
 */
export function encodeUnder(encode: (quality: number) => string, maxBytes: number, qualities: readonly number[]): string | null {
    for (const q of qualities) {
        const url = encode(q);
        if (dataUrlSize(url) <= maxBytes) return url;
    }
    return null;
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

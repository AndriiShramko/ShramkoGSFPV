// v0.7 lane D1, flight UX (docs/wip/v07-d1.md), in Node on the real modules. Claims, each with a
// negative control that must fire:
//  - sharing: every entry point carries the right link (the picture page /s/<id> from a flight, the
//    scene page from the picker; a catalogue scan's page when drawn as the catalogue says, else the fly
//    deep link with the drawing of the scene shared, read and written by lane R's packages/scenes
//    only, and POST /api/share sends it as `render`) and the right words (control: v0.6's one plain
//    fly link for every place; D1's own query reader before the merge, which turned stochastic=0 on,
//    kept a budget of 100 and carried the opened page's drawing after an in-page scene switch);
//  - copying (Instagram's caption, the link): the fallback copy keeps the caption's line breaks and
//    leaves nothing on the page (control: an <input> scratch, which strips them; review R4);
//  - recording on every scan: the browser's ability alone decides (the gate itself, with D34's put
//    back as the control, is tested on the real start() in flight-ux-recording.test.ts), the
//    burned-in credit always names the scan's author or its page and ShramkoGSFPV, the author notice
//    comes once per scan and never after "Don't show again" (control: a notice that forgets it was shown);
//  - the crosshair: settings -> the SVG on the page (control: a builder that ignores the shape);
//    hidden in cinema mode (control: the stylesheet without its rule);
//  - the motor sound: the graph is built, glides and closes on an AudioContext (a fake one here);
//    silence when paused, crashed, disarmed, hidden, off (control: the same check finds sound in the
//    flight itself, so it is not always true); the frequencies follow the motors; the model is only read;
//  - every text the new code names exists in English (control: a planted unknown key is reported);
//  - L is the share key in flight and over a crash, and no other binding has it.
//  - the always-visible Share makes the top row longer: the walls box and the author notice go under
//    it wherever they would meet (the check: the boxes measured in Chrome must not overlap; control:
//    v0.6's fixed 640 px breakpoint leaves them overlapping), and the mode chip on a phone goes under
//    the row (control: the old search that stepped past the soft boxes only).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KEYMAP, actionFor, keymapProblems } from '../../../packages/prefs/src';
import { mkStore } from '../../../packages/prefs/test/helpers';
import { REPO } from '../src/evidence';
import { SHARE_ENTRIES, cardDrawing, dataUrlBytes, dataUrlSize, encodeUnder, flightDrawing, inFlight, instagramCaption, kindOf, scenePageUrl, shareApiBody, shareLink, targetHref, wordsKey } from '../../../apps/fly/src/share/links';
import type { DrawnScene, ShareEntry } from '../../../apps/fly/src/share/links';
import { flyDeepLink, parseSceneLink, renderParams } from '../../../packages/scenes/src';
import type { SceneRender } from '../../../packages/scenes/src';
import { copyText } from '../../../apps/fly/src/share/clipboard';
import type { ClipboardEnv } from '../../../apps/fly/src/share/clipboard';
import { authorNotice, creditFacts, creditText, videoCredit } from '../../../apps/fly/src/scene-facts';
import type { SceneCredit } from '../../../apps/fly/src/scene-facts';
import { Recording } from '../../../apps/fly/src/app/builtin/recording';
import { CROSSHAIR_CSS, crosshairSpec, crosshairSvg } from '../../../apps/fly/src/crosshair';
import type { CrosshairSpec } from '../../../apps/fly/src/crosshair';
import { MASTER_MAX, MotorSound, audible, bladesOf, motorMix, rotorHz, voiceHarmonics } from '../../../apps/fly/src/audio/motor-sound';
import { TOP_GAP, boxMeetsRow } from '../../../apps/fly/src/ui/top-row';
import { gutterTop } from '../../../apps/fly/src/ui/top-row';
import type { Box } from '../../../apps/fly/src/ui/top-row';
import type { AudioLike, MixInput, MotorState } from '../../../apps/fly/src/audio/motor-sound';

const FLY = join(REPO, 'apps', 'fly', 'src');
const AT = { origin: 'https://gsfpv.flyreelstudio.eu', locale: 'pl' };
/** the page was opened for scan cafe0001 with SuperSplat's drawing parameters (lane R) */
const PAGE = '?scene=cafe0001&budget=8&stochastic&simradio=1';
const PIC = 'https://gsfpv.flyreelstudio.eu/s/AbCdEfGhIjK';

// ------------------------------------------------------------------ sharing

/** v0.6's one link (builtin/share.ts before v0.7): the plain fly link from every place, the picture only from the pause menu. */
const v06Link = (o: { entry: ShareEntry; sceneId: string; pictureUrl: string | null }): string =>
    o.entry === 'pause' && o.pictureUrl ? o.pictureUrl : `${AT.origin}/${AT.locale}/fly/?scene=${o.sceneId}`;

/**
 * The control of the share-link fix: D1's own reader before the merge with lane R (share/links.ts
 * pageDrawing). It read the query the page was OPENED with (when its ?scene= was the shared scene),
 * took any stochastic as "on" and any budget up to 1000.
 */
const d1PageDrawing = (id: string, search: string): SceneRender => {
    const q = new URLSearchParams(search);
    if (q.get('scene') !== id) return {};
    const out: SceneRender = {};
    const b = q.get('budget');
    if (b !== null && /^\d+(\.\d+)?$/.test(b) && Number(b) > 0 && Number(b) <= 1000) out.budgetM = Number(b);
    if (q.has('stochastic')) out.stochastic = true;
    return out;
};

/** The scene a page opened with `search` flies (app/boot.ts: the page's ?budget= and ?stochastic through lane R's reader). */
const openedWith = (search: string): DrawnScene => {
    const q = new URLSearchParams(search);
    const render = renderParams(q.get('budget'), q.get('stochastic'));
    return render ? { render } : {};
};

/** The plain link of a share from the flight's top bar whose picture failed (a scan outside the catalogue). */
const plainFromFlight = (sceneId: string, scene: DrawnScene): string =>
    shareLink({ entry: 'top', sceneId, inCatalogue: false, at: AT, pictureUrl: null, drawing: flightDrawing(scene) });

describe('share links: the right link from every place a share starts', () => {
    it('in a flight the picture page, else the scene page; from the picker never a picture', () => {
        for (const entry of SHARE_ENTRIES) {
            const withPic = shareLink({ entry, sceneId: 'ab12cd34', inCatalogue: true, at: AT, pictureUrl: PIC });
            const noPic = shareLink({ entry, sceneId: 'ab12cd34', inCatalogue: true, at: AT, pictureUrl: null });
            expect(withPic, entry).toBe(inFlight(entry) ? PIC : `${AT.origin}/pl/scenes/ab12cd34/`);
            expect(noPic, entry).toBe(`${AT.origin}/pl/scenes/ab12cd34/`);
        }
        expect(SHARE_ENTRIES.filter((e) => !inFlight(e))).toEqual(['picker', 'recent']);
    });

    it('a scan outside the catalogue has no page: the fly deep link (lane R flyDeepLink), with budget and stochastic kept and nothing else', () => {
        expect(plainFromFlight('cafe0001', openedWith(PAGE))).toBe(`${AT.origin}/pl/fly/?scene=cafe0001&budget=8&stochastic`);
        expect(plainFromFlight('cafe0001', openedWith('?scene=cafe0001&budget=8;alert(1)'))).toBe(`${AT.origin}/pl/fly/?scene=cafe0001`);
        expect(shareLink({ entry: 'picker', sceneId: 'cafe0001', inCatalogue: false, at: { origin: AT.origin, locale: 'en' }, pictureUrl: null })).toBe(`${AT.origin}/en/fly/?scene=cafe0001`);
        // the same writer as the page's own address and the server's /s/<id> page (packages/scenes link.ts)
        expect(plainFromFlight('cafe0001', openedWith(PAGE))).toBe(`${AT.origin}${flyDeepLink('/pl/fly/', 'cafe0001', { budgetM: 8, stochastic: true })}`);
    });

    it('stochastic=0 stays sorted (control: D1\'s reader turned it on)', () => {
        const page = '?scene=cafe0001&budget=8&stochastic=0';
        expect(plainFromFlight('cafe0001', openedWith(page))).toBe(`${AT.origin}/pl/fly/?scene=cafe0001&budget=8&stochastic=0`);
        const before = shareLink({ entry: 'top', sceneId: 'cafe0001', inCatalogue: false, at: AT, pictureUrl: null, drawing: { render: d1PageDrawing('cafe0001', page) } });
        expect(before).toBe(`${AT.origin}/pl/fly/?scene=cafe0001&budget=8&stochastic`);
    });

    it('a budget outside 0.25..32 M is dropped (control: D1\'s reader kept 100)', () => {
        const page = '?scene=cafe0001&budget=100&stochastic';
        expect(plainFromFlight('cafe0001', openedWith(page))).toBe(`${AT.origin}/pl/fly/?scene=cafe0001&stochastic`);
        expect(plainFromFlight('cafe0001', openedWith('?scene=cafe0001&budget=0.2'))).toBe(`${AT.origin}/pl/fly/?scene=cafe0001`);
        const before = shareLink({ entry: 'top', sceneId: 'cafe0001', inCatalogue: false, at: AT, pictureUrl: null, drawing: { render: d1PageDrawing('cafe0001', page) } });
        expect(before).toContain('budget=100');
    });

    it('after an in-page scene switch the share carries the scene flown now (control: D1 read the page as it was opened)', () => {
        // the flight's ctx.scene, replaced by app/scene-host.ts on every switch; the share reads it when it starts
        const ctx: { scene: DrawnScene & { id: string } } = { scene: { id: 'cafe0001', ...openedWith(PAGE) } };
        const share = (): string => plainFromFlight(ctx.scene.id, ctx.scene);
        expect(share()).toBe(`${AT.origin}/pl/fly/?scene=cafe0001&budget=8&stochastic`);
        // a link pasted in the picker over the flight: its own drawing (lane R parseSceneLink)
        const pasted = parseSceneLink('https://superspl.at/scene/beef0002?budget=2.5&stochastic=0')!;
        ctx.scene = { id: pasted.id, render: pasted.render };
        expect(share()).toBe(`${AT.origin}/pl/fly/?scene=beef0002&budget=2.5&stochastic=0`);
        // back to cafe0001 by N (the rotation passes no link): drawn as the engine's default, shared so
        ctx.scene = { id: 'cafe0001' };
        expect(share()).toBe(`${AT.origin}/pl/fly/?scene=cafe0001`);
        // control: the page's query as it was opened still names cafe0001, budget 8 and stochastic
        const before = shareLink({ entry: 'top', sceneId: 'cafe0001', inCatalogue: false, at: AT, pictureUrl: null, drawing: { render: d1PageDrawing('cafe0001', PAGE) } });
        expect(before).not.toBe(share());
        expect(before).toContain('budget=8');
    });

    it('a catalogue scan: its page when drawn as the catalogue says, else the deep link keeps the link\'s own drawing', () => {
        const meta = { render: { budgetM: 4, stochastic: true } };
        const link = (scene: DrawnScene): string => shareLink({ entry: 'crash', sceneId: 'ab12cd34', inCatalogue: true, at: AT, pictureUrl: null, drawing: flightDrawing(scene) });
        expect(link({ meta })).toBe(`${AT.origin}/pl/scenes/ab12cd34/`);
        // a link asking for what the catalogue says already is the same drawing
        expect(link({ meta, render: { stochastic: true } })).toBe(`${AT.origin}/pl/scenes/ab12cd34/`);
        // a pasted link asking for the sorted drawing: the scene page would draw it stochastic. The deep link
        // carries the link's OWN fields only: the owner's budget stays the catalogue's to apply (v0.9 order:
        // link > pilot > owner), a `budget=4` here would make it a link parameter that outranks the visitor's Splat budget
        expect(link({ meta, render: { stochastic: false } })).toBe(`${AT.origin}/pl/fly/?scene=ab12cd34&stochastic=0`);
        expect(scenePageUrl('ab12cd34', true, AT)).toBe(`${AT.origin}/pl/scenes/ab12cd34/`);
        // control: D1's rule (a catalogue scan always shares its page) gives the page there, and stochastic=0 is lost
        const d1ScenePage = (id: string, inCatalogue: boolean): string => (inCatalogue ? `${AT.origin}/pl/scenes/${id}/` : `${AT.origin}/pl/fly/?scene=${id}`);
        expect(d1ScenePage('ab12cd34', true)).not.toBe(link({ meta, render: { stochastic: false } }));
    });

    it('the owner\'s per-scene entry never becomes a link parameter, on any share path (link > pilot > owner: a parameter outranks the visitor\'s Render and Splat budget)', () => {
        const owner = { budgetM: 4, stochastic: false };
        const sent = (drawing: ReturnType<typeof flightDrawing>): unknown => shareApiBody({ image: '', sceneId: '2f1ddf5f', title: null, credit: 'c', locale: 'en', drawing }).render;
        // flown with no link of its own: the /s/<id> page must open `/fly/?scene=<id>`, nothing else
        expect(sent(flightDrawing({ meta: { render: owner } }))).toBeNull();
        expect(sent(cardDrawing({ render: owner }))).toBeNull();
        expect(sent(cardDrawing({ render: { budgetM: 8, stochastic: true } }))).toBeNull();
        // flown with a link that names one field: that field only, the owner's other field stays the owner's
        expect(sent(flightDrawing({ meta: { render: owner }, render: { stochastic: true } }))).toEqual({ stochastic: true });
        expect(sent(flightDrawing({ meta: { render: owner }, render: { budgetM: 2 } }))).toEqual({ budgetM: 2 });
        // what the visitor is sent to: the link's own fields, never `&budget=4` / `&stochastic=0` from the owner
        const body = shareApiBody({ image: '', sceneId: '2f1ddf5f', title: null, credit: 'c', locale: 'en', drawing: flightDrawing({ meta: { render: owner } }) });
        expect(flyDeepLink('/en/fly/', '2f1ddf5f', body.render as SceneRender | undefined)).toBe('/en/fly/?scene=2f1ddf5f');
        // the scene page and the deep link, from the share link: no owner field in the deep link
        expect(shareLink({ entry: 'picker', sceneId: '2f1ddf5f', inCatalogue: false, at: AT, pictureUrl: null, drawing: cardDrawing({ render: owner }) })).toBe(`${AT.origin}/pl/fly/?scene=2f1ddf5f`);
        expect(shareLink({ entry: 'crash', sceneId: '2f1ddf5f', inCatalogue: false, at: AT, pictureUrl: null, drawing: flightDrawing({ meta: { render: owner }, render: { stochastic: true } }) })).toBe(`${AT.origin}/pl/fly/?scene=2f1ddf5f&stochastic`);
    });

    it('a picker card shares the scene as the card opens it: the catalogue\'s drawing, never the page\'s query (control: D1 gave the Continue card the page\'s)', () => {
        expect(shareLink({ entry: 'recent', sceneId: 'cafe0001', inCatalogue: false, at: AT, pictureUrl: null, drawing: cardDrawing(undefined) })).toBe(`${AT.origin}/pl/fly/?scene=cafe0001`);
        expect(shareLink({ entry: 'picker', sceneId: 'beef0002', inCatalogue: false, at: AT, pictureUrl: null, drawing: cardDrawing(undefined) })).toBe(`${AT.origin}/pl/fly/?scene=beef0002`);
        expect(shareLink({ entry: 'picker', sceneId: 'ab12cd34', inCatalogue: true, at: AT, pictureUrl: null, drawing: cardDrawing({ render: { budgetM: 4 } }) })).toBe(`${AT.origin}/pl/scenes/ab12cd34/`);
        expect(shareLink({ entry: 'recent', sceneId: 'cafe0001', inCatalogue: false, at: AT, pictureUrl: null, drawing: { render: d1PageDrawing('cafe0001', PAGE) } })).toContain('budget=8');
    });

    it('POST /api/share sends the scene\'s drawing as `render`: the server writes the same deep link (control: D1\'s body had none)', () => {
        const table = JSON.parse(readFileSync(join(REPO, 'packages', 'scenes', 'test', 'fixtures', 'fly-deep-links.json'), 'utf8')) as { rows: { render: SceneRender | null; link: string }[] };
        const serverLink = (render: unknown): string | undefined => table.rows.find((r) => JSON.stringify(r.render) === JSON.stringify(render ?? null))?.link;
        const drawing = flightDrawing({ render: { budgetM: 1.25, stochastic: false } });
        const body = shareApiBody({ image: 'data:image/jpeg;base64,', sceneId: '2f1ddf5f', title: null, credit: 'c', locale: 'en', drawing });
        expect(body.render).toEqual({ budgetM: 1.25, stochastic: false });
        expect(body.title).toBe('');
        // the /s/<id> page's deep link (apps/api/server.py fly_link, held to the same table) = the plain link's
        expect(serverLink(body.render)).toBe('/en/fly/?scene=2f1ddf5f&budget=1.25&stochastic=0');
        expect(serverLink(body.render)).toBe(flyDeepLink('/en/fly/', '2f1ddf5f', drawing.render));
        expect(shareApiBody({ image: '', sceneId: '2f1ddf5f', title: 'T', credit: 'c', locale: 'en', drawing: {} }).render).toBeNull();
        // control: without `render` the server writes the plain link, not the one flown
        const d1Body: Record<string, unknown> = { image: '', scene: '2f1ddf5f', title: '', credit: 'c', locale: 'en', hp: '' };
        expect(serverLink(d1Body.render)).toBe('/en/fly/?scene=2f1ddf5f');
    });

    it('the words follow the place: the crash brags, the video invites, the picker invites to fly', () => {
        const kinds = Object.fromEntries(SHARE_ENTRIES.map((e) => [e, kindOf(e)]));
        expect(kinds).toEqual({ top: 'flight', key: 'flight', pause: 'flight', card: 'flight', crash: 'crash', video: 'video', picker: 'scene', recent: 'scene' });
    });

    it('control: v0.6\'s single link fails the same expectations (the catalogue page from the picker, the picture from the top bar)', () => {
        expect(v06Link({ entry: 'picker', sceneId: 'ab12cd34', pictureUrl: null })).not.toBe(shareLink({ entry: 'picker', sceneId: 'ab12cd34', inCatalogue: true, at: AT, pictureUrl: null }));
        expect(v06Link({ entry: 'top', sceneId: 'ab12cd34', pictureUrl: PIC })).not.toBe(PIC);
    });

    it('share-intent URLs and the Instagram caption carry the link, the words and the credit', () => {
        const targets = (JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'share.json'), 'utf8')) as { targets: { id: string; href: string }[] }).targets;
        expect(targets.map((x) => x.id)).toEqual(['linkedin', 'facebook', 'x', 'telegram', 'whatsapp', 'reddit']);
        for (const x of targets) expect(targetHref(x.href, PIC, 'Fly & win?', 'T'), x.id).toContain(encodeURIComponent(PIC));
        const cap = instagramCaption({ text: 'Fly it', url: PIC, credit: 'Scan: Old Mill — Jane, CC BY', tags: '#fpv' });
        expect(cap.split('\n\n')).toEqual(['Fly it', PIC, 'Scan: Old Mill — Jane, CC BY', '#fpv']);
        expect(instagramCaption({ text: 'Fly it', url: PIC, credit: null, tags: '' })).toBe(`Fly it\n\n${PIC}`);
    });

    it('the picture becomes a file without fetch (the CSP has no data: in connect-src); control: not a data URL', () => {
        const b = dataUrlBytes(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`);
        expect(b?.type).toBe('image/jpeg');
        expect(Array.from(b!.bytes)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
        expect(dataUrlBytes('https://example.com/x.jpg')).toBeNull();
    });

    it('the share picture steps its quality down to fit the API\'s limit, and says so when nothing fits (control: it used to return the last, too large, one)', () => {
        // a fake encoder: the lower the quality, the smaller the picture (a grainy stochastic frame needs the low steps)
        const sizes: Record<number, number> = { 0.88: 500_000, 0.8: 420_000, 0.72: 390_000, 0.64: 370_000, 0.56: 300_000 };
        const make = (bytes: number): string => `data:image/jpeg;base64,${'A'.repeat(Math.ceil((bytes * 4) / 3))}`;
        const tried: number[] = [];
        const encode = (q: number): string => { tried.push(q); return make(sizes[q]); };
        const Q = [0.88, 0.8, 0.72, 0.64, 0.56] as const;
        const MAX = 380 * 1024;
        expect(dataUrlSize(make(1000))).toBeGreaterThanOrEqual(1000);
        expect(dataUrlSize(make(1000))).toBeLessThanOrEqual(1003);
        const url = encodeUnder(encode, MAX, Q);
        expect(url && dataUrlSize(url)).toBeLessThanOrEqual(MAX);
        expect(tried).toEqual([0.88, 0.8, 0.72, 0.64]); // stops at the first that fits
        // nothing fits: null, every step tried
        tried.length = 0;
        expect(encodeUnder((q) => { tried.push(q); return make(900_000); }, MAX, Q)).toBeNull();
        expect(tried).toEqual([...Q]);
        // control: the loop it replaced handed back the last attempt however large
        const old = (enc: (q: number) => string): string => { let u = ''; for (const q of Q) { u = enc(q); if ((u.length - 23) * 0.75 <= MAX) break; } return u; };
        expect(dataUrlSize(old(() => make(900_000)))).toBeGreaterThan(MAX);
        // the boundary is the old comparison's: exactly the limit fits, one byte over does not
        expect(encodeUnder(() => make(300_000), 300_000, [0.9])).not.toBeNull();
        expect(encodeUnder(() => make(300_003), 300_000, [0.9])).toBeNull();
    });
});

// ------------------------------------------------------------------ copying

/** A fake page for copyText: the Clipboard API (or none), and the scratch elements it made. */
function clipEnv(o: { api: 'ok' | 'refused' | 'none'; execOk: boolean; scratch?: 'textarea' | 'input' }): { env: ClipboardEnv; copied: string[]; made: { value: string; removed: boolean }[]; attached: () => number } {
    const copied: string[] = [];
    const made: { value: string; removed: boolean; attached: boolean }[] = [];
    const env: ClipboardEnv = {
        clipboard: o.api === 'none' ? undefined : { writeText: async (t: string) => { if (o.api === 'refused') throw new Error('denied'); copied.push(t); } },
        document: {
            activeElement: null,
            body: { append: (n: Node) => { (n as unknown as { attached: boolean }).attached = true; } },
            // an <input> strips line breaks from its value, as browsers do (the old fallback)
            createElement: () => {
                let v = '';
                const el = {
                    removed: false, attached: false, readOnly: false, style: { cssText: '' },
                    get value() { return v; },
                    set value(x: string) { v = o.scratch === 'input' ? x.replace(/[\r\n]/g, '') : x; },
                    setAttribute() {}, select() {},
                    remove() { el.removed = true; el.attached = false; }
                };
                made.push(el);
                return el as unknown as HTMLTextAreaElement;
            },
            execCommand: () => {
                const live = made.find((m) => m.attached);
                if (o.execOk && live) copied.push(live.value);
                return o.execOk && !!live;
            }
        }
    };
    return { env, copied, made, attached: () => made.filter((m) => m.attached).length };
}

describe('copying the caption and the link (review R4)', () => {
    const CAPTION = 'Fly it\n\nhttps://gsfpv.flyreelstudio.eu/s/x\n\n#fpv';

    it('the Clipboard API first; refused, a scratch text area copies it with its line breaks and is gone after', async () => {
        const a = clipEnv({ api: 'ok', execOk: true });
        expect(await copyText(CAPTION, a.env)).toBe(true);
        expect([a.copied, a.made.length]).toEqual([[CAPTION], 0]);
        for (const api of ['refused', 'none'] as const) {
            const b = clipEnv({ api, execOk: true });
            expect(await copyText(CAPTION, b.env), api).toBe(true);
            expect(b.copied).toEqual([CAPTION]);
            expect(b.made.every((m) => m.removed) && b.attached() === 0).toBe(true);
        }
        expect(await copyText(CAPTION, clipEnv({ api: 'refused', execOk: false }).env)).toBe(false);
    });

    it('control: an <input> as the scratch (the link field before R4) loses the caption\'s line breaks', async () => {
        const c = clipEnv({ api: 'refused', execOk: true, scratch: 'input' });
        await copyText(CAPTION, c.env);
        expect(c.copied[0]).not.toBe(CAPTION);
    });
});

// ------------------------------------------------------------------ recording on every scan

const CATALOGUE = { title: 'Wroclaw Market Square', author: 'Owner Scans', license: 'CC BY 4.0' };
const NOT_IN_CATALOGUE: SceneCredit = creditFacts('cafe0001', undefined, { title: 'Old Mill', author: 'Jane Scan', license: 'CC BY-SA' });
const PASTED: SceneCredit = creditFacts('beef0002', undefined, {});

describe('recording works on every scan (the owner\'s item 2, D36)', () => {
    afterEach(() => vi.unstubAllGlobals());

    const recordingFor = (c: SceneCredit) => new Recording({
        prefs: mkStore(), canvas: {} as HTMLCanvasElement, scene: () => ({ id: c.id, credit: videoCredit(c) }), autoRespawn: () => true
    });

    it('a browser that can encode video records a scan outside the catalogue and a pasted one', () => {
        for (const g of ['VideoEncoder', 'VideoFrame', 'OffscreenCanvas']) vi.stubGlobal(g, class {});
        expect(recordingFor(NOT_IN_CATALOGUE).allowed).toBe(true);
        expect(recordingFor(PASTED).allowed).toBe(true);
        // without WebCodecs nothing records, whatever the scan
        vi.unstubAllGlobals();
        expect(recordingFor(NOT_IN_CATALOGUE).allowed).toBe(false);
    });

    it('the burned-in credit names the scan, its author and licence, ShramkoGSFPV and the site; a pasted scan its SuperSplat page', () => {
        expect(videoCredit(creditFacts('ab12cd34', CATALOGUE))).toBe('Wroclaw Market Square — Owner Scans, CC BY 4.0 · ShramkoGSFPV · gsfpv.flyreelstudio.eu');
        expect(videoCredit(NOT_IN_CATALOGUE)).toBe('Old Mill — Jane Scan, CC BY-SA · ShramkoGSFPV · gsfpv.flyreelstudio.eu');
        expect(videoCredit(PASTED)).toBe('superspl.at/scene/beef0002 · ShramkoGSFPV · gsfpv.flyreelstudio.eu');
        expect(creditText(creditFacts('beef0003', undefined, { title: 'Barn' }))).toBe('Barn — superspl.at/scene/beef0003');
        // the catalogue's facts win over what a listing showed
        expect(creditFacts('ab12cd34', CATALOGUE, { author: 'someone else' }).author).toBe('Owner Scans');
    });

    it('the author notice: once per scan outside the catalogue, never after "Don\'t show again", never for the catalogue', () => {
        const shown = new Set<string>();
        const first = authorNotice(NOT_IN_CATALOGUE, { enabled: true, shownFor: shown });
        expect(first).toEqual({ key: 'rec.notice', vars: { author: 'Jane Scan', license: 'CC BY-SA' } });
        shown.add(NOT_IN_CATALOGUE.id);
        expect(authorNotice(NOT_IN_CATALOGUE, { enabled: true, shownFor: shown })).toBeNull();
        expect(authorNotice(PASTED, { enabled: true, shownFor: shown })).toEqual({ key: 'rec.notice.unknown', vars: {} });
        expect(authorNotice(creditFacts('x1', undefined, { author: 'A' }), { enabled: true, shownFor: shown })).toEqual({ key: 'rec.notice.author', vars: { author: 'A' } });
        expect(authorNotice(PASTED, { enabled: false, shownFor: new Set() })).toBeNull();
        expect(authorNotice(creditFacts('ab12cd34', CATALOGUE), { enabled: true, shownFor: new Set() })).toBeNull();
        // the setting it reads is a real one, on by default
        expect(mkStore().get('recording.authorNotice')).toBe(true);
    });

    it('control: a notice that ignores what it showed comes back on every recording', () => {
        const forgetful = (c: SceneCredit) => authorNotice(c, { enabled: true, shownFor: new Set() });
        const shown = new Set([NOT_IN_CATALOGUE.id]);
        expect(forgetful(NOT_IN_CATALOGUE)).not.toBeNull();
        expect(authorNotice(NOT_IN_CATALOGUE, { enabled: true, shownFor: shown })).toBeNull();
    });
});

// ------------------------------------------------------------------ crosshair

describe('crosshair: the settings become the mark over the view', () => {
    const svgFor = (set: Record<string, unknown>): string | null => {
        const store = mkStore();
        for (const [k, v] of Object.entries(set)) store.set(k, v);
        return crosshairSvg(crosshairSpec((id) => store.get(id)));
    };
    const count = (s: string | null, tag: string): number => (s ? s.split(`<${tag} `).length - 1 : 0);

    it('off by default: nothing is drawn', () => {
        expect(mkStore().get('crosshair.shape')).toBe('off');
        expect(svgFor({})).toBeNull();
    });

    it('each shape draws its own parts (a halo under each), in the chosen colour and opacity', () => {
        const cross = svgFor({ 'crosshair.shape': 'cross', 'crosshair.color': 'cyan', 'crosshair.opacity': 0.5 });
        expect(cross).toContain('data-shape="cross"');
        expect([count(cross, 'line'), count(cross, 'circle')]).toEqual([8, 0]);
        expect(cross).toContain(`stroke="${CROSSHAIR_CSS.cyan}"`);
        expect(cross).toContain('opacity="0.5"');
        const dot = svgFor({ 'crosshair.shape': 'dot' });
        expect([count(dot, 'line'), count(dot, 'circle')]).toEqual([0, 2]);
        expect(dot).toContain(`fill="${CROSSHAIR_CSS.green}"`);
        expect([count(svgFor({ 'crosshair.shape': 'circle' }), 'circle'), count(svgFor({ 'crosshair.shape': 'ringDot' }), 'circle')]).toEqual([2, 4]);
        // a black mark gets a light halo, every other colour a dark one
        expect(svgFor({ 'crosshair.shape': 'dot', 'crosshair.color': 'black' })).toContain('rgba(255,255,255,0.7)');
    });

    it('the size follows the setting, clamped like the store clamps it', () => {
        const store = mkStore();
        store.set('crosshair.size', 9);
        expect(crosshairSpec((id) => store.get(id)).sizePct).toBe(9);
        expect(crosshairSpec((id) => (id === 'crosshair.size' ? 400 : id === 'crosshair.shape' ? 'dot' : undefined)).sizePct).toBe(20);
        expect(crosshairSpec(() => 'nonsense').shape).toBe('off');
    });

    it('control: a builder that ignores the shape draws the same mark for every shape', () => {
        const broken = (spec: CrosshairSpec) => crosshairSvg({ ...spec, shape: 'dot' });
        const spec = crosshairSpec((id) => (id === 'crosshair.shape' ? 'cross' : undefined));
        expect(broken(spec)).not.toBe(crosshairSvg(spec));
        expect(count(broken(spec), 'line')).toBe(0);
    });

    it('cinema mode and the clean view hide it; control: the stylesheet without that rule', () => {
        const css = readFileSync(join(FLY, 'app', 'builtin', 'crosshair.css'), 'utf8');
        const hides = (s: string) => /body\.cinema \.crosshair[^{]*\{\s*display:\s*none/.test(s);
        expect(hides(css)).toBe(true);
        expect(css).toMatch(/body\.clean \.crosshair/);
        expect(hides(css.replace(/body\.cinema \.crosshair, /, ''))).toBe(false);
    });
});

// ------------------------------------------------------------------ motor sound

/** A fake AudioContext: every node, connection and param target it was asked for. */
class FakeParam {
    value = 0;
    targets: number[] = [];
    setTargetAtTime(v: number): void { this.targets.push(v); }
}
class FakeNode {
    to: FakeNode[] = [];
    started = false;
    stopped = false;
    constructor(readonly kind: string) {}
    connect(n: FakeNode): void { this.to.push(n); }
    disconnect(): void { this.to = []; }
    start(): void { this.started = true; }
    stop(): void { this.stopped = true; }
}
class FakeAudio {
    currentTime = 0;
    sampleRate = 8000;
    state = 'suspended';
    destination = new FakeNode('destination');
    nodes: (FakeNode & Record<string, unknown>)[] = [];
    private add<T extends FakeNode>(n: T): T { this.nodes.push(n as FakeNode & Record<string, unknown>); return n; }
    createGain() { return this.add(Object.assign(new FakeNode('gain'), { gain: new FakeParam() })); }
    createOscillator() { return this.add(Object.assign(new FakeNode('osc'), { frequency: new FakeParam(), wave: null as unknown, setPeriodicWave(w: unknown) { this.wave = w; } })); }
    createBiquadFilter() { return this.add(Object.assign(new FakeNode('filter'), { type: '', frequency: new FakeParam(), Q: new FakeParam() })); }
    createBuffer(_c: number, len: number) { const d = new Float32Array(len); return { getChannelData: () => d }; }
    createBufferSource() { return this.add(Object.assign(new FakeNode('noise'), { buffer: null as unknown, loop: false })); }
    createPeriodicWave(real: Float32Array, imag: Float32Array) { return { real, imag }; }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
}

/** Pavo20 Pro at hover: 7200 KV x 0.75 loaded -> 565.5 rad/s per volt, a 3S pack at 11.4 V. */
const HOVER: MotorState = { motors: [0.45, 0.47, 0.44, 0.46], volt: 11.4, omegaMaxPerVolt: 7200 * 0.75 * 0.10471975511965977, armed: true, crashed: false, speed: 3 };
const FLYING: MixInput = { state: HOVER, paused: false, hidden: false, enabled: true, volume: 40 };

describe('motor sound: from the simulated motors, silent whenever the flight is not', () => {
    it('heard only while armed, flying, shown and on; silence when paused, crashed, disarmed, hidden, off, at volume 0', () => {
        expect(motorMix(FLYING).master).toBeCloseTo(Math.pow(0.4, 1.5) * MASTER_MAX, 9);
        const silent: [string, MixInput][] = [
            ['paused (a menu, a panel)', { ...FLYING, paused: true }],
            ['crashed', { ...FLYING, state: { ...HOVER, crashed: true } }],
            ['disarmed', { ...FLYING, state: { ...HOVER, armed: false } }],
            ['tab hidden', { ...FLYING, hidden: true }],
            ['sound.motors off', { ...FLYING, enabled: false }],
            ['volume 0', { ...FLYING, volume: 0 }],
            ['no flight model yet', { ...FLYING, state: null }]
        ];
        for (const [why, i] of silent) {
            expect(motorMix(i).master, why).toBe(0);
            expect(audible(i), why).toBe(false);
        }
    });

    it('control: the same silence check finds sound in the flight itself (it is not always true)', () => {
        expect(motorMix(FLYING).master).toBeGreaterThan(0);
        expect(audible(FLYING)).toBe(true);
    });

    it('each voice sits at its rotor\'s turning frequency; faster motor, higher note; the model is only read', () => {
        const m = motorMix(FLYING);
        expect(m.voices.map((v) => Math.round(v.freq))).toEqual(HOVER.motors.map((x) => Math.round(rotorHz(x, HOVER))));
        expect(rotorHz(0.5, HOVER)).toBeCloseTo((0.5 * HOVER.omegaMaxPerVolt * 11.4) / (2 * Math.PI), 9);
        expect(m.voices[1].freq).toBeGreaterThan(m.voices[0].freq);
        expect(m.voices[1].gain).toBeGreaterThan(m.voices[2].gain);
        // more throttle: louder wash, higher band
        const full = motorMix({ ...FLYING, state: { ...HOVER, motors: [1, 1, 1, 1] } });
        expect(full.wash.gain).toBeGreaterThan(m.wash.gain);
        expect(full.wash.freq).toBeGreaterThan(m.wash.freq);
        const frozen = Object.freeze({ ...HOVER, motors: Object.freeze([...HOVER.motors]) });
        expect(() => motorMix({ ...FLYING, state: frozen })).not.toThrow();
        // full throttle at full volume stays under clipping
        const loud = motorMix({ ...FLYING, volume: 100, state: { ...HOVER, motors: [1, 1, 1, 1], speed: 30 } });
        expect(loud.master * (loud.voices.reduce((a, v) => a + v.gain, 0) + loud.wash.gain)).toBeLessThan(1.05);
    });

    it('the prop\'s blades make the strongest harmonic', () => {
        expect([bladesOf('Gemfan 2218, 3-blade'), bladesOf('Gemfan 45 mm 4-blade'), bladesOf('31 mm class'), bladesOf(undefined)]).toEqual([3, 4, 3, 3]);
        const h = voiceHarmonics(3);
        expect(Array.from(h).indexOf(Math.max(...h))).toBe(3);
    });

    it('the graph: four voices and the wash into the master, started silent; it glides to a mix and closes for good', async () => {
        const ac = new FakeAudio();
        const s = new MotorSound(ac as unknown as AudioLike, 3);
        const oscs = ac.nodes.filter((n) => n.kind === 'osc');
        const master = ac.nodes.find((n) => n.to.includes(ac.destination))!;
        expect(oscs).toHaveLength(4);
        expect(oscs.every((o) => o.started && o.wave)).toBe(true);
        expect(ac.nodes.filter((n) => n.kind === 'noise' && n.started)).toHaveLength(1);
        expect((master.gain as FakeParam).value).toBe(0);
        s.apply(motorMix(FLYING));
        expect((master.gain as FakeParam).targets.at(-1)).toBeGreaterThan(0);
        // the pause menu opens: the master goes to 0
        s.apply(motorMix({ ...FLYING, paused: true }));
        expect((master.gain as FakeParam).targets.at(-1)).toBe(0);
        await s.resume();
        expect(ac.state).toBe('running');
        await s.close();
        expect(ac.state).toBe('closed');
        expect(oscs.every((o) => o.stopped)).toBe(true);
        expect(s.closed).toBe(true);
        const n = (master.gain as FakeParam).targets.length;
        s.apply(motorMix(FLYING));
        expect((master.gain as FakeParam).targets.length).toBe(n);
    });

    it('the settings are real: on by default, quiet at 15 % (v0.8, the owner: not loud by default)', () => {
        const store = mkStore();
        expect([store.get('sound.motors'), store.get('sound.volume')]).toEqual([true, 15]);
    });
});

// ------------------------------------------------------------------ texts and keys

/** The fly dictionary in English as the page merges it (the flat file, then every namespace). */
function enDict(): Record<string, string> {
    const dir = join(REPO, 'packages', 'i18n', 'locales', 'fly');
    const d = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')) as Record<string, string>;
    for (const ns of readdirSync(dir)) if (statSync(join(dir, ns)).isDirectory()) Object.assign(d, JSON.parse(readFileSync(join(dir, ns, 'en.json'), 'utf8')));
    return d;
}

/** Keys named as t('literal') in a source that are not in the dictionary. */
function unknownKeys(src: string, dict: Record<string, string>): string[] {
    return [...src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]).filter((k) => !(k in dict));
}

describe('every text the new code names exists', () => {
    const FILES = ['share/panel.ts', 'app/builtin/share.ts', 'app/builtin/cinema.ts', 'app/builtin/sound.ts', 'app/builtin/crosshair.ts', 'ui/scenes.ts', 'ui/scenes-superspl.ts', 'ui/crash-overlay.ts', 'ui/osd-stats.ts'];

    it('in the English dictionaries, also the keys built at run time (words per kind, the notices)', () => {
        const d = enDict();
        for (const f of FILES) expect(unknownKeys(readFileSync(join(FLY, f), 'utf8'), d), f).toEqual([]);
        for (const e of SHARE_ENTRIES) expect(d[wordsKey(kindOf(e))], e).toContain('{scene}');
        expect(d['share.text.crash']).toContain('{speed}');
        for (const k of ['rec.notice', 'rec.notice.author', 'rec.notice.unknown']) expect(d[k], k).toBeTruthy();
    });

    it('the Polish notice refers to "nagranie" (neuter) as "je", in all three variants (review R6)', () => {
        const pl = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'rec', 'pl.json'), 'utf8')) as Record<string, string>;
        const masculine = (s: string): boolean => /\bjak go\b/.test(s);
        for (const k of ['rec.notice', 'rec.notice.author', 'rec.notice.unknown']) {
            expect(masculine(pl[k]), k).toBe(false);
            expect(pl[k], k).toContain('jak je wykorzystasz');
        }
        // control: the wording before the fix is caught
        expect(masculine('Nagranie jest Twoje, podobnie jak odpowiedzialnosc za to, jak go uzyjesz')).toBe(true);
    });

    it('control: a planted unknown key is reported', () => {
        expect(unknownKeys("t('share.button'); t('share.nope')", enDict())).toEqual(['share.nope']);
    });
});

describe('L shares, and nothing else is bound to it', () => {
    it('in flight and over a crash', () => {
        for (const state of ['flight', 'crash'] as const) expect(actionFor({ code: 'KeyL', shiftKey: false }, state)).toBe('share.open');
        expect(keymapProblems(KEYMAP)).toEqual([]);
    });

    it('control: a second action on L is a conflict the keymap check reports', () => {
        const planted = [...KEYMAP, { action: 'test.l', keys: [{ code: 'KeyL', cap: 'L', aria: 'L' }], when: 'flight' as const, labelKey: 'keys.test.l', status: 'shipped' as const }];
        expect(keymapProblems(planted)).toEqual(['KeyL is bound to share.open and test.l (always / flight)']);
    });
});

// ------------------------------------------------------------------ the top edge

describe('the longer top row prints over nothing', () => {
    // measured in Chrome (evidence/2026-10-13/d1-ui): at 1280 px the row starts at 868 px, with the
    // REC dot at 783 px; the walls box ("Scan without walls: ...") is 370 px wide, centred
    const BADGE = 370;
    const v06Under = (viewW: number): boolean => viewW <= 640; // fly.css before v0.7: a phone only

    it('the walls box goes under the row wherever the two would meet', () => {
        expect(boxMeetsRow(1280, BADGE, 868)).toBe(false);
        expect(boxMeetsRow(1280, BADGE, 783)).toBe(true); // recording
        expect(boxMeetsRow(1024, BADGE, 612)).toBe(true);
        expect(boxMeetsRow(1280, BADGE, 640 + BADGE / 2 + TOP_GAP)).toBe(false); // exactly the gap apart
        expect(boxMeetsRow(1280, 0, 300)).toBe(false); // hidden while flying
    });

    /** The walls box, centred at the top unless moved under the row, overlaps the row's first button (measured boxes). */
    const textOverButtons = (viewW: number, rowLeft: number, under: boolean): boolean => {
        const box: Box = { left: viewW / 2 - BADGE / 2, right: viewW / 2 + BADGE / 2, top: 38, bottom: 72 };
        const row: Box = { left: rowLeft, right: viewW - 16, top: 38, bottom: 78 };
        return !under && box.right + TOP_GAP > row.left && box.left < row.right && box.top < row.bottom && row.top < box.bottom;
    };

    it('the check: no text over the buttons with the real rule, recording at 1280 px and at 1024 px', () => {
        for (const [viewW, rowLeft] of [[1280, 868], [1280, 783], [1024, 612]]) expect(textOverButtons(viewW, rowLeft, boxMeetsRow(viewW, BADGE, rowLeft)), `${viewW}/${rowLeft}`).toBe(false);
    });

    it('control: v0.6\'s fixed 640 px breakpoint leaves the walls text over the REC dot at 1280 px and over Share at 1024 px', () => {
        expect(textOverButtons(1280, 783, v06Under(1280))).toBe(true);
        expect(textOverButtons(1024, 612, v06Under(1024))).toBe(true);
    });

    it('fly.css moves the box under the row when crowded and the notice sits under the box; control: without the rules', () => {
        const fly = readFileSync(join(FLY, 'fly.css'), 'utf8');
        const cinema = readFileSync(join(FLY, 'app', 'builtin', 'cinema.css'), 'utf8');
        const under = (s: string) => /#ui\.top-crowded > \.bake-box \{ top: calc\(var\(--top-row-bottom/.test(s);
        const noticeUnderBox = (s: string) => /\.rec-notice \{[^}]*top: max\([^}]*var\(--bake-bottom/.test(s);
        expect(under(fly)).toBe(true);
        expect(noticeUnderBox(cinema)).toBe(true);
        expect(under(fly.replace('#ui.top-crowded > .bake-box', '#ui.top-crowded > .nothing'))).toBe(false);
        expect(noticeUnderBox(cinema.replace(/top: max\([^;]*;/, 'top: 84px;'))).toBe(false);
    });

    it('on a phone the mode chip goes under the row of buttons, past the hint', () => {
        // 390 px: buttons 25..374 x 38..78, the pad hint 16..374 x 88..104; chip 75 x 36 under the OSD line (38)
        const row: Box = { left: 25, right: 374, top: 38, bottom: 78 };
        const hint: Box = { left: 16, right: 374, top: 88, bottom: 104 };
        const y = gutterTop(16, 38, 75, 36, [row], [hint], 390);
        expect(y).toBeGreaterThanOrEqual(row.bottom + 4);
        expect(y).toBeGreaterThanOrEqual(hint.bottom);
        const meets = (b: Box, top: number) => Math.min(16 + 75, b.right) > Math.max(16, b.left) && Math.min(top + 36, b.bottom) > Math.max(top, b.top);
        expect(meets(row, y) || meets(hint, y)).toBe(false);
    });

    it('control: the old search (soft boxes only) leaves the chip under the buttons', () => {
        const row: Box = { left: 25, right: 374, top: 38, bottom: 78 };
        const old = gutterTop(16, 38, 75, 36, [], [{ left: 16, right: 374, top: 88, bottom: 104 }], 390);
        expect(old).toBe(38);
        expect(Math.min(38 + 36, row.bottom) > Math.max(old, row.top)).toBe(true);
    });
});

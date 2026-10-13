"""Scene pages (apps/api/scenepages.py): rendered from the published catalogue into templates shaped like the
site build's (written here; the real ones are checked too when apps/site/out/scene-templates exists), with
hostile titles as the negative controls of the escaping. No network. Every check has a negative control."""
from __future__ import annotations

import html
import http.client
import json
import re
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
import scenepages as sp  # noqa: E402
import server  # noqa: E402
from templating import Template  # noqa: E402

REPO = HERE.parents[3]
LOCALES = REPO / "packages" / "i18n" / "locales"
BUILT = REPO / "apps" / "site" / "out" / "scene-templates"
ORIGIN = "https://gsfpv.example"
HOSTILE = '"><img src=x onerror=alert(1)></title><script>alert(2)</script>{{head}}[[#faq]]'

SCENE_T = """<!doctype html><html lang="{{lang}}"><head>{{{head}}}<link rel="stylesheet" href="/s.css"></head><body>
<nav><a href="{{homeHref}}">h</a><a href="{{indexHref}}">i</a><a href="/en/scenes/{{path}}">en</a></nav>
<h1>{{h1}}</h1><p>{{lede}}</p><p>{{kindLabel}}[[?place]] {{place}}[[/place]]</p>
<img src="{{poster}}" alt="{{posterAlt}}"><a id="fly" href="{{flyHref}}">fly</a><a href="{{originUrl}}">ss</a>
<p id="summary">{{summary}}</p><dl>[[#facts]]<dt>{{k}}</dt><dd>{{v}}</dd>[[/facts]]</dl>
[[?about]]<p id="about">{{about}}</p>[[/about]][[?quote]]<blockquote>{{quote}}</blockquote><cite>{{quoteBy}}</cite>[[/quote]]
[[?tags]]<ul>[[#tags]]<li>{{tag}}</li>[[/tags]]</ul>[[/tags]]
[[#faq]]<details><summary>{{q}}</summary><p>{{a}}</p></details>[[/faq]]
[[#share]]<a data-share="{{id}}" href="{{href}}">{{label}}</a>[[/share]]
<p id="credit"><a href="{{originUrl}}">{{name}}</a> [[?authorUrl]]<a href="{{authorUrl}}">{{authorName}}</a>[[/authorUrl]][[^authorUrl]]{{authorName}}[[/authorUrl]]
[[?licenseUrl]]<a href="{{licenseUrl}}">{{license}}</a>[[/licenseUrl]][[^licenseUrl]]{{license}}[[/licenseUrl]]</p>
[[#more]]<a class="more" href="{{href}}"><img src="{{poster}}">{{title}} {{meta}}[[?walls]] W[[/walls]]</a>[[/more]]
<p>{{updated}}</p><script type="application/ld+json">{{{jsonld}}}</script></body></html>"""
INDEX_T = """<!doctype html><html lang="{{lang}}"><head>{{{head}}}</head><body><a href="{{homeHref}}">h</a>
<a href="/pl/scenes/{{path}}">pl</a><h1>{{h1}}</h1><p>{{lede}} {{count}} {{updated}}</p>
[[?cards]]<ul>[[#cards]]<li><a href="{{href}}"><img src="{{poster}}">{{title}}</a> {{kindLabel}} {{place}} {{authorName}}
[[?walls]]{{wallsLabel}}[[/walls]]<a class="fly" href="{{flyHref}}">fly</a></li>[[/cards]]</ul>[[/cards]][[^cards]]empty[[/cards]]
<script type="application/ld+json">{{{jsonld}}}</script></body></html>"""

SCENES = [
    {"id": "70b50d42", "title": "Wroclaw Cathedral", "author": "Andrii Shramko", "license": "CC BY 4.0", "kind": "exterior", "collision": False,
     "version": 1, "sizeMb": 1783.9, "format": "ssog", "geo": {"lat": 51.114, "lon": 17.046, "place": "Wroclaw, Poland"},
     "wind": {"fromDeg": 270, "speed": 4.5, "gust": 2, "source": "climate"}, "render": {"budgetM": 8, "stochastic": True},
     "about": {"en": "Fly between the two towers.", "pl": "Lec miedzy wiezami."},
     "origin": {"url": "https://superspl.at/scene/70b50d42", "description": "Explore the historic streets around the cathedral. "
                "https://gsfpv.flyreelstudio.eu/en/ " + "Long text " * 40, "tags": ["Wroclaw", "church"], "created": "2026-09-30T10:00:00Z",
                "user": "andriishramko"}},
    {"id": "39e63ce9", "title": "Modlinek Villa", "author": "Andrii Shramko", "license": "CC BY 4.0", "kind": "interior", "collision": True,
     "voxelCm": 5, "extentM": [25.3, 10.0, 17.7], "scale": 2},
    {"id": "aaaaaa01", "title": "Hidden one", "author": "x", "license": "", "kind": "other", "collision": True, "hidden": True},
]
# b11e45d1 in the real catalogue: SuperSplat names no author for it
ANON = {"id": "b11e45d1", "title": "yamato koriyama castle", "author": "", "license": "", "kind": "exterior", "collision": True,
        "origin": {"url": "https://superspl.at/scene/b11e45d1", "description": "The castle walls and the moat at dusk, from the air."}}
USER_ONLY = {"id": "b11e45d2", "title": "Castle by user", "author": "", "license": "", "kind": "exterior", "collision": True,
             "origin": {"url": "https://superspl.at/scene/b11e45d2", "user": "castle_fan"}}


def catalog(scenes=None, published="2026-10-13T08:00:00Z"):
    body = json.dumps({"v": 1, "published": published, "collections": [], "scenes": scenes if scenes is not None else SCENES}).encode()
    return lambda: (body, '"' + str(hash(body)) + '"')


def write_templates(d: Path, scene: str = SCENE_T, index: str = INDEX_T) -> None:
    d.mkdir(parents=True, exist_ok=True)
    for lang in sp.LANGS:
        (d / f"scene.{lang}.html").write_text(scene, encoding="utf-8")
        (d / f"index.{lang}.html").write_text(index, encoding="utf-8")
        shutil.copy(LOCALES / "scenepage" / f"{lang}.json", d / f"phrases.{lang}.json")
    shutil.copy(LOCALES / "share.json", d / "share.json")
    (d / "drones.json").write_text(json.dumps({"default": "pavo20pro-3s", "names": {l: {"pavo20pro-3s": "Pavo20 Pro class"} for l in sp.LANGS}}), encoding="utf-8")
    (d / "manifest.json").write_text(json.dumps({"v": 1, "built": "test"}), encoding="utf-8")


def jsonld(body: str) -> dict:
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', body, re.S)
    return json.loads(m.group(1))


class Pages(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name) / "scene-templates"
        write_templates(self.dir)
        self.store = sp.TemplateStore(lambda: self.dir)
        self.pages = sp.ScenePages(catalog(), self.store, ORIGIN)

    def tearDown(self):
        self.tmp.cleanup()

    def get(self, path: str, pages=None):
        st, body, hdrs = (pages or self.pages).handle(path)
        return st, body.decode("utf-8"), dict(hdrs)

    def test_scene_page(self):
        st, body, h = self.get("/en/scenes/70b50d42/")
        self.assertEqual(st, 200)
        self.assertIn("script-src 'none'", h["Content-Security-Policy"])
        self.assertIn('<link rel="canonical" href="https://gsfpv.example/en/scenes/70b50d42/">', body)
        self.assertEqual(len(re.findall(r'hreflang="(en|es|pl|ru|x-default)"', body)), 5)
        self.assertIn('content="https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/70b50d42/v1/xl.webp"', body)
        self.assertIn("<h1>FPV drone flight: Wroclaw Cathedral</h1>", body)
        self.assertIn('href="/en/fly/?scene=70b50d42&amp;budget=8&amp;stochastic"', body)
        self.assertIn("no collision file yet", body)
        self.assertIn("from the west, 4.5 m/s", body)
        self.assertIn('<p id="about">Fly between the two towers.</p>', body)
        self.assertIn('href="https://superspl.at/user/andriishramko"', body)
        self.assertIn('href="https://creativecommons.org/licenses/by/4.0/"', body)
        self.assertIn("30 September 2026", body)
        # the share links carry this page's address, percent-encoded
        self.assertIn("https%3A%2F%2Fgsfpv.example%2Fen%2Fscenes%2F70b50d42%2F", body)
        # SuperSplat's description: a short quote, its link removed; never in the summary
        quote = re.search(r"<blockquote>(.*?)</blockquote>", body).group(1)
        self.assertLessEqual(len(quote), sp.QUOTE_MAX)
        self.assertNotIn("http", quote)
        self.assertNotIn("Explore the historic", re.search(r'<p id="summary">(.*?)</p>', body).group(1))
        ld = jsonld(body)["@graph"]
        scan = next(x for x in ld if x["@type"] == "CreativeWork")
        self.assertEqual(scan["isBasedOn"], "https://superspl.at/scene/70b50d42")
        self.assertEqual(scan["author"]["name"], "Andrii Shramko")
        self.assertEqual(scan["license"], "https://creativecommons.org/licenses/by/4.0/")
        self.assertEqual(scan["contentLocation"]["geo"], {"@type": "GeoCoordinates", "latitude": 51.114, "longitude": 17.046})
        self.assertEqual(scan["keywords"], "Wroclaw, church")
        faq = next(x for x in ld if x["@type"] == "FAQPage")["mainEntity"]
        self.assertEqual(len(faq), len(re.findall("<details>", body)))
        crumbs = next(x for x in ld if x["@type"] == "BreadcrumbList")["itemListElement"]
        self.assertEqual([c["name"] for c in crumbs], ["Home", "Places to fly", "Wroclaw Cathedral"])
        # the other published scene is offered, the hidden one never
        self.assertIn('href="/en/scenes/39e63ce9/"', body)
        self.assertNotIn("aaaaaa01", body)

    def test_walls_voxels_scale_and_languages(self):
        st, body, _ = self.get("/pl/scenes/39e63ce9/")
        self.assertIn("o boku 5 cm", body)
        self.assertIn("25,3 × 10 × 17,7 m", body)
        self.assertIn("×10", body)  # a 25 m scan: the "make it bigger" idea
        self.assertIn("×2", body)  # the curator's scale
        self.assertIn('<html lang="pl">', body)
        st, ru, _ = self.get("/ru/scenes/70b50d42/")
        ph = json.loads((LOCALES / "scenepage" / "ru.json").read_text(encoding="utf-8"))["gen"]
        self.assertIn(ph["windFrom"][6], ru)  # from the west, in Russian
        self.assertIn(ph["h1"].format(name="Wroclaw Cathedral"), ru)
        st, pl, _ = self.get("/pl/scenes/70b50d42/")
        self.assertIn("Lec miedzy wiezami.", pl)  # the curator's words in that language
        # control: the curator wrote no Spanish: the English words stand in
        self.assertIn("Fly between the two towers.", self.get("/es/scenes/70b50d42/")[1])

    def test_hostile_title_and_author_stay_text(self):
        evil = [{**SCENES[0], "title": HOSTILE, "author": "<b>Mallory</b>", "origin": {**SCENES[0]["origin"], "tags": ["</li><script>x</script>"],
                                                                                      "description": "<script>alert(3)</script> quoted"}}]
        pages = sp.ScenePages(catalog(evil), self.store, ORIGIN)
        st, body, _ = self.get("/en/scenes/70b50d42/", pages)
        self.assertEqual(st, 200)
        markup = re.sub(r'<script type="application/ld\+json">.*?</script>', "", body, flags=re.S)
        for bad in ("<img src=x", "<script>", "<b>Mallory", "</li><script>"):
            self.assertNotIn(bad, markup, bad)
        self.assertNotIn("</script><script>", body)
        self.assertEqual(body.count("<details>"), body.count("</details>"))  # [[#faq]] in a title did not open a block
        # the JSON-LD still holds the exact title, as data
        self.assertEqual(next(x for x in jsonld(body)["@graph"] if x["@type"] == "CreativeWork")["name"], HOSTILE)
        # control: the same page with the title slot raw would carry the payload as markup
        raw = Template("<h1>{{{h1}}}</h1>", raw={"h1"}).render(pages.scene_context(json.loads(catalog(evil)()[0]), "70b50d42", "en", self.store.get()[0]))
        self.assertIn("<script>alert(2)</script>", raw)

    def test_index_sitemap_llms(self):
        st, body, _ = self.get("/es/scenes/")
        self.assertEqual(st, 200)
        self.assertEqual(re.findall(r'<a href="(/es/scenes/[0-9a-f]+/)">', body), ["/es/scenes/70b50d42/", "/es/scenes/39e63ce9/"])
        self.assertNotIn("Hidden one", body)
        self.assertEqual(jsonld(body)["@graph"][0]["mainEntity"]["numberOfItems"], 2)
        st, xml, h = self.get("/scenes/sitemap.xml")
        self.assertEqual(h["Content-Type"], "application/xml; charset=utf-8")
        self.assertEqual(xml.count("<url>"), 3 * 4)
        self.assertIn("<loc>https://gsfpv.example/ru/scenes/39e63ce9/</loc><lastmod>2026-10-13T08:00:00Z</lastmod>", xml)
        self.assertNotIn("aaaaaa01", xml)
        st, txt, _ = self.get("/scenes/llms.txt")
        self.assertIn("- [Wroclaw Cathedral](https://gsfpv.example/en/scenes/70b50d42/): outdoor, Wroclaw, Poland, no walls yet, by Andrii Shramko, CC BY 4.0", txt)
        self.assertNotIn("Hidden", txt)

    def test_status_codes(self):
        self.assertEqual(self.get("/en/scenes/aaaaaa01/")[0], 404)  # hidden
        self.assertEqual(self.get("/en/scenes/ffffffff/")[0], 404)  # unknown
        self.assertEqual(self.pages.handle("/en/scenes/70b50d42")[0], 301)
        self.assertIsNone(self.pages.handle("/de/scenes/"))
        self.assertIsNone(self.pages.handle("/en/scenes/../x/"))
        st, _b, h = self.pages.handle("/en/scenes/70b50d42/")
        self.assertEqual(self.pages.handle("/en/scenes/70b50d42/", dict(h)["ETag"])[0], 304)
        self.assertEqual(self.pages.handle("/en/scenes/70b50d42/", '"other"')[0], 200)  # control
        empty = sp.ScenePages(lambda: None, self.store, ORIGIN)
        self.assertEqual(empty.handle("/en/scenes/")[0], 404)

    def test_templates_missing_or_refused(self):
        none = sp.ScenePages(catalog(), sp.TemplateStore(lambda: Path(self.tmp.name) / "nothing"), ORIGIN)
        self.assertEqual(none.handle("/en/scenes/")[0], 503)
        # a new release whose template uses an unknown slot is refused; the last good one keeps serving
        self.assertEqual(self.get("/en/scenes/")[0], 200)
        write_templates(self.dir, scene=SCENE_T.replace("{{h1}}", "{{h1}}{{secretField}}"))
        self.assertEqual(self.get("/en/scenes/39e63ce9/")[0], 200)
        self.assertIn("unknown slots", self.store.error)
        fresh = sp.TemplateStore(lambda: self.dir)
        self.assertIsNone(fresh.get()[0])
        # a template missing a required slot is refused too
        write_templates(self.dir, scene=SCENE_T.replace('{{{jsonld}}}', ""))
        self.assertIsNone(sp.TemplateStore(lambda: self.dir).get()[0])
        # control: the good templates load
        write_templates(self.dir)
        self.assertIsNotNone(sp.TemplateStore(lambda: self.dir).get()[0])

    def test_a_scene_without_an_author_is_credited_to_no_one(self):
        """The credited name is the author's, else the SuperSplat user's, else empty: never a placeholder."""
        pages = sp.ScenePages(catalog(SCENES + [ANON, USER_ONLY]), self.store, ORIGIN)
        doc, tset = pages._doc()[0], self.store.get()[0]
        names = {sid: (pages.scene_context(doc, sid, "en", tset)["authorName"], pages.scene_context(doc, sid, "en", tset)["quoteBy"])
                 for sid in (ANON["id"], USER_ONLY["id"], "70b50d42")}
        self.assertEqual(names[ANON["id"]], ("", ""))
        self.assertEqual(names[USER_ONLY["id"]], ("castle_fan", "castle_fan"))
        cards = {c["href"].split("/")[3]: c["authorName"] for c in pages.index_context(doc, "en", tset)["cards"]}
        self.assertEqual((cards[ANON["id"]], cards[USER_ONLY["id"]]), ("", "castle_fan"))
        # control: a scene with an author is credited to the author, in the page and on its card
        self.assertEqual(names["70b50d42"], ("Andrii Shramko", "Andrii Shramko"))
        self.assertEqual(cards["70b50d42"], "Andrii Shramko")

    @unittest.skipUnless((BUILT / "manifest.json").is_file(), "the site build's templates are not there (pnpm --filter @gsfpv/site build)")
    def test_the_site_build_reads_well_without_an_author(self):
        """No "by -", no "by ·", no dangling separator, no quote line starting with a comma; with an author all of it is there."""
        pages = sp.ScenePages(catalog(SCENES + [ANON]), sp.TemplateStore(lambda: BUILT), ORIGIN)
        plain = lambda h: html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h)))
        text = lambda path: plain(self.get(path, pages)[1])
        for lang in sp.LANGS:
            ui = json.loads((LOCALES / "scenepage" / f"{lang}.json").read_text(encoding="utf-8"))["ui"]
            anon, authored = text(f"/{lang}/scenes/{ANON['id']}/"), text(f"/{lang}/scenes/70b50d42/")
            by = ui["creditBy"]
            for bad in (f"{by} -", f"{by} ·", "· ·", f" , {ui['quoteSource']}"):
                self.assertNotIn(bad, anon, f"{lang}: {bad!r}")
            self.assertIn(f"{ui['creditScan']} {ANON['title']} · ", anon, lang)
            self.assertIn(ui["quoteSourceAlone"], anon, lang)
            # control: the authored scene keeps "by <author>" and "<author>, from the description"
            self.assertIn(f"{by} Andrii Shramko ·", authored, lang)
            self.assertIn(f"Andrii Shramko, {ui['quoteSource']}", authored, lang)
            index = self.get(f"/{lang}/scenes/", pages)[1]
            card = lambda sid: plain(index.split(f'/{lang}/scenes/{sid}/"', 1)[1].split("</li>", 1)[0])
            self.assertNotIn(f"· {ui['wallsYes']}", card(ANON["id"]), lang)
            self.assertIn(f"Andrii Shramko · {ui['wallsNo']}", card("70b50d42"), lang)

    @unittest.skipUnless((BUILT / "manifest.json").is_file(), "the site build's templates are not there (pnpm --filter @gsfpv/site build)")
    def test_the_site_build_templates(self):
        pages = sp.ScenePages(catalog(), sp.TemplateStore(lambda: BUILT), ORIGIN)
        for lang in sp.LANGS:
            for path in (f"/{lang}/scenes/", f"/{lang}/scenes/70b50d42/", f"/{lang}/scenes/39e63ce9/"):
                st, body, _ = self.get(path, pages)
                self.assertEqual(st, 200, path)
                self.assertNotIn("{{", body, path)
                self.assertNotIn("[[", body, path)
                self.assertEqual(re.findall(r"<script(?![^>]*application/ld\+json)", body), [], path)
                jsonld(body)

    @unittest.skipUnless((BUILT / "manifest.json").is_file(), "the site build's templates are not there (pnpm --filter @gsfpv/site build)")
    def test_the_credit_line_reads_well_without_a_licence(self):
        """The credit names the licence ("licence CC BY 4.0"), or says none is stated, never "licence no licence stated"."""
        unlicensed = [dict(s, license="") if s["id"] == "70b50d42" else s for s in SCENES]
        bare = sp.ScenePages(catalog(unlicensed), sp.TemplateStore(lambda: BUILT), ORIGIN)
        licensed = sp.ScenePages(catalog(), sp.TemplateStore(lambda: BUILT), ORIGIN)
        for lang in sp.LANGS:
            ph = json.loads((LOCALES / "scenepage" / f"{lang}.json").read_text(encoding="utf-8"))
            label, none = ph["ui"]["creditLicence"], ph["gen"]["licenseNone"]
            text = lambda pages: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", self.get(f"/{lang}/scenes/70b50d42/", pages)[1]))
            plain = text(bare)
            self.assertIn(none, plain, lang)
            self.assertNotIn(f"{label} {none}", plain, lang)
            # control: with a known licence the label stands in front of it
            self.assertIn(f"{label} CC BY 4.0", text(licensed), lang)


class Http(unittest.TestCase):
    """The routes through server.Handler: the page, HEAD, the wind route's 404."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name) / "t"
        write_templates(d)
        self.saved = (server.SCENE_PAGES, server.WIND)
        server.SCENE_PAGES = sp.ScenePages(catalog(), sp.TemplateStore(lambda: d), ORIGIN)
        import wind
        server.WIND = wind.WindService(lambda *a: (500, {}, b""), lambda: Path(self.tmp.name), server.SCENE_PAGES.scene)
        self.api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.api.serve_forever, daemon=True).start()

    def tearDown(self):
        self.api.shutdown()
        self.api.server_close()
        server.SCENE_PAGES, server.WIND = self.saved
        self.tmp.cleanup()

    def req(self, method: str, path: str):
        c = http.client.HTTPConnection("127.0.0.1", self.api.server_address[1], timeout=20)
        c.request(method, path, headers={"X-Forwarded-For": "203.0.113.9"})
        r = c.getresponse()
        out = r.status, {k.lower(): v for k, v in r.getheaders()}, r.read()
        c.close()
        return out

    def test_routes(self):
        st, h, body = self.req("GET", "/ru/scenes/39e63ce9/")
        self.assertEqual(st, 200)
        self.assertIn("script-src 'none'", h["content-security-policy"])
        st, h, body = self.req("HEAD", "/ru/scenes/39e63ce9/")
        self.assertEqual((st, body), (200, b""))
        self.assertEqual(self.req("GET", "/api/wind/39e63ce9?mode=now")[0], 404)  # no geo
        self.assertEqual(self.req("GET", "/api/wind/70b50d42?mode=now")[0], 503)  # geo, the fake upstream fails
        self.assertEqual(self.req("GET", "/en/scenes/aaaaaa01/")[0], 404)
        self.assertEqual(self.req("GET", "/scenes/sitemap.xml")[0], 200)
        self.assertEqual(self.req("GET", "/api/nothing")[0], 404)  # control: other paths are untouched


if __name__ == "__main__":
    unittest.main()

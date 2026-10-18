"""Scene pages for search and answer engines (owner's item 5 of message 18; docs/wip/v07-a.md section 4):

GET /{lang}/scenes/            every published, not hidden scene of the catalogue, as cards (lang en es pl ru)
GET /{lang}/scenes/<id>/       one scene: our title, a facts paragraph generated from the catalogue's data,
                               the curator's own words (about), SuperSplat's description only as a short
                               credited quote, keywords, a generated FAQ, "Fly this scene", share links,
                               the credit and licence line; canonical, hreflang, Open Graph, Twitter, JSON-LD
GET /scenes/sitemap.xml        the scene pages (lastmod = the catalogue's publish time), named in robots.txt
GET /scenes/llms.txt           the same list for answer engines, one line per scene

The design is the site's: the site build renders the templates (apps/site/src/app/scene-template/) and
writes them with the phrase dictionaries to <release>/scene-templates/ (scripts/scene-templates.mjs);
this module reads them from the live release (TEMPLATES_DIR) and only fills data into the slots named
in scene-slots.json (templating.py escapes every value). The pages run no script: CSP script-src 'none'.
Anything that comes from a stranger (titles, descriptions, author names) is escaped, never trusted.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import threading
import time
import urllib.parse
from collections import OrderedDict
from pathlib import Path
from typing import Callable

import licences
from templating import Template, TemplateError, esc, json_for_script

LANGS = ("en", "es", "pl", "ru")
OG_LOCALE = {"en": "en_US", "es": "es_ES", "pl": "pl_PL", "ru": "ru_RU"}
KINDS = ("scene", "index")
SLOTS = json.loads((Path(__file__).resolve().parent / "scene-slots.json").read_text(encoding="utf-8"))
RAW = frozenset(SLOTS["raw"])
CSP = ("default-src 'none'; script-src 'none'; img-src 'self' https://s3-eu-west-1.amazonaws.com https://d28zzqy0iyovbz.cloudfront.net; "
       "style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
POSTERS = "https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat"
MORE_CARDS = 6
QUOTE_MAX = 200
PAGE_CACHE = 256

_ID_RE = re.compile(r"[0-9a-f]{6,32}")
_THUMB_RE = re.compile(r"https://(s3-eu-west-1\.amazonaws\.com/images\.playcanvas\.com/splat|d28zzqy0iyovbz\.cloudfront\.net)/[0-9a-f]{6,32}/v[0-9]{1,6}/[a-z]{1,4}\.webp")
_ORIGIN_RE = re.compile(r"https://superspl\.at/[A-Za-z0-9/_?=&.-]{1,200}")
_USER_RE = re.compile(r"[A-Za-z0-9_.-]{1,40}")
_URL_IN_TEXT = re.compile(r"(https?://|www\.)\S+", re.I)
_PATH_RE = re.compile(r"/(en|es|pl|ru)/scenes(/([0-9a-f]{6,32}))?/?")

Response = tuple[int, bytes, list]


# ---------------- templates of the live release ----------------

class TemplateSet:
    """The templates, phrases, share targets and drone names of one release (one load of the directory)."""

    def __init__(self, d: Path):
        self.templates: dict[tuple[str, str], Template] = {}
        for kind in KINDS:
            spec = SLOTS["kinds"][kind]
            allowed, required = set(spec["names"]), set(spec["required"])
            for lang in LANGS:
                t = Template((d / f"{kind}.{lang}.html").read_text(encoding="utf-8"), RAW)
                if t.names - allowed:
                    raise TemplateError(f"{kind}.{lang}.html uses unknown slots {sorted(t.names - allowed)}")
                if required - t.names:
                    raise TemplateError(f"{kind}.{lang}.html misses slots {sorted(required - t.names)}")
                self.templates[(kind, lang)] = t
        books = {lang: json.loads((d / f"phrases.{lang}.json").read_text(encoding="utf-8")) for lang in LANGS}
        self.phrases = {lang: b["gen"] for lang, b in books.items()}  # the sentences this module composes
        self.ui = {lang: b["ui"] for lang, b in books.items()}  # the template's own words (breadcrumb names)
        self.share = json.loads((d / "share.json").read_text(encoding="utf-8"))["targets"]
        self.drones = json.loads((d / "drones.json").read_text(encoding="utf-8"))


class TemplateStore:
    """The live release's scene-templates/ directory; loaded again when its manifest changes (a new
    release flips the `current` link), the last good set kept when a new one does not load."""

    def __init__(self, directory: Callable[[], Path]):
        self.directory = directory
        self._key: tuple | None = None
        self._set: TemplateSet | None = None
        self.error = ""
        self._mu = threading.Lock()

    def get(self) -> tuple[TemplateSet | None, tuple | None]:
        d = self.directory()
        try:
            st = (d / "manifest.json").stat()
            key = (str((d / "manifest.json").resolve()), st.st_ino, st.st_mtime_ns, st.st_size)
        except OSError as e:
            self.error = f"no templates: {e.__class__.__name__}"
            return self._set, self._key
        with self._mu:
            if key != self._key:
                try:
                    self._set, self._key, self.error = TemplateSet(d), key, ""
                except (OSError, ValueError, KeyError, TypeError) as e:  # TemplateError is a ValueError
                    self.error = f"templates refused: {e}"[:300]
            return self._set, self._key


# ---------------- words and numbers ----------------

def fmt_num(x: float, ph: dict, decimals: int = 0) -> str:
    """1784.2 -> "1,784" (en) / "1 784" (pl); 0.25 -> "0,25" (es)."""
    s = f"{x:,.{decimals}f}" if decimals else f"{round(x):,}"
    if decimals:
        s = s.rstrip("0").rstrip(".") if "." in s else s
    num = ph.get("number") or {}
    return s.replace(",", "\x00").replace(".", num.get("decimal", ".")).replace("\x00", num.get("group", ","))


def fmt_date(iso: str | None, ph: dict) -> str:
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", iso or "")
    if not m or not 1 <= int(m.group(2)) <= 12:
        return ""
    return ph["date"].format(d=int(m.group(3)), month=ph["months"][int(m.group(2)) - 1], y=m.group(1))


def quote_of(description: str | None, title: str) -> str:
    """SuperSplat's description as a short quote: links removed, at most QUOTE_MAX characters cut at a word."""
    s = " ".join(_URL_IN_TEXT.sub(" ", description or "").split())
    if not s or s == title:
        return ""
    if len(s) <= QUOTE_MAX:
        return s
    cut = s[: QUOTE_MAX - 1]
    cut = cut[: cut.rfind(" ")] if " " in cut[40:] else cut
    return cut.rstrip(" ,;:.-") + "…"


def origin_user(s: dict) -> str | None:
    """The author's SuperSplat user name from the entry's origin, when it is a plain user name."""
    origin = s.get("origin") if isinstance(s.get("origin"), dict) else {}
    u = origin.get("user")
    return u if isinstance(u, str) and _USER_RE.fullmatch(u) else None


def credited(s: dict) -> str:
    """The name a scene is credited to: the author's, else their SuperSplat user name, else "" (the templates
    then leave out "by ..." and the separators around it; never a placeholder such as "-")."""
    return s.get("author") or origin_user(s) or ""


def poster(s: dict, size: str = "m") -> str:
    th = s.get("thumb")
    if isinstance(th, str) and _THUMB_RE.fullmatch(th):
        return th.rsplit("/", 1)[0] + f"/{size}.webp"
    v = s.get("version") if isinstance(s.get("version"), int) else 1
    return f"{POSTERS}/{s['id']}/v{v}/{size}.webp"


def fly_href(s: dict, lang: str) -> str:
    """The simulator's deep link of a scene page: the scene only. The owner's per-scene `render` (budget,
    stochastic) is NOT written into it (v0.9): the simulator applies the catalogue entry itself when the
    scene is in the published catalogue, and a link's own parameters outrank the pilot's Render setting,
    which the owner's entry must not (link > pilot's setting > owner's entry > device default)."""
    return f"/{lang}/fly/?" + urllib.parse.urlencode([("scene", s["id"])])


# ---------------- the pages ----------------

class ScenePages:
    """Renders the pages from the published catalogue (hidden scenes are never in it) and the templates."""

    def __init__(self, catalog: Callable[[], tuple[bytes, str] | None], templates: TemplateStore, origin: str):
        self.catalog, self.templates, self.origin = catalog, templates, origin.rstrip("/")
        self._parsed: tuple[str, dict] | None = None
        self._cache: OrderedDict[tuple, tuple[bytes, str]] = OrderedDict()
        self._mu = threading.Lock()

    def _doc(self) -> tuple[dict, str] | None:
        pub = self.catalog()
        if pub is None:
            return None
        body, etag = pub
        with self._mu:
            if self._parsed is None or self._parsed[0] != etag:
                doc = json.loads(body)
                doc["scenes"] = [s for s in doc.get("scenes") or [] if isinstance(s, dict) and _ID_RE.fullmatch(str(s.get("id")))
                                 and isinstance(s.get("title"), str) and not s.get("hidden")]
                self._parsed = (etag, doc)
            return self._parsed[1], etag

    def scene(self, sid: str) -> dict | None:
        """One published, not hidden scene of the catalogue (wind.py asks for its geo), else None."""
        got = self._doc()
        return next((s for s in got[0]["scenes"] if s["id"] == sid), None) if got else None

    # ---- routing ----
    def handle(self, path: str, if_none_match: str | None = None) -> Response | None:
        """The answer for a scene-page path, or None when the path is not one of ours."""
        if path == "/scenes/sitemap.xml":
            return self._simple(self.sitemap, "application/xml; charset=utf-8")
        if path == "/scenes/llms.txt":
            return self._simple(self.llms, "text/plain; charset=utf-8")
        m = _PATH_RE.fullmatch(path)
        if not m:
            return None
        lang, sid = m.group(1), m.group(3)
        if not path.endswith("/"):
            return 301, b"", [("Location", path + "/"), ("Cache-Control", "public, max-age=3600")]
        got = self._doc()
        tset, tkey = self.templates.get()
        if got is None or tset is None:
            return self._not_found(lang, 503 if tset is None else 404)
        doc, etag = got
        key = (etag, tkey, lang, sid)
        with self._mu:
            hit = self._cache.get(key)
        if hit is None:
            if sid is not None and not any(s["id"] == sid for s in doc["scenes"]):
                return self._not_found(lang, 404)
            html_doc = self.render_scene(doc, sid, lang, tset) if sid else self.render_index(doc, lang, tset)
            body = html_doc.encode("utf-8")
            hit = (body, '"' + hashlib.sha256(body).hexdigest()[:32] + '"')
            with self._mu:
                self._cache[key] = hit
                while len(self._cache) > PAGE_CACHE:
                    self._cache.popitem(last=False)
        body, page_etag = hit
        hdrs = [("Content-Type", "text/html; charset=utf-8"), ("Cache-Control", "public, max-age=300"), ("ETag", page_etag),
                ("Content-Security-Policy", CSP), ("Content-Language", lang)]
        if if_none_match and page_etag in [x.strip() for x in if_none_match.split(",")]:
            return 304, b"", hdrs
        return 200, body, hdrs

    def _simple(self, make: Callable[[dict], str], ctype: str) -> Response:
        got = self._doc()
        if got is None:
            return 404, b"", [("Content-Type", ctype), ("Cache-Control", "no-store")]
        return 200, make(got[0]).encode("utf-8"), [("Content-Type", ctype), ("Cache-Control", "public, max-age=3600")]

    def _not_found(self, lang: str, code: int) -> Response:
        body = (f'<!doctype html><html lang="{lang}"><meta charset="utf-8"><meta name="robots" content="noindex">'
                f'<title>ShramkoGSFPV</title><p><a href="/{lang}/scenes/">ShramkoGSFPV</a></p>\n').encode()
        return code, body, [("Content-Type", "text/html; charset=utf-8"), ("Cache-Control", "no-store"), ("Content-Security-Policy", CSP)]

    # ---- shared pieces ----
    def url(self, lang: str, sid: str | None = None) -> str:
        return f"{self.origin}/{lang}/scenes/" + (f"{sid}/" if sid else "")

    def head(self, lang: str, sid: str | None, title: str, desc: str, image: str, image_alt: str) -> str:
        """Title, description, canonical, hreflang, robots, Open Graph and Twitter tags, every value escaped."""
        url = self.url(lang, sid)
        tags = [f"<title>{esc(title)}</title>", f'<meta name="description" content="{esc(desc)}">',
                f'<link rel="canonical" href="{esc(url)}">']
        tags += [f'<link rel="alternate" hreflang="{l}" href="{esc(self.url(l, sid))}">' for l in LANGS]
        tags.append(f'<link rel="alternate" hreflang="x-default" href="{esc(self.url("en", sid))}">')
        tags.append('<meta name="robots" content="index, follow, max-image-preview:large">')
        og = [("og:type", "website"), ("og:site_name", "ShramkoGSFPV"), ("og:title", title), ("og:description", desc), ("og:url", url),
              ("og:image", image), ("og:image:alt", image_alt), ("og:locale", OG_LOCALE[lang])]
        og += [("og:locale:alternate", OG_LOCALE[l]) for l in LANGS if l != lang]
        tags += [f'<meta property="{k}" content="{esc(v)}">' for k, v in og]
        tw = [("twitter:card", "summary_large_image"), ("twitter:title", title), ("twitter:description", desc), ("twitter:image", image),
              ("twitter:image:alt", image_alt)]
        tags += [f'<meta name="{k}" content="{esc(v)}">' for k, v in tw]
        return "\n".join(tags)

    def share(self, tset: TemplateSet, url: str, text: str) -> list[dict]:
        enc = lambda s: urllib.parse.quote(s, safe="")  # noqa: E731
        out = []
        for t in tset.share:
            if isinstance(t, dict) and isinstance(t.get("href"), str) and t["href"].startswith("https://"):
                out.append({"id": str(t.get("id", "")), "label": str(t.get("label", "")),
                            "href": t["href"].replace("{url}", enc(url)).replace("{text}", enc(text)).replace("{title}", enc(text))})
        return out

    @staticmethod
    def kind_label(s: dict, ph: dict) -> str:
        return ph["kind"].get(s.get("kind"), ph["kind"]["other"])

    # ---- one scene ----
    def scene_context(self, doc: dict, sid: str, lang: str, tset: TemplateSet) -> dict:
        s = next(x for x in doc["scenes"] if x["id"] == sid)
        ph = tset.phrases[lang]
        name = s["title"]
        author = s.get("author") or ""
        origin = s.get("origin") if isinstance(s.get("origin"), dict) else {}
        origin_url = origin.get("url") if isinstance(origin.get("url"), str) and _ORIGIN_RE.fullmatch(origin["url"]) else f"https://superspl.at/scene/{sid}"
        user = origin_user(s)
        geo = s.get("geo") if isinstance(s.get("geo"), dict) else None
        place = (geo or {}).get("place") or ""
        walls = s.get("collision") is not False
        cm = s.get("voxelCm") if walls and isinstance(s.get("voxelCm"), (int, float)) else None
        cm_txt = fmt_num(cm, ph, 2) if cm else ""
        lic = s.get("license") or ""
        lic_url = licences.url_of(lic)
        created = fmt_date(origin.get("created"), ph)
        ext = s.get("extentM") if isinstance(s.get("extentM"), list) and len(s["extentM"]) == 3 else None
        wind = s.get("wind") if isinstance(s.get("wind"), dict) else None
        drone_id = s.get("defaultDrone") or tset.drones.get("default")
        drone = ((tset.drones.get("names") or {}).get(lang) or {}).get(drone_id) or drone_id or ""
        kind = self.kind_label(s, ph)

        sentences = [ph["sumKind"].get(s.get("kind"), ph["sumKind"]["other"])]
        if place:
            sentences.append(ph["sumPlace"].format(place=place))
        if author:
            sentences.append(ph["sumAuthorDate"].format(author=author, date=created) if created else ph["sumAuthor"].format(author=author))
        sentences.append((ph["sumWallsCm"].format(cm=cm_txt) if cm else ph["sumWalls"]) if walls else ph["sumNoWalls"])
        if ext:
            sentences.append(ph["sumExtent"].format(x=fmt_num(ext[0], ph, 1), y=fmt_num(ext[1], ph, 1), z=fmt_num(ext[2], ph, 1)))
            size = max(float(x) for x in ext)
            if size > 0:
                k = 10 if size < 40 else 0.25
                sentences.append(ph["sumScaleUp" if k > 1 else "sumScaleDown"].format(k=fmt_num(k, ph, 2), size=fmt_num(size * k, ph, 0 if size * k >= 10 else 1)))
        scale = s.get("scale")
        if isinstance(scale, (int, float)) and scale != 1:
            sentences.append(ph["sumDefaultScale"].format(scale=fmt_num(scale, ph, 2)))
        wind_txt = ""
        if wind and all(isinstance(wind.get(k), (int, float)) for k in ("fromDeg", "speed", "gust")):
            frm = ph["windFrom"][int(round(wind["fromDeg"] / 45.0)) % 8]
            wind_txt = ph["windClimate" if wind.get("source") == "climate" else "windManual"].format(
                **{"from": frm, "speed": fmt_num(wind["speed"], ph, 1), "gust": fmt_num(wind["gust"], ph, 1)})
            sentences.append(wind_txt)
        if drone:
            sentences.append(ph["sumDrone"].format(drone=drone))
        mb = s.get("sizeMb") if isinstance(s.get("sizeMb"), (int, float)) else None
        if mb:
            sentences.append(ph["sumSize"].format(mb=fmt_num(mb, ph, 0 if mb >= 10 else 1)))

        f = ph["facts"]
        facts = [{"k": f["kind"], "v": kind}]
        if place:
            facts.append({"k": f["place"], "v": place})
        if author:
            facts.append({"k": f["author"], "v": author})
        if created:
            facts.append({"k": f["published"], "v": created})
        facts.append({"k": f["walls"], "v": f["wallsYes"] if walls else f["wallsNo"]})
        if cm:
            facts.append({"k": f["voxels"], "v": f"{cm_txt} cm"})
        if ext:
            facts.append({"k": f["extent"], "v": " × ".join(fmt_num(x, ph, 1) for x in ext) + " m"})
        if mb:
            facts.append({"k": f["size"], "v": f"{fmt_num(mb, ph, 0 if mb >= 10 else 1)} MB"})
        if s.get("format"):
            facts.append({"k": f["format"], "v": str(s["format"])})
        if wind_txt:
            facts.append({"k": f["wind"], "v": wind_txt.split(": ", 1)[-1].rstrip(".")})
        if drone:
            facts.append({"k": f["drone"], "v": drone})
        facts.append({"k": f["license"], "v": lic or ph["licenseNone"]})
        facts.append({"k": f["id"], "v": sid})

        q = ph["faq"]
        faq = [{"q": q["flyQ"].format(name=name), "a": q["flyA"]},
               {"q": q["wallsQ"].format(name=name), "a": q["wallsYesA"].format(cm=q["wallsCm"].format(cm=cm_txt) if cm else "") if walls else q["wallsNoA"]}]
        if geo and isinstance(geo.get("lat"), (int, float)):
            faq.append({"q": q["whereQ"].format(name=name), "a": q["whereA"].format(place=place or name, lat=geo["lat"], lon=geo["lon"])})
        if author:
            faq.append({"q": q["whoQ"], "a": (q["whoLicenseA"].format(author=author, license=lic) if lic else q["whoNoLicenseA"].format(author=author))})
        if mb:
            faq.append({"q": q["sizeQ"], "a": q["sizeA"].format(mb=fmt_num(mb, ph, 0 if mb >= 10 else 1))})
        if wind_txt:
            faq.append({"q": q["windQ"], "a": wind_txt})
        faq.append({"q": q["scaleQ"], "a": q["scaleA"]})

        about = (s.get("about") or {}).get(lang) or (s.get("about") or {}).get("en") or ""
        quote = quote_of(origin.get("description"), name)
        tags = [{"tag": t} for t in origin.get("tags") or [] if isinstance(t, str) and t]
        page_url = self.url(lang, sid)
        title = ph["pageTitle"].format(name=name)
        desc = ph["metaDescription"].format(kind=kind, walls=ph["wallsShort"] if walls else ph["noWallsShort"])
        big = poster(s, "xl")
        others = [x for x in doc["scenes"] if x["id"] != sid][:MORE_CARDS]
        more = [{"href": self.url(lang, x["id"]).replace(self.origin, ""), "title": x["title"], "poster": poster(x, "m"),
                 "meta": " · ".join(v for v in (self.kind_label(x, ph), ((x.get("geo") or {}).get("place") or "")) if v),
                 "walls": x.get("collision") is not False} for x in others]
        summary = " ".join(sentences)
        ctx = {
            "lang": lang, "path": f"{sid}/", "name": name, "h1": ph["h1"].format(name=name), "lede": ph["lede"], "kindLabel": kind,
            "place": place, "poster": big, "posterAlt": name, "flyHref": fly_href(s, lang), "originUrl": origin_url, "summary": summary,
            "about": about, "quote": quote, "quoteBy": credited(s), "authorName": credited(s),
            "authorUrl": f"https://superspl.at/user/{user}" if user else "", "license": lic or ph["licenseNone"], "licenseUrl": lic_url or "",
            "updated": fmt_date(doc.get("published"), ph), "indexHref": f"/{lang}/scenes/", "homeHref": f"/{lang}/",
            "facts": facts, "tags": tags, "faq": faq, "share": self.share(tset, page_url, ph["shareText"].format(name=name)), "more": more,
        }
        ctx["head"] = self.head(lang, sid, title, desc, big, name)
        ctx["jsonld"] = self.scene_jsonld(s, ctx, lang, page_url, title, desc, origin, geo, tags, faq, lic_url, doc.get("published"), tset.ui[lang])
        return ctx

    def scene_jsonld(self, s: dict, ctx: dict, lang: str, url: str, title: str, desc: str, origin: dict, geo: dict | None,
                     tags: list, faq: list, lic_url: str | None, published: str | None, ui: dict) -> str:
        """WebPage + BreadcrumbList + CreativeWork (the scan: author, licence, isBasedOn, keywords, Place) + FAQPage."""
        scan: dict = {"@type": "CreativeWork", "@id": url + "#scan", "name": s["title"], "url": ctx["originUrl"], "isBasedOn": ctx["originUrl"],
                      "genre": "3D Gaussian splatting scan", "image": ctx["poster"], "thumbnailUrl": poster(s, "m")}
        if s.get("author"):
            scan["author"] = {"@type": "Person", "name": s["author"], **({"url": ctx["authorUrl"]} if ctx["authorUrl"] else {})}
        if lic_url:
            scan["license"] = lic_url
        elif s.get("license"):
            scan["license"] = s["license"]
        if isinstance(origin.get("created"), str):
            scan["dateCreated"] = origin["created"]
        if tags:
            scan["keywords"] = ", ".join(t["tag"] for t in tags)
        if geo and isinstance(geo.get("lat"), (int, float)):
            scan["contentLocation"] = {"@type": "Place", "name": geo.get("place") or s["title"],
                                       "geo": {"@type": "GeoCoordinates", "latitude": geo["lat"], "longitude": geo["lon"]}}
        crumbs = [(ui["crumbHome"], f"{self.origin}/{lang}/"), (ui["crumbScenes"], self.url(lang)), (s["title"], url)]
        graph = [
            {"@type": "WebPage", "@id": url + "#page", "url": url, "name": title, "description": desc, "inLanguage": lang,
             "isPartOf": {"@type": "WebSite", "@id": f"{self.origin}/#website", "name": "ShramkoGSFPV", "url": f"{self.origin}/"},
             "primaryImageOfPage": ctx["poster"], "about": {"@id": url + "#scan"}, "breadcrumb": {"@id": url + "#breadcrumbs"},
             **({"dateModified": published} if isinstance(published, str) else {})},
            {"@type": "BreadcrumbList", "@id": url + "#breadcrumbs", "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "name": n, "item": h}
                for i, (n, h) in enumerate(crumbs)]},
            scan,
            {"@type": "FAQPage", "@id": url + "#faq", "mainEntity": [
                {"@type": "Question", "name": x["q"], "acceptedAnswer": {"@type": "Answer", "text": x["a"]}} for x in faq]},
        ]
        return json_for_script(json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, separators=(",", ":")))

    def render_scene(self, doc: dict, sid: str, lang: str, tset: TemplateSet) -> str:
        return tset.templates[("scene", lang)].render(self.scene_context(doc, sid, lang, tset))

    # ---- the index ----
    def index_context(self, doc: dict, lang: str, tset: TemplateSet) -> dict:
        ph = tset.phrases[lang]
        scenes = doc["scenes"]
        count = str(len(scenes))
        cards = [{"href": f"/{lang}/scenes/{s['id']}/", "flyHref": fly_href(s, lang), "title": s["title"], "poster": poster(s, "m"),
                  "kindLabel": self.kind_label(s, ph), "place": (s.get("geo") or {}).get("place") or "",
                  "walls": s.get("collision") is not False, "authorName": credited(s)} for s in scenes]
        url = self.url(lang)
        title = ph["indexPageTitle"]
        desc = ph["indexDescription"].format(count=count)
        image = poster(scenes[0], "xl") if scenes else f"{self.origin}/og.jpg"
        ctx = {"lang": lang, "path": "", "h1": title.split(" · ")[0], "lede": ph["indexLede"].format(count=count), "count": count,
               "updated": fmt_date(doc.get("published"), ph), "homeHref": f"/{lang}/", "cards": cards}
        ctx["head"] = self.head(lang, None, title, desc, image, title)
        graph = [
            {"@type": "CollectionPage", "@id": url + "#page", "url": url, "name": title, "description": desc, "inLanguage": lang,
             "isPartOf": {"@type": "WebSite", "@id": f"{self.origin}/#website", "name": "ShramkoGSFPV", "url": f"{self.origin}/"},
             "mainEntity": {"@type": "ItemList", "numberOfItems": len(scenes), "itemListElement": [
                 {"@type": "ListItem", "position": i + 1, "url": self.url(lang, s["id"]), "name": s["title"]} for i, s in enumerate(scenes)]}},
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": tset.ui[lang]["crumbHome"], "item": f"{self.origin}/{lang}/"},
                {"@type": "ListItem", "position": 2, "name": tset.ui[lang]["crumbScenes"], "item": url}]},
        ]
        ctx["jsonld"] = json_for_script(json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, separators=(",", ":")))
        return ctx

    def render_index(self, doc: dict, lang: str, tset: TemplateSet) -> str:
        return tset.templates[("index", lang)].render(self.index_context(doc, lang, tset))

    # ---- machine-readable lists ----
    def sitemap(self, doc: dict) -> str:
        last = doc.get("published") if isinstance(doc.get("published"), str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T[\d:]+Z", doc["published"]) else None
        rows = []
        for sid in [None] + [s["id"] for s in doc["scenes"]]:
            for lang in LANGS:
                alts = "".join(f'<xhtml:link rel="alternate" hreflang="{l}" href="{esc(self.url(l, sid))}"/>' for l in LANGS)
                alts += f'<xhtml:link rel="alternate" hreflang="x-default" href="{esc(self.url("en", sid))}"/>'
                rows.append(f"<url><loc>{esc(self.url(lang, sid))}</loc>" + (f"<lastmod>{last}</lastmod>" if last else "") + alts + "</url>")
        return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
                'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + "\n".join(rows) + "\n</urlset>\n")

    def llms(self, doc: dict) -> str:
        lines = ["# ShramkoGSFPV scene pages", "",
                 "> Real places scanned in 3D (Gaussian splatting, published on SuperSplat) that fly in the free browser FPV drone "
                 "simulator ShramkoGSFPV. Each page has the scan's facts, its author and licence, and a link that opens it in the simulator. "
                 "Every page exists in English, Spanish, Polish and Russian (/en/, /es/, /pl/, /ru/).", "",
                 f"- [All places to fly]({self.url('en')}): the catalogue, {len(doc['scenes'])} scenes", ""]
        lines.append("## Scenes")
        for s in doc["scenes"]:
            bits = [{"interior": "interior", "exterior": "outdoor"}.get(s.get("kind"), "3D scan")]
            place = (s.get("geo") or {}).get("place")
            if place:
                bits.append(place)
            bits.append("walls (collision)" if s.get("collision") is not False else "no walls yet")
            if s.get("author"):
                bits.append(f"by {s['author']}")
            if s.get("license"):
                bits.append(s["license"])
            title = " ".join(str(s["title"]).replace("[", "(").replace("]", ")").split())
            lines.append(f"- [{title}]({self.url('en', s['id'])}): " + ", ".join(" ".join(str(b).split()) for b in bits))
        return "\n".join(lines) + "\n"

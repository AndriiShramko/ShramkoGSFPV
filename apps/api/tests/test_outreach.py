"""The admin's Outreach tab: the snapshot contract, the ceilings, the numbers worked out from it, the routes
and the agents' command (apps/api/outreach.py, outreach_cli.py).

The sample snapshot (fixtures/outreach-snapshot.sample.json) is the contract both sides are held to: the
vault's `fbgroups.py push` builds snapshots of this shape and must pass it, this side must accept it. When
the vault is here, its copy of the sample must be byte for byte the one in this repo, and the vault's
score_of() / due logic must agree with ours on a grid of inputs (the formula lives in two files; this makes
them one). Every refusal has a control that must fire: a refused snapshot leaves the previous one intact.

Run: python -m unittest discover -s apps/api/tests -v   (stdlib only; no network; nothing outside a temp dir)
"""
from __future__ import annotations

import copy
import importlib.util
import io
import json
import os
import secrets
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import admin  # noqa: E402
import outreach  # noqa: E402
import outreach_cli  # noqa: E402

SAMPLE = HERE / "fixtures" / "outreach-snapshot.sample.json"
GOLDEN = HERE / "fixtures" / "outreach-view.sample.json"  # what GET /api/admin/outreach answers for the sample at NOW + 3 h
PASSWORD = "t3st-" + secrets.token_urlsafe(12)
HASH = admin.make_hash(PASSWORD)
NOW = 1792227600.0  # 2026-10-17T09:00:00Z, the sample's `generated`
VAULT_ROOTS = (Path("U:/documents/Obsidian/AndriiShramko"), Path("C:/!AndriiShramko/invention/Claude/Vault"))


def sample() -> dict:
    return json.loads(SAMPLE.read_text(encoding="utf-8"))


def raw(doc: dict) -> bytes:
    return json.dumps(doc, ensure_ascii=False).encode("utf-8")


def make_group(i: int, **kw) -> dict:
    g = copy.deepcopy(sample()["groups"][1])
    g.update(id=f"g{i}", name=f"Group {i}", url=f"https://www.facebook.com/groups/g{i}/")
    g.update(kw)
    return g


def make_post(i: int, group: str, **kw) -> dict:
    p = copy.deepcopy(sample()["posts"][0])
    p.update(id=f"P-20261017-{i:02d}", group=group)
    p.update(kw)
    return p


def check(age_h, reactions=0, comments=0, shares=0, views=None, state="published", admin_action="none") -> dict:
    return {"age_h": age_h, "state": state, "reactions": reactions, "comments": comments, "shares": shares, "views": views, "admin_action": admin_action}


class Headers(dict):
    def get(self, k, default=None):
        return super().get(k, default)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.store = outreach.OutreachStore(lambda: self.dir, clock=lambda: NOW + 5)

    def tearDown(self):
        self.tmp.cleanup()

    def file(self) -> bytes:
        return (self.dir / outreach.FILE).read_bytes()


class Contract(Base):
    def test_the_sample_is_accepted_and_survives_unchanged(self):
        snap = outreach.parse(SAMPLE.read_bytes())
        self.assertEqual(snap, sample())  # every field of the contract kept, none added, none lost
        r = self.store.put(SAMPLE.read_bytes())
        self.assertEqual((r["groups"], r["posts"], r["campaign"], r["replaced_campaign"]), (2, 1, "gsfpv", None))
        doc = self.store.read()
        self.assertEqual({k: v for k, v in doc.items() if k != "received"}, sample())
        self.assertEqual(doc["received"], "2026-10-17T09:00:05Z")

    def test_the_golden_view_is_what_the_server_works_out(self):
        """The tab's TypeScript tests (tools/bench/test/admin-outreach.test.ts) parse this same file, so the server
        and the page cannot drift apart. After a deliberate change: UPDATE_GOLDEN=1 python -m unittest ... then review the diff."""
        self.store.put(SAMPLE.read_bytes())
        got = {"ok": True, "empty": False, "unreadable": False, **outreach.build_view(self.store.read(), NOW + 3 * 3600)}
        text = json.dumps(got, ensure_ascii=False, indent=1) + chr(10)
        if os.environ.get("UPDATE_GOLDEN"):
            GOLDEN.write_text(text, encoding="utf-8", newline=chr(10))
        self.assertEqual(json.loads(GOLDEN.read_text(encoding="utf-8")), json.loads(text))
        # control: a golden with one number changed is not equal
        changed = json.loads(text)
        changed["groups"][0]["score"] = 70.8
        self.assertNotEqual(json.loads(GOLDEN.read_text(encoding="utf-8")), changed)

    def test_control_a_field_off_the_contract_is_refused(self):
        for mutate in (lambda d: d["groups"][0].pop("fit"), lambda d: d["groups"][0].update(extra=1), lambda d: d["posts"][0]["checks"][0].pop("views"),
                       lambda d: d.update(extra=1), lambda d: d["meta"].pop("waves"), lambda d: d["groups"][0]["policy"].pop("links")):
            d = sample()
            mutate(d)
            with self.assertRaises(outreach.BadSnapshot):
                outreach.parse(raw(d))

    def test_the_vault_copy_of_the_sample_is_this_one(self):
        for root in VAULT_ROOTS:
            f = root / "01 - Projects" / "ShramkoGSFPV — продвижение в FB-группах" / "fixtures" / "outreach-snapshot.sample.json"
            if f.is_file():
                self.assertEqual(f.read_bytes().replace(b"\r\n", b"\n"), SAMPLE.read_bytes().replace(b"\r\n", b"\n"), "the sample drifted: copy the newer one to the other side")
                return
        self.skipTest("the vault is not on this machine")

    def test_view_of_the_sample(self):
        self.store.put(SAMPLE.read_bytes())
        v = outreach.build_view(self.store.read(), NOW + 3 * 3600)
        t = v["totals"]
        self.assertEqual((t["groups"], t["groups_known"], t["posted"], t["published"], t["removed"], t["posts"]), (2, 142, 1, 1, 0, 1))
        self.assertEqual((t["reactions"], t["comments"], t["shares"], t["views"]), (34, 9, 2, 1200))
        self.assertEqual([(f["stage"], f["n"]) for f in v["funnel"]], [("groups", 2), ("posted", 1), ("published", 1), ("removed", 0)])
        g1, g2 = v["groups"]
        # engagement 34 + 3*9 + 5*2 = 71 -> 50*1 + 30*min(1, 71/50) + 20*(1-0) = 100; the 70.8 inside the sample is only what was pushed
        self.assertEqual((g1["score"], g1["score_pushed"], g1["eng"], g1["worth"]), (100.0, 70.8, 71.0, True))
        self.assertEqual((g2["score"], g2["worth"], g2["eng"]), (None, False, 0.0))
        self.assertEqual(v["posts"][0]["eng"], 71.0)
        self.assertEqual(v["posts"][0]["topic"], "polish-drone")
        self.assertEqual(v["visits"]["total"], 18)
        self.assertEqual(v["slices"]["format_lang_topic"], [{"format": "video", "lang": "pl", "topic": "polish-drone", "n": 1, "published": 1, "removed": 0, "measured": 1,
                                                              "median_reactions": 34.0, "median_comments": 9.0, "median_eng": 71.0}])
        self.assertEqual([r["id"] for r in v["ranking"]], ["1647715522108395"])
        self.assertEqual(v["due"], {"checks": [], "unresolved": [], "ready": []})  # 24 h check taken, wave 3 group is not "ready"
        self.assertFalse(v["stale"])


class Ceilings(Base):
    """Each ceiling refuses the whole snapshot, and the stored one stays byte for byte as it was."""

    def setUp(self):
        super().setUp()
        self.store.put(SAMPLE.read_bytes())
        self.before = self.file()

    def refused(self, body: bytes, why: str | None = None) -> outreach.BadSnapshot:
        with self.assertRaises(outreach.BadSnapshot) as cm:
            self.store.put(body)
        self.assertEqual(self.file(), self.before, "the previous snapshot was touched")
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), [outreach.FILE], "a stray file is left behind")
        if why:
            self.assertIn(why, str(cm.exception))
        return cm.exception

    def test_over_256_kb(self):
        d = sample()
        d["groups"] = [make_group(i, note="x" * 200, name="n" * 200, url="https://www.facebook.com/groups/" + "u" * 160) for i in range(250)]
        d["posts"] = [make_post(i, "g1", angle="a" * 200, note="n" * 200, url="https://www.facebook.com/groups/g1/posts/" + "9" * 100,
                                checks=[check(h, 1, 1, 1, 100) for h in (1, 24, 72, 168, 720)]) for i in range(1, 600)]
        d["groups"][1]["id"] = "g1"
        body = raw(d)
        self.assertGreater(len(body), outreach.MAX_BYTES)
        self.refused(body, "ceiling")
        # control: the same snapshot trimmed under the ceiling is accepted
        d["posts"] = d["posts"][:50]
        d["groups"] = d["groups"][:100]
        self.assertLess(len(raw(d)), outreach.MAX_BYTES)
        self.store.put(raw(d))
        self.assertNotEqual(self.file(), self.before)

    def test_version_two(self):
        d = sample()
        d["v"] = 2
        self.refused(raw(d), "v must be 1")
        for bad in (True, 1.0, "1", None):
            d["v"] = bad
            self.refused(raw(d), "v must be 1")

    def test_duplicate_ids(self):
        d = sample()
        d["groups"].append(copy.deepcopy(d["groups"][0]))
        self.refused(raw(d), "listed twice")
        d = sample()
        d["posts"].append(copy.deepcopy(d["posts"][0]))
        self.refused(raw(d), "listed twice")

    def test_broken_json_and_not_an_object(self):
        for body in (b"{", b"", b"[]", b'"x"', b"null", b'{"v":1,', b"\xff\xfe\x00", b'{"v": NaN}'):
            self.refused(body)

    def test_nan_and_infinity_in_a_number(self):
        body = SAMPLE.read_bytes().replace(b'"score": 70.8', b'"score": NaN')
        self.assertIn(b"NaN", body)
        self.refused(body)

    def test_counts_and_lengths(self):
        d = sample()
        d["groups"] = [make_group(i) for i in range(outreach.MAX_GROUPS + 1)]
        d["posts"] = []
        self.assertLess(len(raw(d)), outreach.MAX_BYTES)
        self.refused(raw(d), "251 groups")
        d = sample()
        tiny = {"group": "1647715522108395", "group_name": "G", "kind": "post", "format": "video", "lang": None, "sent_at": "2026-10-17T08:10:00Z", "state": "sent",
                "url": None, "link_placement": None, "first_comment": "none", "angle": None, "checks": [], "note": None}
        d["posts"] = [{"id": f"P-{i}", **tiny} for i in range(outreach.MAX_POSTS + 1)]
        self.assertLess(len(raw(d)), outreach.MAX_BYTES)  # only the count is over
        self.refused(raw(d), "601 posts")
        d["posts"] = d["posts"][:outreach.MAX_POSTS]
        self.store.put(raw(d))  # control: exactly 600 is fine
        self.store.put(SAMPLE.read_bytes())
        self.before = self.file()
        d = sample()
        d["posts"][0]["checks"] = [check(h) for h in (1, 6, 24, 72, 168, 720, 800)]
        self.refused(raw(d), "at most 6")
        d = sample()
        d["groups"][0]["note"] = "x" * 201
        self.refused(raw(d), "201 characters")
        # control: exactly at the ceilings is fine
        d = sample()
        d["groups"][0]["note"] = "x" * 200
        d["posts"][0]["checks"] = [check(h) for h in (1, 6, 24, 72, 168, 720)]
        self.store.put(raw(d))

    def test_bad_values(self):
        cases = {
            "group id": lambda d: d["groups"][0].update(id="a b"),
            "group id long": lambda d: d["groups"][0].update(id="a" * 81),
            "unknown group": lambda d: d["posts"][0].update(group="nope"),
            "post state": lambda d: d["posts"][0].update(state="bogus"),
            "kind": lambda d: d["posts"][0].update(kind="reel"),
            "admin_action": lambda d: d["posts"][0]["checks"][0].update(admin_action="ban"),
            "first_comment": lambda d: d["posts"][0].update(first_comment="maybe"),
            "negative count": lambda d: d["posts"][0]["checks"][0].update(reactions=-1),
            "bool as count": lambda d: d["groups"][0].update(posts=True),
            "fit 6": lambda d: d["groups"][0].update(fit=6),
            "score 101": lambda d: d["groups"][0].update(score=101),
            "published+removed>posts": lambda d: d["groups"][0].update(removed=1),
            "time": lambda d: d["posts"][0].update(sent_at="2026-13-45T00:00:00Z"),
            "time no Z": lambda d: d.update(generated="2026-10-17T09:00:00"),
            "javascript url": lambda d: d["posts"][0].update(url="javascript:alert(1)"),
            "http url": lambda d: d["groups"][0].update(url="http://example.com/x"),
            "campaign": lambda d: d.update(campaign="GSFPV!"),
            "visits key": lambda d: d["visits"]["by_content"].update({"A B": 1}),
            "visits days": lambda d: d["visits"].update(days=36),
            "visits count": lambda d: d["visits"]["by_content"].update({"x": -1}),
            "meta": lambda d: d["meta"].update(groups_total="many"),
            "policy value": lambda d: d["groups"][0]["policy"].update(video="<script>"),
        }
        for name, mutate in cases.items():
            d = sample()
            mutate(d)
            with self.subTest(name):
                self.refused(raw(d))
        # control: visits may be null, and the 200-key ceiling is on the key count
        d = sample()
        d["visits"] = None
        self.store.put(raw(d))
        d["visits"] = {"days": 35, "by_content": {f"k{i}": i for i in range(200)}, "note": None}
        self.store.put(raw(d))
        d["visits"]["by_content"]["k200"] = 1
        before = self.file()
        with self.assertRaises(outreach.BadSnapshot):
            self.store.put(raw(d))
        self.assertEqual(self.file(), before)

    def test_text_is_cleaned_not_cut(self):
        d = sample()
        d["groups"][0]["name"] = "  Drony\n\tRC \u202e FPV\x00 "
        r = outreach.parse(raw(d))
        self.assertEqual(r["groups"][0]["name"], "Drony RC FPV")


class NoGrowth(Base):
    def test_many_pushes_leave_one_file(self):
        for i in range(30):
            d = sample()
            d["generated"] = f"2026-10-17T09:{i:02d}:00Z"
            d["posts"][0]["checks"].append(check(72 + i, i, i, i))
            d["posts"][0]["checks"] = d["posts"][0]["checks"][:6]
            self.store.put(raw(d))
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), [outreach.FILE])
        self.assertLess(len(self.file()), outreach.MAX_BYTES)
        self.assertEqual(self.store.read()["generated"], "2026-10-17T09:29:00Z")

    def test_clear_and_empty(self):
        self.assertEqual(self.store.read(), {})
        self.assertFalse(self.store.clear())
        self.store.put(SAMPLE.read_bytes())
        self.assertTrue(self.store.clear())
        self.assertEqual(list(self.dir.iterdir()), [])

    def test_another_campaign_replaces_and_says_so(self):
        self.store.put(SAMPLE.read_bytes())
        d = sample()
        d["campaign"] = "other"
        r = self.store.put(raw(d))
        self.assertEqual(r["replaced_campaign"], "gsfpv")
        self.assertEqual(self.store.read()["campaign"], "other")

    def test_a_failed_write_keeps_the_old_file(self):
        self.store.put(SAMPLE.read_bytes())
        before = self.file()
        orig = admin.write_durable

        def boom(path, data):
            path.with_name(path.name + ".tmp").write_bytes(data[:10])
            raise OSError(28, "No space left on device")
        admin.write_durable = boom
        try:
            with self.assertRaises(OSError):
                self.store.put(SAMPLE.read_bytes().replace(b"Drony RC", b"Drony XX"))
        finally:
            admin.write_durable = orig
        self.assertEqual(self.file(), before)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), [outreach.FILE])

    def test_a_damaged_file_is_unreadable_not_a_crash(self):
        self.store.put(SAMPLE.read_bytes())
        (self.dir / outreach.FILE).write_bytes(b'{"received": "x", "v": 1')
        with self.assertRaises(outreach.StoreUnreadable):
            self.store.read()
        self.store.put(SAMPLE.read_bytes())  # the next push restores it
        self.assertEqual(self.store.read()["campaign"], "gsfpv")


class Numbers(unittest.TestCase):
    def test_score_by_hand(self):
        s = outreach.score_of
        self.assertIsNone(s(0, 0, 0, [], False))
        self.assertEqual(s(1, 0, 0, [], True), 0.0)  # banned
        self.assertEqual(s(1, 1, 0, [], False), 70.0)  # published, nobody noticed: 50 + 0 + 20
        self.assertEqual(s(2, 1, 1, [25.0], False), 50.0)  # 25 + 15 + 10
        self.assertEqual(s(4, 3, 1, [10.0, 40.0], False), 67.5)  # 37.5 + 30*(25/50) + 15
        self.assertEqual(s(1, 0, 1, [], False), 0.0)  # removed, never published: 0 + 0 + 0
        self.assertEqual(s(1, 1, 0, [500.0], False), 100.0)  # engagement is capped at 50

    def test_engagement_needs_a_mature_latest_check(self):
        c = check
        self.assertIsNone(outreach.eng_of([]))
        self.assertIsNone(outreach.eng_of([c(1, 5, 5, 5)]))
        self.assertEqual(outreach.eng_of([c(1, 5, 5, 5), c(24, 10, 2, 1)]), 21.0)
        # the LATEST check counts, whatever order they arrive in
        self.assertEqual(outreach.eng_of([c(72, 20, 0, 0), c(24, 10, 2, 1)]), 20.0)
        self.assertIsNone(outreach.eng_of([c(23.9, 99, 99, 99)]))

    def test_the_vault_formula_and_due_logic_are_the_same(self):
        mod = None
        for root in VAULT_ROOTS:
            f = root / ".claude" / "skills" / "fb-groups" / "scripts" / "fbgroups.py"
            if f.is_file():
                spec = importlib.util.spec_from_file_location("fbgroups_ref", f)
                mod = importlib.util.module_from_spec(spec)
                sys.modules["fbgroups_ref"] = mod
                spec.loader.exec_module(mod)
                break
        if mod is None:
            self.skipTest("the vault is not on this machine")
        for posts in range(0, 6):
            for pub in range(0, posts + 1):
                for rem in range(0, posts - pub + 1):
                    for engs in ([], [0.0], [8.0, 30.0], [60.0], [49.9, 50.0]):
                        for banned in (False, True):
                            self.assertEqual(outreach.score_of(posts, pub, rem, engs, banned), mod.score_of(posts, pub, rem, engs, banned), (posts, pub, rem, engs, banned))
        self.assertEqual(outreach.CHECKPOINTS_H, mod.CHECKPOINTS_H)
        self.assertEqual((outreach.MAX_GROUPS, outreach.MAX_POSTS, outreach.MAX_CHECKS, outreach.MAX_STR, outreach.MAX_BYTES), (mod.SNAP_MAX_GROUPS, mod.SNAP_MAX_POSTS, mod.MAX_CHECKS, mod.SNAP_STR_MAX, mod.SNAP_MAX_BYTES))
        for i, cp in enumerate(outreach.CHECKPOINTS_H):
            for ages in ([], [1], [1, 24], [24], [70], [cp], [cp * 0.7], [cp * 0.8, 800], [100, 200]):
                self.assertEqual(outreach._covered(cp, i, ages), mod.covered(cp, i, ages), (cp, ages))
        for mine, theirs in ((outreach.POST_STATES, tuple(mod.POST_STATES)), (outreach.ADMIN_ACTIONS, tuple(mod.ADMIN_ACTIONS))):
            self.assertEqual(mine, theirs)
        self.assertEqual(set(outreach.POST_KINDS), set(mod.KINDS))
        self.assertEqual((outreach.GROUP_KEYS, outreach.POST_KEYS, outreach.CHECK_KEYS, outreach.TOP_KEYS), (tuple(mod.GROUP_KEYS), tuple(mod.POST_KEYS), tuple(mod.CHECK_KEYS), tuple(mod.TOP_KEYS)))

    def view_of(self, groups, posts, now=NOW) -> dict:
        d = sample()
        d["groups"], d["posts"] = groups, posts
        snap = outreach.validate(d)
        return outreach.build_view({"received": d["generated"], **snap}, now)

    def test_due_checkpoints(self):
        gid = "g1"
        g = make_group(1, posts=1, published=1, state="published", wave=1)
        sent = "2026-10-17T07:00:00Z"  # 2 h before NOW
        cases = [  # (hours after sending, checks taken, state, the checkpoint due)
            (2, [], "sent", 1), (2, [check(1)], "sent", None), (30, [check(1)], "published", 24), (30, [check(1), check(24)], "published", None),
            (100, [check(1), check(24)], "published", 72), (800, [check(1), check(24)], "published", 720), (800, [check(1), check(24), check(720)], "published", None),
            (30, [], "removed", None), (30, [], "failed", None), (0.5, [], "sent", None)]
        for hours, checks, state, want in cases:
            p = make_post(1, gid, sent_at=sent, state=state, checks=checks)
            now = outreach.parse_ts(sent).timestamp() + hours * 3600
            with self.subTest(hours=hours, state=state, n=len(checks)):
                v = self.view_of([g], [p], now)
                self.assertEqual([d["due_cp_h"] for d in v["due"]["checks"]], [] if want is None else [want])
                self.assertEqual(v["groups"][0]["due_n"], 0 if want is None else 1)

    def test_unresolved_and_ready(self):
        g1 = make_group(1, posts=1, published=0, state="sent", wave=1, verdict="post", fit=5)
        sent = "2026-10-17T06:00:00Z"
        p = make_post(1, "g1", sent_at=sent, state="sent", checks=[])
        ready = [make_group(2, wave=1, verdict="post", fit=3, members=10), make_group(3, wave=1, verdict="post_image", fit=5, members=5),
                 make_group(4, wave=1, verdict="skip"), make_group(5, wave=2, verdict="post"), make_group(6, wave=1, verdict="post", state="banned"),
                 make_group(7, wave=1, verdict="comment_only")]
        v = self.view_of([g1, *ready], [p], outreach.parse_ts(sent).timestamp() + 2 * 3600)
        self.assertEqual([x["post"] for x in v["due"]["unresolved"]], ["P-20261017-01"])
        self.assertEqual([x["id"] for x in v["due"]["ready"]], ["g3", "g2"])  # fit 5 before fit 3; not skip, wave 2, banned, comment_only

    def test_ranking_worth_and_slices(self):
        mature = lambda r, c, s: [check(1), check(24, r, c, s, 100)]  # noqa: E731
        gs = [make_group(1, posts=1, published=1, state="published", topic="sim", lang="en"),
              make_group(2, posts=1, published=1, state="published", topic="fpv-racing", lang="pl"),
              make_group(3, posts=2, published=1, removed=1, state="removed", topic="sim", lang="en"),
              make_group(4, posts=1, published=0, removed=0, state="banned", topic="local", lang="pl"),
              make_group(5, posts=1, published=1, state="published", topic="local", lang="pl")]
        ps = [make_post(1, "g1", format="video", lang="en", checks=mature(10, 2, 0)),      # eng 16
              make_post(2, "g2", format="image", lang="pl", checks=mature(60, 0, 0)),      # eng 60
              make_post(3, "g3", format="video", lang="en", checks=mature(2, 0, 0)),       # eng 2
              make_post(4, "g3", format="video", lang="en", state="removed", checks=[check(1)]),  # no mature check
              make_post(5, "g4", format="text", lang="pl", checks=mature(5, 5, 5)),        # banned group
              make_post(6, "g5", format="video", lang="pl", checks=[check(1, 3)])]         # only a 1 h check
        v = self.view_of(gs, ps)
        score = {g["id"]: g["score"] for g in v["groups"]}
        self.assertEqual(score["g1"], 79.6)   # 50 + 30*(16/50) + 20
        self.assertEqual(score["g2"], 100.0)  # engagement capped at 50
        self.assertEqual(score["g3"], 36.2)   # 50*(1/2) + 30*(2/50) + 20*(1-1/2)
        self.assertEqual(score["g4"], 0.0)
        self.assertEqual(score["g5"], 70.0)                                                  # eng 0: no mature check
        self.assertEqual([r["id"] for r in v["ranking"]], ["g2", "g1", "g5", "g3", "g4"])
        self.assertEqual({g["id"]: g["worth"] for g in v["groups"]}, {"g1": True, "g2": True, "g3": False, "g4": False, "g5": False})
        by_fmt = {r["format"]: r for r in v["slices"]["format"]}
        self.assertEqual((by_fmt["video"]["n"], by_fmt["video"]["measured"], by_fmt["video"]["median_eng"]), (4, 2, 9.0))  # median(16, 2)
        self.assertEqual((by_fmt["image"]["median_eng"], by_fmt["image"]["median_reactions"]), (60.0, 60.0))
        self.assertEqual((by_fmt["video"]["removed"], by_fmt["video"]["published"]), (1, 3))
        self.assertEqual([r["format"] for r in v["slices"]["format"]], ["image", "text", "video"])  # best median first
        topics = {r["topic"]: r["n"] for r in v["slices"]["topic"]}
        self.assertEqual(topics, {"sim": 3, "fpv-racing": 1, "local": 2})
        self.assertEqual(len(v["slices"]["format_lang_topic"]), 4)


class Routes(Base):
    def setUp(self):
        super().setUp()
        self.api = admin.AdminApi(data_dir=lambda: self.dir, reports_dir=lambda: self.dir / "r", seed=lambda: None, telegram=lambda t: None,
                                  env={"ADMIN_PASSWORD_HASH": HASH}, clock=lambda: NOW + 3 * 3600)
        outreach.OutreachAdmin(self.store, clock=lambda: NOW + 3 * 3600).register(self.api)
        st, body, hdrs = self.api.handle("POST", "/api/admin/login", Headers(), lambda n: json.dumps({"password": PASSWORD}).encode(), "1.2.3.4")
        self.assertEqual(st, 200)
        self.cookie = dict(hdrs)["Set-Cookie"].split(";")[0]
        self.csrf = json.loads(body)["csrf"]

    def get(self, path: str, qs: str = "", session: bool = True):
        return self.api.handle("GET", path, Headers({"Cookie": self.cookie}) if session else Headers(), lambda n: b"", "1.2.3.4", qs)

    def test_no_session_no_data(self):
        self.store.put(SAMPLE.read_bytes())
        for path, qs in (("/api/admin/outreach", ""), ("/api/admin/outreach/export.csv", "table=groups")):
            st, body, _h = self.get(path, qs, session=False)
            self.assertEqual(st, 401, path)
            self.assertNotIn(b"Drony", body)
            # control: with the session the same path answers
            self.assertEqual(self.get(path, qs)[0], 200, path)

    def test_empty_state(self):
        st, body, hdrs = self.get("/api/admin/outreach")
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(body), {"ok": True, "empty": True, "unreadable": False})
        self.assertIn(("Cache-Control", "no-store"), hdrs)
        self.assertEqual(self.get("/api/admin/outreach/export.csv", "table=groups")[0], 404)

    def test_unreadable_file_is_reported_not_a_500(self):
        (self.dir / outreach.FILE).write_bytes(b"{broken")
        st, body, _h = self.get("/api/admin/outreach")
        self.assertEqual((st, json.loads(body)), (200, {"ok": True, "empty": True, "unreadable": True}))

    def test_the_view(self):
        self.store.put(SAMPLE.read_bytes())
        st, body, hdrs = self.get("/api/admin/outreach")
        self.assertEqual(st, 200)
        self.assertEqual(dict(hdrs)["Content-Type"], "application/json")
        v = json.loads(body)
        self.assertEqual((v["ok"], v["empty"], v["campaign"], v["age_h"]), (True, False, "gsfpv", 3.0))
        self.assertEqual([g["id"] for g in v["groups"]], ["1647715522108395", "velocidronesim"])
        self.assertEqual(v["groups"][0]["score"], 100.0)

    def test_there_is_no_write_over_http(self):
        self.store.put(SAMPLE.read_bytes())
        before = self.file()
        for path in ("/api/admin/outreach", "/api/admin/outreach/push", "/api/admin/outreach/clear", "/api/admin/outreach/export.csv"):
            for method in ("POST", "PUT", "DELETE"):
                st, _b, _h = self.api.handle(method, path, Headers({"Cookie": self.cookie, "X-CSRF": self.csrf}), lambda n: SAMPLE.read_bytes(), "1.2.3.4")
                self.assertIn(st, (404,), (method, path))
        self.assertEqual(self.file(), before)

    def test_csv_groups_and_posts(self):
        d = sample()
        d["groups"][0]["name"] = '=HYPERLINK("http://x")'
        d["groups"][1]["name"] = "Zażółć, \"gęślą\" jaźń"
        d["posts"][0]["angle"] = "@cmd | +1"
        self.store.put(raw(d))
        st, body, hdrs = self.get("/api/admin/outreach/export.csv", "table=groups")
        h = dict(hdrs)
        self.assertEqual(st, 200)
        self.assertEqual(h["Content-Type"], "text/csv; charset=utf-8")
        self.assertRegex(h["Content-Disposition"], r'^attachment; filename="outreach-gsfpv-groups-2026-10-17\.csv"$')
        self.assertTrue(body.startswith(b"\xef\xbb\xbf"))
        text = body.decode("utf-8-sig")
        rows = list(__import__("csv").reader(io.StringIO(text)))
        self.assertEqual(rows[0][:4], ["id", "name", "url", "lang"])
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[1][1], "'" + '=HYPERLINK("http://x")')  # a spreadsheet would run it: made text
        self.assertEqual(rows[2][1], 'Zażółć, "gęślą" jaźń')          # quotes and Polish letters survive
        self.assertEqual(dict(zip(rows[0], rows[1]))["score"], "100.0")
        self.assertEqual(dict(zip(rows[0], rows[1]))["policy_links"], "comments_only")
        st, body, hdrs = self.get("/api/admin/outreach/export.csv", "table=posts")
        rows = list(__import__("csv").reader(io.StringIO(body.decode("utf-8-sig"))))
        rec = dict(zip(rows[0], rows[1]))
        self.assertEqual((rec["id"], rec["topic"], rec["reactions"], rec["eng"], rec["checks"]), ("P-20261017-01", "polish-drone", "34", "71.0", "1h 0/0/0; 24h 34/9/2 v1200"))
        self.assertEqual(rec["angle"], "'@cmd | +1")
        self.assertIn("posts-2026-10-17.csv", dict(hdrs)["Content-Disposition"])
        for bad in ("", "table=users", "table=../etc", "tables=groups"):
            self.assertEqual(self.get("/api/admin/outreach/export.csv", bad)[0], 400, bad)


class Cli(Base):
    def run_cli(self, argv, stdin: bytes = b""):
        out, err = io.StringIO(), io.StringIO()
        old = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = out, err
        try:
            code = outreach_cli.main(argv, data_dir=self.dir, stdin=io.BytesIO(stdin))
        finally:
            sys.stdout, sys.stderr = old
        return code, out.getvalue(), err.getvalue()

    def test_push_show_clear(self):
        code, out, _e = self.run_cli(["push", "-"], SAMPLE.read_bytes())
        self.assertEqual(code, 0)
        self.assertIn("accepted: 2 groups, 1 posts", out)
        code, out, _e = self.run_cli(["show"])
        self.assertEqual(code, 0)
        self.assertIn("campaign gsfpv", out)
        self.assertIn("100.0 * Drony RC FPV Polska", out)
        code, out, _e = self.run_cli(["show", "--json"])
        self.assertEqual(json.loads(out)["totals"]["posts"], 1)
        before = self.file()
        # a refused push: exit 1, the reasons on stderr, the old snapshot intact
        d = sample()
        d["v"] = 2
        code, out, err = self.run_cli(["push", "-"], raw(d))
        self.assertEqual(code, 1)
        self.assertIn("v must be 1", err)
        self.assertEqual(self.file(), before)
        code, _o, err = self.run_cli(["push", "-"], b"not json")
        self.assertEqual(code, 1)
        self.assertEqual(self.file(), before)
        self.assertEqual(self.run_cli(["clear"])[1].strip(), "cleared")
        self.assertEqual(self.run_cli(["clear"])[1].strip(), "nothing to clear")
        self.assertIn("nothing stored", self.run_cli(["show"])[1])

    def test_push_reads_at_most_one_byte_over_the_ceiling(self):
        code, _o, err = self.run_cli(["push", "-"], b" " * (outreach.MAX_BYTES * 3))
        self.assertEqual(code, 1)
        self.assertIn("ceiling", err)


class Wiring(unittest.TestCase):
    def test_the_server_serves_the_tab(self):
        import server  # noqa: PLC0415
        patterns = {p.pattern for m, p, _f in server.ADMIN._extra if m == "GET"}
        self.assertIn("outreach", patterns)
        self.assertIn(r"outreach/export\.csv", patterns)
        self.assertEqual({m for m, p, _f in server.ADMIN._extra if p.pattern.startswith("outreach")}, {"GET"})


if __name__ == "__main__":
    unittest.main()

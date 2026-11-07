"""Tests of the recordings' store and routes (apps/api/sessions.py, POST/GET /api/session/... in server.py), v0.12 step 6.

Run: python3 -m unittest discover -s apps/api/tests -v   (stdlib only, no network, a temporary data directory).
The package under test is a REAL one: fixtures/session-adult.zip is made by the sound repository's own writer through this
lane's recorder (tools/bench/src/sonicrec-make-package.ts), so Python's zipfile is proved against bytes the real writer made.
Every claim has a control that must fire: the refusal is paired with the same call done right.
"""
from __future__ import annotations

import errno
import hashlib
import http.client
import io
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import server  # noqa: E402
import sessions  # noqa: E402
from sessions import CHUNK_BYTES, SessionError, SessionStore  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "session-adult.zip"
MIB = 1 << 20


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def package(consent: dict | None = None, filler: int = 0, manifest_over: dict | None = None, drop_manifest: bool = False) -> bytes:
    """The real fixture package, optionally with another consent block, a filler entry of random bytes (a package of several chunks),
    a changed manifest, or no manifest at all. Stored without compression, like the real writer's zips."""
    src = zipfile.ZipFile(FIXTURE)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "manifest.json":
                if drop_manifest:
                    continue
                m = json.loads(data)
                if consent is not None:
                    m["consent"] = {**m["consent"], **consent}
                if manifest_over:
                    m.update(manifest_over)
                data = json.dumps(m).encode()
            z.writestr(info.filename, data)
        if filler:
            z.writestr("voice-extra.bin", os.urandom(filler))
    return out.getvalue()


def chunks_of(data: bytes) -> list[bytes]:
    return [data[i:i + CHUNK_BYTES] for i in range(0, len(data), CHUNK_BYTES)]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.clock = [1_794_000_000.0]            # 2026-11-07 UTC, moved by the tests
        self.free = [10 * 1024 * MIB]
        self.addCleanup(self.tmp.cleanup)
        self.store = self.make()

    def make(self, **kw) -> SessionStore:
        kw.setdefault("free_bytes", lambda: self.free[0])
        kw.setdefault("now", lambda: self.clock[0])
        return SessionStore(lambda: self.dir, **kw)

    def upload(self, store: SessionStore, data: bytes, client: str = "203.0.113.5", finish: bool = True, per_chunk_hash: bool = True, **start_over):
        """start, every chunk, optionally finish. Returns (start answer, finish answer or None)."""
        body = {"size": len(data), "sha256": sha(data), "consentSend": True, "packageId": "pkg-12345678", "lesson": "walls-hall"}
        body.update(start_over)
        s = store.start(client, body)
        if s.get("stored"):
            return s, None
        for n, c in enumerate(chunks_of(data)):
            r = io.BytesIO(c)
            store.put_chunk(s["id"], s["token"], n, len(c), r.read, sha(c) if per_chunk_hash else None)
        return s, store.finish(s["id"], s["token"], {"sha256": sha(data)}) if finish else None

    def meta(self, sid: str) -> dict:
        return json.loads((self.dir / "sessions" / sid / "meta.json").read_bytes())


class Protocol(Base):
    def test_whole_upload_is_stored_and_queued(self):
        data = package(filler=2 * MIB + 300_000)             # three chunks
        self.assertEqual(len(chunks_of(data)), 3)
        s, f = self.upload(self.store, data)
        self.assertTrue(f["ok"] and f["stored"])
        self.assertEqual(f["bytes"], len(data))
        self.assertFalse(f["delivered"])                       # stored is not delivered
        pkg = self.dir / "sessions" / s["id"] / "package.zip"
        self.assertEqual(sha(pkg.read_bytes()), sha(data))
        self.assertFalse((self.dir / "sessions" / s["id"] / "upload.part").exists())
        m = self.meta(s["id"])
        self.assertEqual(m["state"], "stored")
        self.assertEqual({c: v["status"] for c, v in m["channels"].items()}, {"telegram": "queued", "email": "queued"})
        self.assertEqual(self.store.due("telegram"), [s["id"]])
        lines = (self.dir / "sessions" / "index.jsonl").read_text().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0])["sha256"], sha(data))
        # control: before finish nothing of this is true
        d2 = package(filler=500)
        s2, none = self.upload(self.store, d2, finish=False)
        self.assertIsNone(none)
        self.assertEqual(self.meta(s2["id"])["state"], "uploading")
        self.assertNotIn(s2["id"], self.store.due("telegram"))

    def test_stored_means_on_disk_in_the_right_order(self):
        events: list[str] = []
        real_fsync, real_replace, real_json = sessions._fsync_file, sessions._replace, sessions._write_json
        real_index = SessionStore._append_index

        def fsync(f):
            events.append(f"fsync:{Path(f.name).name}")
            return real_fsync(f)

        def replace(a, b):
            events.append(f"replace:{Path(a).name}->{Path(b).name}")
            return real_replace(a, b)

        def write_json(p, obj):
            events.append(f"json:{obj.get('state')}")
            return real_json(p, obj)

        def index(self_, rec):
            events.append("index")
            return real_index(self_, rec)

        data = package(filler=300)
        with mock.patch.object(sessions, "_fsync_file", fsync), mock.patch.object(sessions, "_replace", replace), mock.patch.object(sessions, "_write_json", write_json), \
                mock.patch.object(SessionStore, "_append_index", index):
            s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
            self.store.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, sha(data))
            events.append("--finish--")
            self.store.finish(s["id"], s["token"], None)
        tail = events[events.index("--finish--") + 1:]
        # the package is fsynced, then moved into place, then the state says stored (with the queue entries; itself written to a
        # temporary file, fsynced, renamed), then the index line, fsynced: only then does finish answer
        self.assertEqual(tail, ["fsync:upload.part", "replace:upload.part->package.zip", "json:stored", "fsync:meta.json.tmp", "replace:meta.json.tmp->meta.json", "index", "fsync:index.jsonl"])
        # and the chunk was fsynced before it was recorded as held
        head = events[:events.index("--finish--")]
        self.assertLess(head.index("fsync:upload.part"), len(head) - 1 - head[::-1].index("json:uploading"))

    def test_resume_after_a_restart(self):
        data = package(filler=2 * MIB + 10)
        parts = chunks_of(data)
        s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        for n in (0, 2):
            self.store.put_chunk(s["id"], s["token"], n, len(parts[n]), io.BytesIO(parts[n]).read, sha(parts[n]))
        again = self.make()                                   # the server was restarted
        self.assertEqual(again.recover()["sessions"], 1)
        st = again.status(s["id"], s["token"])
        self.assertEqual((st["state"], st["held"], st["of" if "of" in st else "chunks"]), ("uploading", [0, 2], 3))
        with self.assertRaises(SessionError) as cm:
            again.finish(s["id"], s["token"], None)
        self.assertEqual((cm.exception.status, cm.exception.code, cm.exception.extra["missing"]), (409, "incomplete", [1]))
        again.put_chunk(s["id"], s["token"], 1, len(parts[1]), io.BytesIO(parts[1]).read, sha(parts[1]))
        f = again.finish(s["id"], s["token"], None)
        self.assertTrue(f["stored"])
        self.assertEqual(sha((self.dir / "sessions" / s["id"] / "package.zip").read_bytes()), sha(data))

    def test_a_held_chunk_never_changes(self):
        data = package(filler=MIB + 50)
        parts = chunks_of(data)
        s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        self.store.put_chunk(s["id"], s["token"], 0, len(parts[0]), io.BytesIO(parts[0]).read, sha(parts[0]))
        part_file = self.dir / "sessions" / s["id"] / "upload.part"
        before = part_file.read_bytes()
        same = self.store.put_chunk(s["id"], s["token"], 0, len(parts[0]), io.BytesIO(parts[0]).read, None)
        self.assertTrue(same["already"])
        other = bytes(b ^ 0xFF for b in parts[0])
        with self.assertRaises(SessionError) as cm:
            self.store.put_chunk(s["id"], s["token"], 0, len(other), io.BytesIO(other).read, None)
        self.assertEqual((cm.exception.status, cm.exception.code), (409, "chunk-differs"))
        self.assertEqual(part_file.read_bytes(), before)       # the held bytes are still what was first held

    def test_a_bad_chunk_hash_is_refused_and_not_held(self):
        data = package(filler=200)
        s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        with self.assertRaises(SessionError) as cm:
            self.store.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, sha(b"something else"))
        self.assertEqual((cm.exception.status, cm.exception.code), (422, "bad-hash"))
        self.assertEqual(self.store.status(s["id"], s["token"])["held"], [])
        ok = self.store.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, sha(data))      # control: the right hash
        self.assertEqual(ok["held"], 1)

    def test_a_bad_whole_hash_is_refused_and_the_upload_removed(self):
        a, b = package(filler=100), package(filler=100)       # the same size, other bytes
        self.assertEqual(len(a), len(b))
        self.assertNotEqual(sha(a), sha(b))
        s = self.store.start("c", {"size": len(a), "sha256": sha(a), "consentSend": True})
        self.store.put_chunk(s["id"], s["token"], 0, len(b), io.BytesIO(b).read, None)    # the client's chunk hash is optional: the final one decides
        with self.assertRaises(SessionError) as cm:
            self.store.finish(s["id"], s["token"], None)
        self.assertEqual((cm.exception.status, cm.exception.code), (422, "bad-hash"))
        self.assertTrue(cm.exception.extra["restart"])
        self.assertFalse((self.dir / "sessions" / s["id"]).exists())
        self.assertFalse((self.dir / "sessions" / "index.jsonl").exists())
        # control: the same upload with the right declared hash is stored
        s2, f = self.upload(self.store, b)
        self.assertTrue(f["stored"])

    def test_the_hash_given_at_finish_must_be_the_one_given_at_start(self):
        data = package(filler=100)
        s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        self.store.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, None)
        with self.assertRaises(SessionError) as cm:
            self.store.finish(s["id"], s["token"], {"sha256": sha(b"x")})
        self.assertEqual(cm.exception.code, "hash-changed")
        self.assertTrue(self.store.finish(s["id"], s["token"], {"sha256": sha(data)})["stored"])

    def test_sizes_are_limited(self):
        small = self.make(max_bytes=lambda: 3 * MIB)
        for bad, code, status in ((0, "bad-size", 400), (-5, "bad-size", 400), (True, "bad-size", 400), (1.5, "bad-size", 400), ("9", "bad-size", 400), (3 * MIB + 1, "too-large", 413)):
            with self.assertRaises(SessionError, msg=repr(bad)) as cm:
                small.start("c", {"size": bad, "sha256": sha(b"x"), "consentSend": True})
            self.assertEqual((cm.exception.status, cm.exception.code), (status, code), repr(bad))
        self.assertTrue(small.start("c", {"size": 3 * MIB, "sha256": sha(b"x"), "consentSend": True})["ok"])      # control: the limit itself is allowed
        for bad in ("", "abc", "G" * 64, sha(b"x").upper(), sha(b"x")[:-1]):
            with self.assertRaises(SessionError, msg=bad) as cm:
                small.start("c", {"size": 10, "sha256": bad, "consentSend": True})
            self.assertEqual(cm.exception.code, "bad-hash")

    def test_a_chunk_must_have_the_length_it_is_declared_to_have(self):
        data = package(filler=MIB + 700)
        parts = chunks_of(data)
        s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        for n, length, status, code in ((0, CHUNK_BYTES + 1, 413, "bad-length"), (0, CHUNK_BYTES - 1, 400, "bad-length"), (0, 0, 400, "bad-length"),
                                        (1, CHUNK_BYTES, 413, "bad-length"), (2, 10, 404, "bad-chunk"), (-1, 10, 404, "bad-chunk")):
            with self.assertRaises(SessionError, msg=(n, length)) as cm:
                self.store.put_chunk(s["id"], s["token"], n, length, io.BytesIO(b"x" * length).read, None)
            self.assertEqual((cm.exception.status, cm.exception.code), (status, code), (n, length))
        self.assertEqual(self.store.status(s["id"], s["token"])["held"], [])
        for n, c in enumerate(parts):                           # control: the exact lengths, the short last chunk included
            self.store.put_chunk(s["id"], s["token"], n, len(c), io.BytesIO(c).read, None)
        self.assertTrue(self.store.finish(s["id"], s["token"], None)["stored"])

    def test_the_token_is_checked_everywhere_and_never_stored(self):
        data = package(filler=100)
        s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        other = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        for bad in (None, "", "nope", other["token"], s["token"][:-1] + ("A" if s["token"][-1] != "A" else "B")):
            for call in (lambda t: self.store.put_chunk(s["id"], t, 0, len(data), io.BytesIO(data).read, None), lambda t: self.store.finish(s["id"], t, None), lambda t: self.store.status(s["id"], t)):
                with self.assertRaises(SessionError, msg=repr(bad)) as cm:
                    call(bad)
                self.assertEqual((cm.exception.status, cm.exception.code), (403, "token"), repr(bad))
        for sid in ("S-20261107-0123456789ab", "nonsense", "../etc", "S-2026-1", ""):
            with self.assertRaises(SessionError) as cm:
                self.store.status(sid, s["token"])
            self.assertEqual(cm.exception.status, 404, sid)
        self.assertEqual(self.store.status(s["id"], s["token"])["state"], "uploading")      # control: the right token
        on_disk = (self.dir / "sessions" / s["id"] / "meta.json").read_text()
        self.assertNotIn(s["token"], on_disk)
        self.assertIn(sha(s["token"].encode()), on_disk)

    def test_a_full_disk_refuses_the_start_and_leaves_nothing(self):
        data = package(filler=100)
        self.free[0] = len(data) - 1
        with self.assertRaises(SessionError) as cm:
            self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        self.assertEqual((cm.exception.status, cm.exception.code), (507, "disk"))
        self.assertEqual(list((self.dir / "sessions").glob("S-*")) if (self.dir / "sessions").exists() else [], [])
        guard = self.make(min_free_bytes=lambda: 2_000_000_000)           # the disk guard: less than MIN_FREE_GB left
        self.free[0] = 1_500_000_000
        with self.assertRaises(SessionError) as cm2:
            guard.start("c", {"size": 100, "sha256": sha(b"y"), "consentSend": True})
        self.assertEqual(cm2.exception.code, "disk")
        self.free[0] = 10 * 1024 * MIB                                     # control: room again
        self.assertTrue(self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})["ok"])

    def test_a_disk_that_fills_during_a_chunk_is_refused_and_the_chunk_is_not_held(self):
        data = package(filler=200)
        s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})

        def full(f, offset, block):
            raise OSError(errno.ENOSPC, "No space left on device")

        with mock.patch.object(sessions, "_write_at", full):
            with self.assertRaises(SessionError) as cm:
                self.store.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, None)
        self.assertEqual((cm.exception.status, cm.exception.code), (507, "disk"))
        self.assertEqual(self.store.status(s["id"], s["token"])["held"], [])
        self.assertEqual(self.store.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, None)["held"], 1)      # control: the retry
        # a fsync that fails for lack of space is the same
        s2 = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        with mock.patch.object(sessions, "_fsync_file", side_effect=OSError(errno.ENOSPC, "full")):
            with self.assertRaises(SessionError) as cm2:
                self.store.put_chunk(s2["id"], s2["token"], 0, len(data), io.BytesIO(data).read, None)
        self.assertEqual(cm2.exception.code, "disk")
        self.assertEqual(self.store.status(s2["id"], s2["token"])["held"], [])

    def test_the_total_cap_counts_stored_packages_and_uploads_in_progress(self):
        a, b = package(filler=2 * MIB), package(filler=2 * MIB)
        store = self.make(cap_bytes=lambda: 5 * MIB)
        s1 = store.start("c", {"size": len(a), "sha256": sha(a), "consentSend": True})                    # reserved: 2 MiB
        with self.assertRaises(SessionError) as cm:
            store.start("d", {"size": len(b) + 2 * MIB, "sha256": sha(b), "consentSend": True})           # 2 + 4 > 5
        self.assertEqual((cm.exception.status, cm.exception.code), (507, "cap"))
        s2 = store.start("d", {"size": len(b), "sha256": sha(b), "consentSend": True})                    # 2 + 2 fits
        self.assertTrue(s2["ok"])
        with self.assertRaises(SessionError):
            store.start("e", {"size": len(a), "sha256": sha(b"z"), "consentSend": True})                  # 2 + 2 + 2 does not
        # stored ones count too, and deleting one gives its room back
        for n, c in enumerate(chunks_of(a)):
            store.put_chunk(s1["id"], s1["token"], n, len(c), io.BytesIO(c).read, None)
        store.finish(s1["id"], s1["token"], None)
        with self.assertRaises(SessionError):
            store.start("e", {"size": len(a), "sha256": sha(b"z"), "consentSend": True})
        self.assertTrue(store.delete(s2["id"], "test"))
        self.assertTrue(store.start("e", {"size": len(a), "sha256": sha(b"z"), "consentSend": True})["ok"])

    def test_consent_to_send_is_needed_at_the_start_and_for_a_minor_the_guardian_in_the_package(self):
        data = package(filler=50)
        for body in ({"size": len(data), "sha256": sha(data)}, {"size": len(data), "sha256": sha(data), "consentSend": False},
                     {"size": len(data), "sha256": sha(data), "consentSend": "yes"}, {"size": len(data), "sha256": sha(data), "consentSend": 1}):
            with self.assertRaises(SessionError) as cm:
                self.store.start("c", body)
            self.assertEqual((cm.exception.status, cm.exception.code), (403, "no-consent"), body)
        # a minor's package without the guardian's confirmation is refused by the server whatever the client says, and nothing is kept
        for claim in ({"minor": True, "guardianConfirmed": None}, {"minor": True, "guardianConfirmed": False}, {"minor": True}):
            bad = package(consent=claim, filler=50)
            s = self.store.start("c", {"size": len(bad), "sha256": sha(bad), "consentSend": True, "minor": False})
            self.store.put_chunk(s["id"], s["token"], 0, len(bad), io.BytesIO(bad).read, None)
            with self.assertRaises(SessionError) as cm:
                self.store.finish(s["id"], s["token"], None)
            self.assertEqual((cm.exception.status, cm.exception.code), (422, "consent-guardian"), claim)
            self.assertFalse((self.dir / "sessions" / s["id"]).exists())
        self.assertFalse((self.dir / "sessions" / "index.jsonl").exists())
        self.assertEqual(self.store.due("telegram"), [])
        # control: the guardian confirmed, and an adult
        ok = package(consent={"minor": True, "guardianConfirmed": True}, filler=50)
        s, f = self.upload(self.store, ok)
        self.assertTrue(f["stored"])
        self.assertTrue(self.meta(s["id"])["summary"]["minor"])
        self.assertTrue(self.upload(self.store, package(filler=51))[1]["stored"])

    def test_a_file_that_is_not_a_package_is_refused(self):
        noise = os.urandom(2000)
        for data in (noise, package(drop_manifest=True), package(manifest_over={"format": "something/else"}), package(manifest_over={"consent": "yes"}), b"PK\x03\x04" + noise):
            s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
            for n, c in enumerate(chunks_of(data)):
                self.store.put_chunk(s["id"], s["token"], n, len(c), io.BytesIO(c).read, None)
            with self.assertRaises(SessionError) as cm:
                self.store.finish(s["id"], s["token"], None)
            self.assertEqual((cm.exception.status, cm.exception.code), (422, "not-a-package"))
            # a refused upload is kept on the server neither as a package nor as a reservation of space
            self.assertEqual(list((self.dir / "sessions").glob("S-*/package.zip")), [])
        self.assertTrue(self.upload(self.store, package(filler=1))[1]["stored"])      # control

    def test_the_same_package_twice_is_stored_once(self):
        data = package(filler=1000)
        s1, f1 = self.upload(self.store, data)
        s2, f2 = self.upload(self.store, data, client="198.51.100.7")
        self.assertTrue(s2["stored"] and s2["duplicate"] and s2["chunks"] == 0)
        self.assertEqual(len(list((self.dir / "sessions").glob("S-*/package.zip"))), 1)
        st = self.store.status(s2["id"], s2["token"])                        # the alias's token follows the one copy's delivery
        self.assertEqual((st["stored"], st["duplicate"], st["of"]), (True, True, s1["id"]))
        self.assertTrue(self.store.finish(s2["id"], s2["token"], None)["stored"])
        with self.assertRaises(SessionError) as cm:
            self.store.put_chunk(s2["id"], s2["token"], 0, 10, io.BytesIO(b"x" * 10).read, None)
        self.assertEqual((cm.exception.status, cm.exception.code), (409, "duplicate"))
        # the alias's token does not open the original, and the original's does not open the alias
        with self.assertRaises(SessionError):
            self.store.status(s1["id"], s2["token"])
        # control: another package is not a duplicate
        s3, f3 = self.upload(self.store, package(filler=1001))
        self.assertFalse(s3.get("duplicate"))
        self.assertEqual(len(list((self.dir / "sessions").glob("S-*/package.zip"))), 2)

    def test_two_uploads_of_one_package_that_race_end_as_one_copy(self):
        data = package(filler=1000)
        a = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        b = self.store.start("d", {"size": len(data), "sha256": sha(data), "consentSend": True})      # neither is stored yet: both upload
        self.assertFalse(a.get("duplicate") or b.get("duplicate"))
        for s in (a, b):
            self.store.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, None)
        fa = self.store.finish(a["id"], a["token"], None)
        fb = self.store.finish(b["id"], b["token"], None)
        self.assertTrue(fa["stored"] and fb["stored"] and fb["duplicate"] and fb["of"] == a["id"])
        self.assertEqual(len(list((self.dir / "sessions").glob("S-*/package.zip"))), 1)
        self.assertEqual(self.store.status(b["id"], b["token"])["of"], a["id"])
        self.assertEqual(len((self.dir / "sessions" / "index.jsonl").read_text().splitlines()), 1)

    def test_finish_can_be_repeated_after_a_lost_answer(self):
        data = package(filler=500)
        s, f = self.upload(self.store, data)
        again = self.store.finish(s["id"], s["token"], None)
        self.assertEqual({k: f[k] for k in ("id", "bytes", "sha256")}, {k: again[k] for k in ("id", "bytes", "sha256")})
        self.assertEqual(len((self.dir / "sessions" / "index.jsonl").read_text().splitlines()), 1)     # not indexed twice
        self.assertEqual(self.meta(s["id"])["channels"]["telegram"]["attempts"], 0)
        with self.assertRaises(SessionError) as cm:                                          # but a chunk after "stored" is refused
            self.store.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, None)
        self.assertEqual((cm.exception.status, cm.exception.code), (409, "not-uploading"))

    def test_a_finish_that_was_cut_off_after_the_package_was_moved_into_place_completes(self):
        data = package(filler=700)
        s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        self.store.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, sha(data))
        d = self.dir / "sessions" / s["id"]
        os.replace(d / "upload.part", d / "package.zip")                                      # the crash came right after the rename
        self.assertEqual(self.meta(s["id"])["state"], "uploading")
        f = self.make().finish(s["id"], s["token"], None)                                     # a restarted server, the client's retry
        self.assertTrue(f["stored"])
        self.assertEqual(self.meta(s["id"])["state"], "stored")
        self.assertEqual(sha((d / "package.zip").read_bytes()), sha(data))

    def test_the_summary_keeps_facts_and_the_client_address_is_never_written(self):
        data = package(filler=40)
        s, f = self.upload(self.store, data, client="203.0.113.99")
        m = self.meta(s["id"])
        self.assertEqual({k: m["summary"][k] for k in ("lesson", "locale", "minor", "voice", "complete", "durationMs", "release", "sonic", "path")},
                         {"lesson": "walls-hall", "locale": "en", "minor": False, "voice": True, "complete": True, "durationMs": 4000, "release": "abc1234", "sonic": "3959930", "path": "full"})
        text = json.dumps(m)
        for secret in ("203.0.113.99", "userAgent", "fixture", "nickname"):
            self.assertNotIn(secret, text)
        index = (self.dir / "sessions" / "index.jsonl").read_text()
        self.assertNotIn("203.0.113.99", index)
        self.assertEqual(m["consent"]["send"], True)

    def test_a_client_holds_few_unfinished_uploads(self):
        for i in range(sessions.MAX_OPEN_PER_CLIENT):
            self.assertTrue(self.store.start("greedy", {"size": 100, "sha256": sha(bytes([i])), "consentSend": True})["ok"])
        with self.assertRaises(SessionError) as cm:
            self.store.start("greedy", {"size": 100, "sha256": sha(b"more"), "consentSend": True})
        self.assertEqual((cm.exception.status, cm.exception.code), (429, "too-many-uploads"))
        self.assertTrue(self.store.start("someone-else", {"size": 100, "sha256": sha(b"more"), "consentSend": True})["ok"])      # control

    def test_a_chunk_is_streamed_in_small_blocks(self):
        data = package(filler=MIB)
        asked: list[int] = []
        parts = chunks_of(data)
        s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        r = io.BytesIO(parts[0])

        def read(k):
            asked.append(k)
            return r.read(k)

        self.store.put_chunk(s["id"], s["token"], 0, len(parts[0]), read, None)
        self.assertGreaterEqual(len(asked), 16)
        self.assertLessEqual(max(asked), sessions.READ_BLOCK)

    def test_a_slow_or_cut_off_client_costs_nothing(self):
        data = package(filler=300)
        s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        short = io.BytesIO(data[:100])
        with self.assertRaises(SessionError) as cm:
            self.store.put_chunk(s["id"], s["token"], 0, len(data), short.read, None)
        self.assertEqual((cm.exception.status, cm.exception.code), (400, "cut-short"))

        def slow(k):
            raise TimeoutError("timed out")

        with self.assertRaises(SessionError) as cm2:
            self.store.put_chunk(s["id"], s["token"], 0, len(data), slow, None)
        self.assertEqual((cm2.exception.status, cm2.exception.code), (408, "slow"))

        def reset(k):
            raise ConnectionResetError()

        with self.assertRaises(SessionError) as cm3:
            self.store.put_chunk(s["id"], s["token"], 0, len(data), reset, None)
        self.assertEqual(cm3.exception.code, "cut-short")
        self.assertEqual(self.store.status(s["id"], s["token"])["held"], [])
        self.assertEqual(self.store.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, None)["held"], 1)      # control

    def test_chunks_in_parallel_all_land(self):
        data = package(filler=5 * MIB + 17)
        parts = chunks_of(data)
        s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        errors: list[BaseException] = []

        def go(n):
            try:
                self.store.put_chunk(s["id"], s["token"], n, len(parts[n]), io.BytesIO(parts[n]).read, sha(parts[n]))
            except BaseException as e:  # noqa: BLE001
                errors.append(e)

        threads = [threading.Thread(target=go, args=(n,)) for n in range(len(parts))]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertEqual(self.store.status(s["id"], s["token"])["held"], list(range(len(parts))))        # no recorded chunk was lost to another's write
        self.assertTrue(self.store.finish(s["id"], s["token"], None)["stored"])

    def test_the_same_chunk_twice_at_once_is_busy(self):
        data = package(filler=300)
        s = self.store.start("c", {"size": len(data), "sha256": sha(data), "consentSend": True})
        gate, inside = threading.Event(), threading.Event()
        r = io.BytesIO(data)

        def slow_read(k):
            inside.set()
            gate.wait(5)
            return r.read(k)

        first: list = []
        t = threading.Thread(target=lambda: first.append(self.store.put_chunk(s["id"], s["token"], 0, len(data), slow_read, None)))
        t.start()
        self.assertTrue(inside.wait(5))
        with self.assertRaises(SessionError) as cm:
            self.store.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, None)
        self.assertEqual((cm.exception.status, cm.exception.code), (409, "busy"))
        gate.set()
        t.join()
        self.assertEqual(first[0]["held"], 1)                                   # control: the first one finished normally


class Housekeeping(Base):
    def test_recover_puts_a_cut_off_send_back_in_the_queue(self):
        s, f = self.upload(self.store, package(filler=64))
        d = self.dir / "sessions" / s["id"]
        m = self.meta(s["id"])
        m["channels"]["telegram"].update(status="sending", claimedAt=self.clock[0])
        m["channels"]["email"].update(status="sent", sentAt="2026-11-07T10:00:00Z")
        (d / "meta.json").write_text(json.dumps(m))
        (d / "meta.json.tmp").write_text("half a file")
        fresh = self.make()
        stats = fresh.recover()
        self.assertEqual((stats["sessions"], stats["requeued"], stats["tmp"]), (1, 1, 1))
        after = self.meta(s["id"])
        self.assertEqual(after["channels"]["telegram"]["status"], "queued")
        self.assertTrue(after["channels"]["telegram"]["recovered"])
        self.assertEqual(after["channels"]["email"]["status"], "sent")           # a finished send is never redone
        self.assertEqual(fresh.due("telegram"), [s["id"]])
        self.assertEqual(fresh.due("email"), [])
        self.assertFalse((d / "meta.json.tmp").exists())

    def test_an_unreadable_session_is_left_alone_and_the_rest_is_served(self):
        good, _ = self.upload(self.store, package(filler=5))
        bad, _ = self.upload(self.store, package(filler=6))
        (self.dir / "sessions" / bad["id"] / "meta.json").write_text("{not json")
        fresh = self.make()
        self.assertEqual(fresh.recover()["bad"], 1)
        self.assertEqual([r["id"] for r in fresh.list()], [good["id"]])
        self.assertTrue((self.dir / "sessions" / bad["id"] / "package.zip").exists())      # the package stays on disk

    def test_due_is_by_time_and_oldest_first(self):
        a, _ = self.upload(self.store, package(filler=1))
        self.clock[0] += 10
        b, _ = self.upload(self.store, package(filler=2))
        self.assertEqual(self.store.due("telegram", self.clock[0]), [a["id"], b["id"]])
        self.store.update(a["id"], lambda m: m["channels"]["telegram"].update(nextAt=self.clock[0] + 100, status="retrying"))
        self.assertEqual(self.store.due("telegram", self.clock[0]), [b["id"]])
        self.assertEqual(self.store.due("telegram", self.clock[0] + 100), [a["id"], b["id"]] if False else [b["id"], a["id"]])
        self.assertEqual(self.store.due("email", self.clock[0]), [a["id"], b["id"]])
        self.store.update(b["id"], lambda m: m["channels"]["telegram"].update(status="sent"))
        self.assertEqual(self.store.due("telegram", self.clock[0] + 100), [a["id"]])

    def test_resend_requeues_one_channel_only(self):
        s, _ = self.upload(self.store, package(filler=8))
        for name in ("telegram", "email"):
            self.store.update(s["id"], lambda m, n=name: m["channels"][n].update(status="sent", attempts=2, sentAt="x"))
        self.assertEqual(self.store.due("telegram"), [])
        m = self.store.resend(s["id"], "telegram")
        self.assertEqual((m["channels"]["telegram"]["status"], m["channels"]["telegram"]["attempts"], m["channels"]["email"]["status"]), ("queued", 0, "sent"))
        self.assertEqual(self.store.due("telegram"), [s["id"]])
        self.assertEqual(self.store.due("email"), [])
        with self.assertRaises(SessionError) as cm:
            self.store.resend(s["id"], "carrier-pigeon")
        self.assertEqual(cm.exception.code, "bad-channel")
        up = self.store.start("c", {"size": 100, "sha256": sha(b"q"), "consentSend": True})
        with self.assertRaises(SessionError) as cm2:
            self.store.resend(up["id"], "email")
        self.assertEqual((cm2.exception.status, cm2.exception.code), (409, "not-stored"))

    def test_sweep_removes_abandoned_uploads_and_old_delivered_packages_only(self):
        abandoned = self.store.start("c", {"size": 100, "sha256": sha(b"a"), "consentSend": True})
        stored_new, _ = self.upload(self.store, package(filler=11))
        stored_old, _ = self.upload(self.store, package(filler=12))
        undelivered_old, _ = self.upload(self.store, package(filler=13))
        for sid in (stored_new["id"], stored_old["id"]):
            for name in ("telegram", "email"):
                self.store.update(sid, lambda m, n=name: m["channels"][n].update(status="sent"))
        self.store.update(stored_old["id"], lambda m: m.update(storedTs=self.clock[0] - (sessions.RETENTION_DAYS + 1) * 86400))
        self.store.update(undelivered_old["id"], lambda m: m.update(storedTs=self.clock[0] - (sessions.RETENTION_DAYS + 1) * 86400))
        self.assertEqual(self.store.sweep(), [stored_old["id"]])                           # delivered and past the retention: gone; the fresh upload is not abandoned yet
        self.assertTrue((self.dir / "sessions" / abandoned["id"] / "upload.part").exists())
        self.clock[0] += sessions.UPLOAD_TTL_S + 60
        self.assertEqual(self.store.sweep(), [abandoned["id"]])
        self.assertTrue((self.dir / "sessions" / stored_new["id"] / "package.zip").exists())            # young: kept
        self.assertTrue((self.dir / "sessions" / undelivered_old["id"] / "package.zip").exists())       # old but not delivered: kept, however old
        self.assertFalse((self.dir / "sessions" / stored_old["id"]).exists())
        tomb = [json.loads(x) for x in (self.dir / "sessions" / "index.jsonl").read_text().splitlines() if '"deleted"' in x]
        self.assertEqual({t["id"]: t["reason"] for t in tomb}, {abandoned["id"]: "abandoned", stored_old["id"]: "retention"})

    def test_delete_frees_the_room_and_leaves_a_tombstone(self):
        data = package(filler=2000)
        s, _ = self.upload(self.store, data)
        self.assertTrue(self.store.delete(s["id"], "parent asked"))
        self.assertFalse(self.store.delete(s["id"]))
        self.assertIsNone(self.store.get(s["id"]))
        self.assertEqual(self.store.list(), [])
        self.assertEqual(self.store.due("telegram"), [])
        last = json.loads((self.dir / "sessions" / "index.jsonl").read_text().splitlines()[-1])
        self.assertEqual((last["id"], last["reason"]), (s["id"], "parent asked"))
        s2, f2 = self.upload(self.store, data)                    # the same package again is not taken for a duplicate of a copy that is gone
        self.assertFalse(s2.get("duplicate"))
        self.assertTrue(f2["stored"])


class Http(Base):
    """The real handler on a real socket, the way nginx reaches it."""

    def setUp(self):
        super().setUp()
        self.saved = server.SESSIONS
        server.SESSIONS = self.store
        self.addCleanup(lambda: setattr(server, "SESSIONS", self.saved))
        for b in (server._sthits, server._schits, server._sqhits, server._all_hits):
            b.clear()
        self.api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.api.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (self.api.shutdown(), self.api.server_close()))

    def call(self, method: str, path: str, body: bytes | dict | None = None, token: str | None = None, ip: str = "203.0.113.5", headers: dict | None = None) -> tuple[int, dict, bytes]:
        c = http.client.HTTPConnection("127.0.0.1", self.api.server_address[1], timeout=10)
        raw = body if isinstance(body, bytes) or body is None else json.dumps(body).encode()
        h = {"X-Forwarded-For": ip, **({"X-Session-Token": token} if token else {}), **(headers or {})}
        if isinstance(body, dict):
            h.setdefault("Content-Type", "application/json")
        elif isinstance(body, bytes):
            h.setdefault("Content-Type", "application/octet-stream")
        c.request(method, path, body=raw, headers=h)
        r = c.getresponse()
        out = r.read()
        c.close()
        try:
            return r.status, json.loads(out) if out else {}, out
        except ValueError:
            return r.status, {}, out

    def start(self, data: bytes, **over):
        s, j, _ = self.call("POST", "/api/session/start", {"size": len(data), "sha256": sha(data), "consentSend": True, **over})
        return s, j

    def test_a_whole_upload_through_the_routes(self):
        data = package(filler=MIB + 123_456)
        st, j = self.start(data, packageId="pkg-abcdef12", lesson="walls-hall", minor=False, voice=True, release="abc1234")
        self.assertEqual((st, j["ok"], j["chunks"], j["chunkBytes"], j["stored"]), (200, True, 2, CHUNK_BYTES, False))
        sid, tok = j["id"], j["token"]
        for n, c in enumerate(chunks_of(data)):
            s, r, _ = self.call("POST", f"/api/session/{sid}/{n}", c, token=tok, headers={"X-Chunk-Sha256": sha(c)})
            self.assertEqual((s, r["held"], r["of"]), (200, n + 1, 2))
        s, r, _ = self.call("GET", f"/api/session/{sid}", token=tok)
        self.assertEqual((s, r["state"], r["held"]), (200, "uploading", [0, 1]))
        s, r, _ = self.call("POST", f"/api/session/{sid}/finish", {"sha256": sha(data)}, token=tok)
        self.assertEqual((s, r["stored"], r["bytes"], r["delivered"]), (200, True, len(data), False))
        self.assertEqual(sorted(r["channels"]), ["email", "telegram"])
        self.assertEqual(sha((self.dir / "sessions" / sid / "package.zip").read_bytes()), sha(data))
        s, r, _ = self.call("GET", f"/api/session/{sid}", token=tok)
        self.assertEqual((s, r["state"], r["stored"]), (200, "stored", True))
        self.assertEqual({c: v["status"] for c, v in r["channels"].items()}, {"telegram": "queued", "email": "queued"})

    def test_refusals_carry_a_code_and_say_nothing_secret(self):
        data = package(filler=300)
        _, j = self.start(data)
        sid, tok = j["id"], j["token"]
        s, r, raw = self.call("POST", f"/api/session/{sid}/0", data, token="wrong")
        self.assertEqual((s, r), (403, {"ok": False, "error": "token"}))
        s, r, _ = self.call("POST", f"/api/session/{sid}/0", data)
        self.assertEqual((s, r["error"]), (403, "token"))
        s, r, _ = self.call("POST", f"/api/session/S-20261107-0123456789ab/0", data, token=tok)
        self.assertEqual((s, r["error"] if r else None), (404, "unknown"))
        s, r, _ = self.call("GET", "/api/session/nonsense", token=tok)
        self.assertEqual(s, 404)
        s, r, _ = self.call("GET", "/api/session/start", token=tok)
        self.assertEqual(s, 405)
        s, r, _ = self.call("POST", f"/api/session/{sid}", {}, token=tok)
        self.assertEqual(s, 405)
        s, r, _ = self.call("POST", "/api/session/start", b"{not json", headers={"Content-Type": "application/json"})
        self.assertEqual((s, r["error"]), (400, "bad-request"))
        s, r, _ = self.call("POST", "/api/session/start", {"size": 10, "sha256": sha(b"x")})
        self.assertEqual((s, r["error"]), (403, "no-consent"))
        s, r, _ = self.call("POST", "/api/session/start", {"size": sessions.MAX_PACKAGE_BYTES + 1, "sha256": sha(b"x"), "consentSend": True})
        self.assertEqual((s, r["error"]), (413, "too-large"))
        s, r, raw = self.call("POST", f"/api/session/{sid}/finish", {}, token=tok)
        self.assertEqual((s, r["error"], r["missing"]), (409, "incomplete", [0]))
        self.assertNotIn(tok.encode(), raw)
        self.assertNotIn(str(self.dir).encode(), raw)
        s, r, _ = self.call("POST", f"/api/session/{sid}/0", data, token=tok)               # control: the same chunk with the token
        self.assertEqual((s, r["held"]), (200, 1))

    def test_start_wants_a_json_body_so_a_page_on_another_site_cannot_make_reservations_for_its_visitors(self):
        # `fetch(url, {method: "POST", mode: "no-cors", body: JSON.stringify(...)})` from any site is a "simple" request: the browser sends it
        # with no preflight, with a text/plain body, from the visitor's own address. Each one that is taken reserves up to 100 MiB of the
        # 2 GiB for a day, six per visitor, so a page that many people open could fill the cap and shut every pilot out with 507. A JSON content
        # type cannot be sent cross-site without a preflight, and nginx answers no preflight (limit_except GET POST), so asking for it closes this.
        body = json.dumps({"size": 5000, "sha256": sha(b"x"), "consentSend": True}).encode()
        for ctype in ("text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/octet-stream"):
            s, r, _ = self.call("POST", "/api/session/start", body, headers={"Content-Type": ctype})
            self.assertEqual((s, r.get("error")), (415, "content-type"), ctype)
        self.assertEqual(self.store._open, {})                                   # nothing was reserved
        self.assertFalse((self.dir / "sessions").exists() and any((self.dir / "sessions").iterdir()))
        # control: the same bytes with a JSON content type (a charset after it is fine) start an upload
        s, r, _ = self.call("POST", "/api/session/start", body, headers={"Content-Type": "application/json; charset=utf-8"})
        self.assertEqual((s, r["ok"], r["stored"]), (200, True, False))
        self.assertEqual(len(self.store._open), 1)

    def test_a_chunk_that_is_too_big_is_refused_with_an_answer_not_a_reset(self):
        data = package(filler=MIB + 123_456)
        _, j = self.start(data)
        too_big = os.urandom(CHUNK_BYTES + 50_000)            # nginx would let 1100k through; the API must still say 413
        s, r, _ = self.call("POST", f"/api/session/{j['id']}/0", too_big, token=j["token"])
        self.assertEqual((s, r["error"], r["expect"]), (413, "bad-length", CHUNK_BYTES))
        s, r, _ = self.call("POST", f"/api/session/{j['id']}/0", b"", token=j["token"])
        self.assertEqual((s, r["error"]), (400, "bad-length"))
        s, r, _ = self.call("POST", f"/api/session/{j['id']}/1", b"short", token=j["token"])
        self.assertEqual(s, 400)
        self.assertEqual(self.store.status(j["id"], j["token"])["held"], [])
        s, r, _ = self.call("POST", f"/api/session/{j['id']}/0", chunks_of(data)[0], token=j["token"])      # control
        self.assertEqual((s, r["held"]), (200, 1))

    def test_a_wrong_chunk_hash_header_is_refused(self):
        data = package(filler=300)
        _, j = self.start(data)
        s, r, _ = self.call("POST", f"/api/session/{j['id']}/0", data, token=j["token"], headers={"X-Chunk-Sha256": "0" * 64})
        self.assertEqual((s, r["error"]), (422, "bad-hash"))
        s, r, _ = self.call("POST", f"/api/session/{j['id']}/0", data, token=j["token"], headers={"X-Chunk-Sha256": "not a hash"})
        self.assertEqual((s, r["error"]), (400, "bad-hash"))
        s, r, _ = self.call("POST", f"/api/session/{j['id']}/0", data, token=j["token"], headers={"X-Chunk-Sha256": sha(data)})
        self.assertEqual((s, r["held"]), (200, 1))

    def test_the_token_may_come_as_a_query_for_get_only(self):
        data = package(filler=300)
        _, j = self.start(data)
        s, r, _ = self.call("GET", f"/api/session/{j['id']}?token={j['token']}")
        self.assertEqual((s, r["state"]), (200, "uploading"))
        s, r, _ = self.call("GET", f"/api/session/{j['id']}?token=wrong")
        self.assertEqual(s, 403)
        s, r, _ = self.call("POST", f"/api/session/{j['id']}/0?token={j['token']}", data)
        self.assertEqual((s, r["error"]), (403, "token"))

    def test_rates_are_per_client_address(self):
        data = package(filler=300)
        codes = [self.call("POST", "/api/session/start", {"size": len(data), "sha256": sha(bytes([i])), "consentSend": True}, ip="198.51.100.1")[0] for i in range(22)]
        self.assertEqual(codes.count(200), sessions.MAX_OPEN_PER_CLIENT)                                  # the open-uploads limit comes first for a greedy client
        self.assertIn(429, codes)
        s, j, _ = self.call("POST", "/api/session/start", {"size": len(data), "sha256": sha(b"zz"), "consentSend": True}, ip="198.51.100.2")
        self.assertEqual(s, 200)                                                                           # control: another address is not affected
        server._sthits.clear()
        with mock.patch.object(server, "_rate", side_effect=lambda bucket, key, n, window: bucket is not server._sthits):
            s, j, _ = self.call("POST", "/api/session/start", {"size": len(data), "sha256": sha(b"yy"), "consentSend": True}, ip="198.51.100.3")
        self.assertEqual((s, j["error"]), (429, "rate"))

    def test_other_routes_are_untouched(self):
        s, r, _ = self.call("GET", "/api/health")
        self.assertEqual((s, r["ok"]), (200, True))
        s, r, _ = self.call("POST", "/api/unknown", {})
        self.assertEqual(s, 404)


if __name__ == "__main__":
    unittest.main()

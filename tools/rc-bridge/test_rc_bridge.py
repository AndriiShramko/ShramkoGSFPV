"""Tests of the Shramko RC bridge with no controller: the DUML frames against stage 1's recording, the origin and host
rules, and a real WebSocket handshake on 127.0.0.1 with the recorded frames replayed.
Run: python -X utf8 -m unittest tools/rc-bridge/test_rc_bridge.py (from the repo root)."""
import base64
import json
import os
import socket
import struct
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rc_bridge as rb  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
REC = os.path.join(ROOT, "packages", "input", "test", "fixtures", "dji-rc2", "frames-rest.json")


def answer(values, seq=7, head=0, channels=(1, 2, 3, 4, 5, 6)):
    """A stick answer in the recorded layout: byte 0, then each value followed by its channel number."""
    p = bytes([head]) + b"".join(struct.pack("<H", v) + bytes([c]) for v, c in zip(values, channels))
    return rb.build(seq, sender=0x06, receiver=0x0A, typ=0x80, payload=p)


def closed_within(s, seconds):
    """True when the bridge closes the connection within `seconds` (data it still sends is read and dropped)."""
    s.settimeout(0.2)
    t0 = time.monotonic()
    while time.monotonic() - t0 < seconds:
        try:
            if not s.recv(65536):
                return True
        except socket.timeout:
            continue
        except OSError:
            return True
    return False


def handshake(port, origin, host=None, rcvbuf=None):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if rcvbuf:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, rcvbuf)  # a small window fills fast
    s.settimeout(3)
    s.connect(("127.0.0.1", port))
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall(("GET / HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
               "Sec-WebSocket-Version: 13\r\nOrigin: %s\r\n\r\n" % (host or "127.0.0.1:%d" % port, key, origin)).encode())
    head = b""
    while b"\r\n\r\n" not in head:
        c = s.recv(1)
        if not c:
            break
        head += c
    return s, head.decode("latin-1"), key


def recv_text(s):
    def exact(n):
        b = b""
        while len(b) < n:
            c = s.recv(n - len(b))
            if not c:
                raise EOFError
            b += c
        return b
    h = exact(2)
    n = h[1] & 0x7F
    if n == 126:
        n = struct.unpack(">H", exact(2))[0]
    return json.loads(exact(n).decode())


class Duml(unittest.TestCase):
    def test_request_is_the_recorded_one(self):
        with open(REC, encoding="utf-8") as f:
            doc = json.load(f)
        first = doc["request"].split(" ")[0]
        self.assertEqual(rb.build(0x34EB).hex(), first)

    def test_recorded_replies_parse_to_the_rest_values(self):
        r = rb.Replay(REC)
        self.assertGreater(len(r.values), 200)
        self.assertEqual(r.values[0], [1024] * 6)

    def test_a_broken_byte_is_skipped(self):
        good = answer([1024] * 6)
        bad = bytearray(good)
        bad[12] ^= 0xFF
        buf = bytearray(bytes(bad) + good)
        out = rb.parse(buf)
        self.assertEqual(out, [good])
        self.assertEqual(rb.stick_values(good), [1024] * 6)
        self.assertIsNone(rb.stick_values(rb.build(7)))  # the request itself is not an answer

    def test_only_the_recorded_layout_is_read(self):
        # review RC2-R9: an error or another layout is never sent as stick positions
        self.assertEqual(rb.stick_values(answer([324, 1724, 1024, 1024, 1024, 1024])), [324, 1724, 1024, 1024, 1024, 1024])
        self.assertIsNone(rb.stick_values(answer([1024] * 6, head=1)))
        self.assertIsNone(rb.stick_values(answer([1024] * 6, channels=(1, 2, 3, 4, 6, 5))))
        self.assertIsNone(rb.stick_values(answer([0, 1024, 1024, 1024, 1024, 1024])))
        self.assertIsNone(rb.stick_values(answer([1024, 1024, 1024, 1024, 1024, 65535])))
        self.assertIsNone(rb.stick_values(rb.build(7, sender=0x06, receiver=0x0A, typ=0x80, payload=bytes(19))))

    def test_an_untested_dji_controller_is_opened_but_never_the_drone(self):
        rc2, drone, other, mouse = (0x2CA3, 0x1021), (0x2CA3, 0x0020), (0x2CA3, 0x1020), (0x046D, 0xC077)
        self.assertEqual(rb.pick_device([mouse, drone, rc2, other]), 2)
        self.assertEqual(rb.pick_device([mouse, drone, other]), 2)
        self.assertIsNone(rb.pick_device([mouse, drone]))
        self.assertIsNone(rb.pick_device([]))

    def test_descriptor_check(self):
        # review RC2-R8: the bytes at the measured offset must be a device descriptor before they are trusted
        self.assertTrue(rb.descriptor_ok(bytes([0x12, 0x01]) + bytes(16)))
        self.assertFalse(rb.descriptor_ok(bytes(18)))
        self.assertFalse(rb.descriptor_ok(bytes([0x12, 0x01])))


class Rules(unittest.TestCase):
    def test_origins(self):
        for o in ("https://gsfpv.flyreelstudio.eu", "https://gsfpv-staging.flyreelstudio.eu"):
            self.assertTrue(rb.origin_allowed(o), o)
        for o in ("http://localhost", "http://localhost:5390"):
            self.assertFalse(rb.origin_allowed(o), o)  # review RC2-R7: a local page only with --dev
            self.assertTrue(rb.origin_allowed(o, dev=True), o)
        for o in ("", "null", "https://gsfpv.flyreelstudio.eu.evil.example", "http://gsfpv.flyreelstudio.eu",
                  "https://localhost", "http://localhost.evil.example", "http://127.0.0.1:5390", "http://localhost:x"):
            self.assertFalse(rb.origin_allowed(o, dev=True), o)

    def test_hosts_and_accept_key(self):
        self.assertTrue(rb.host_allowed("127.0.0.1:47310", 47310))
        self.assertTrue(rb.host_allowed("localhost:47310", 47310))
        self.assertFalse(rb.host_allowed("evil.example:47310", 47310))
        self.assertEqual(rb.accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")  # RFC 6455 sample


class Recorded(unittest.TestCase):
    """--record: every stick answer passed on, one JSON line {t, v}, nothing else (lane rc2-lna)."""

    def test_record_has_one_line_per_answer_and_only_t_and_v(self):
        import tempfile
        path = os.path.join(tempfile.mkdtemp(), "rec.jsonl")
        b = rb.Bridge(lambda: rb.Replay(REC, wiggle=True), port=0, log=lambda *_: None, dev=True, record=path)
        port = b.start()
        s, _, _ = handshake(port, "http://localhost:5390")
        try:
            recv_text(s)
            msgs = [recv_text(s) for _ in range(30)]
        finally:
            s.close()
            b.stop()
        sent = [m["v"] for m in msgs if "v" in m]
        with open(path, encoding="ascii") as f:
            lines = [json.loads(x) for x in f if x.strip()]
        self.assertGreaterEqual(len(lines), len(sent))
        self.assertEqual([x["v"] for x in lines[:len(sent)]], sent)
        self.assertTrue(all(set(x) == {"t", "v"} and len(x["v"]) == 6 for x in lines))
        ts = [x["t"] for x in lines]
        self.assertEqual(ts, sorted(ts))

    def test_analysis_names_channels_in_the_order_they_moved(self):
        import tempfile
        import analyze_record as ar
        path = os.path.join(tempfile.mkdtemp(), "syn.jsonl")
        rows = []
        for t in range(0, 6000, 10):
            v = [1024] * 6
            if t >= 2000: v[2] = 1600   # left stick up: channel 3 +
            if t >= 3000: v[3] = 500    # left stick left: channel 4 -
            if t >= 4000: v[1] = 1500   # right stick up: channel 2 +
            if t >= 5000: v[0] = 600    # right stick left: channel 1 -
            rows.append({"t": t, "v": v})
        with open(path, "w", encoding="ascii") as f:
            f.write("".join(json.dumps(r) + "\n" for r in rows) + '{"t": 1, "v": [1')  # a cut last line
        r = ar.analyze(ar.load(path))
        self.assertEqual(r["lines"], 600)
        self.assertEqual([c["rest"] for c in r["channels"]], [1024] * 6)
        self.assertEqual((r["channels"][2]["min"], r["channels"][2]["max"]), (1024, 1600))
        self.assertEqual([(m["channel"], m["direction"], m["gesture"]) for m in r["moves"]],
                         [(3, "+", "left stick up"), (4, "-", "left stick left"), (2, "+", "right stick up"), (1, "-", "right stick left")])
        self.assertEqual([m["t"] for m in r["moves"]], [2000, 3000, 4000, 5000])


OWNER = os.path.join(ROOT, "packages", "input", "test", "fixtures", "dji-rc2", "owner-session-2026-11-13.jsonl")


class FakeClock:
    """A clock that moves only by the replay's own sleeps (the tests read the pace without real time)."""

    def __init__(self):
        self.now = 100.0
        self.slept = []

    def clock(self):
        return self.now

    def sleep(self, s):
        self.slept.append(s)
        self.now += s


class RecordReplayed(unittest.TestCase):
    """--replay of a --record file: the answers at their recorded pace, an optional start and end second (lane connect)."""

    def write(self, rows, tail=""):
        import tempfile
        path = os.path.join(tempfile.mkdtemp(), "rec.jsonl")
        with open(path, "w", encoding="ascii") as f:
            f.write("".join(json.dumps({"t": t, "v": v}) + "\n" for t, v in rows) + tail)
        return path

    def test_a_record_is_told_from_a_frames_file(self):
        self.assertTrue(rb.is_record(OWNER))
        self.assertFalse(rb.is_record(REC))

    def test_answers_come_at_the_recorded_times(self):
        rows = [(5000, [1024] * 6), (5016, [1100] + [1024] * 5), (5016, [1200] + [1024] * 5), (5047, [364] * 6)]
        ck = FakeClock()
        r = rb.RecordReplay(self.write(rows, '{"t": 9'), clock=ck.clock, sleep=ck.sleep)
        r.open()
        got = []
        for _ in range(4):
            v = r.read()
            got.append((round((ck.now - 100.0) * 1000), v))
        self.assertEqual(got, [(0, [1024] * 6), (16, [1100] + [1024] * 5), (16, [1200] + [1024] * 5), (47, [364] * 6)])
        self.assertIsNone(r.read())  # the record has ended: nothing more, as a controller switched off
        self.assertTrue(rb.RecordReplay.paced)

    def test_start_and_end_seconds_cut_the_record(self):
        rows = [(t, [1024 + t // 1000] * 6) for t in range(0, 10000, 250)]
        ck = FakeClock()
        r = rb.RecordReplay(self.write(rows), start_s=2, end_s=4, clock=ck.clock, sleep=ck.sleep)
        r.open()
        vals = []
        while True:
            v = r.read()
            if v is None:
                break
            vals.append(v[0])
        self.assertEqual(vals, [1026] * 4 + [1027] * 4)
        self.assertAlmostEqual(ck.now - 100.0, 1.75 + rb.POLL_S, places=6)
        with self.assertRaises(ValueError):
            rb.load_record(self.write(rows), 20, 30)

    def test_the_owner_session_replays_at_64_answers_a_second(self):
        rows = rb.load_record(OWNER, 150, 160)
        self.assertEqual(rows[0][0], 0)
        self.assertTrue(600 <= len(rows) <= 660, len(rows))  # 64 a second measured (docs/wip/connect.md)
        self.assertTrue(all(364 <= x <= 1684 for _, v in rows for x in v))

    def test_served_record_reaches_the_page_in_order(self):
        rows = [(i * 16, [1024 + i] + [1024] * 5) for i in range(40)]
        path = self.write(rows)
        b = rb.Bridge(lambda: rb.RecordReplay(path), port=0, log=lambda *_: None, dev=True)
        port = b.start()
        s, _, _ = handshake(port, "http://localhost:5390")
        try:
            recv_text(s)
            t0 = time.monotonic()
            msgs = [recv_text(s) for _ in range(41)]
            took = time.monotonic() - t0
        finally:
            s.close()
            b.stop()
        sent = [m["v"][0] for m in msgs if "v" in m]
        self.assertEqual(sent, [1024 + i for i in range(40)])
        self.assertGreaterEqual(took, 0.6)  # 39 gaps of 16 ms: paced, not sent at once


class Served(unittest.TestCase):
    def setUp(self):
        self.b = rb.Bridge(lambda: rb.Replay(REC, wiggle=True), port=0, log=lambda *_: None, dev=True)
        self.port = self.b.start()

    def tearDown(self):
        self.b.stop()

    def test_listens_on_loopback_only(self):
        self.assertEqual(self.b.sock.getsockname()[0], "127.0.0.1")

    def test_allowed_page_gets_hello_state_and_moving_values(self):
        s, head, key = handshake(self.port, "http://localhost:5390")
        try:
            self.assertIn("101 Switching Protocols", head)
            self.assertIn("Sec-WebSocket-Accept: " + rb.accept_key(key), head)
            self.assertEqual(recv_text(s)["hello"], "shramko-rc-bridge")
            msgs = [recv_text(s) for _ in range(40)]
            self.assertIn({"state": "reading"}, msgs)
            vals = [m["v"] for m in msgs if "v" in m]
            self.assertGreater(len(vals), 20)
            self.assertTrue(all(len(v) == 6 for v in vals))
            self.assertEqual(vals[0][2], 1024)  # throttle at rest, as recorded
            self.assertGreater(len({v[0] for v in vals}), 3)  # roll moves (wiggle)
        finally:
            s.close()

    def test_other_origin_and_host_are_refused(self):
        for origin, host in (("https://evil.example", None), ("http://localhost:5390", "evil.example:%d" % self.port)):
            s, head, _ = handshake(self.port, origin, host)
            s.close()
            self.assertIn("403 Forbidden", head)

    def test_a_long_or_data_frame_from_the_page_closes_it(self):
        # review RC2-R6: one frame announced as 2^40 bytes, then a text frame: each connection is closed at once
        s, _, _ = handshake(self.port, "https://gsfpv.flyreelstudio.eu")
        s.sendall(bytes([0x88, 0xFF]) + struct.pack(">Q", 1 << 40) + b"\0\0\0\0" + bytes(4096))
        self.assertTrue(closed_within(s, 3))
        s.close()
        s, _, _ = handshake(self.port, "https://gsfpv.flyreelstudio.eu")
        s.sendall(bytes([0x81, 0x82, 0, 0, 0, 0]) + b"hi")
        self.assertTrue(closed_within(s, 3))
        s.close()
        s, _, _ = handshake(self.port, "https://gsfpv.flyreelstudio.eu")  # control: a ping is answered, no close
        s.sendall(bytes([0x89, 0x80, 0, 0, 0, 0]))
        self.assertFalse(closed_within(s, 1))
        s.close()

    def test_a_page_that_stops_reading_does_not_stall_the_others(self):
        # review RC2-R5: fast polling fills the stalled page's buffers quickly; the reading page keeps getting values
        old = rb.POLL_S
        rb.POLL_S = 0
        try:
            stalled, _, _ = handshake(self.port, "https://gsfpv.flyreelstudio.eu", rcvbuf=4096)
            good, _, _ = handshake(self.port, "https://gsfpv.flyreelstudio.eu")
            good.settimeout(0.2)
            t0, late = time.monotonic(), 0
            while time.monotonic() - t0 < 4:
                try:
                    n = len(good.recv(65536))
                except socket.timeout:
                    n = 0
                if time.monotonic() - t0 > 2.5:
                    late += n
            stalled.close()
            good.close()
        finally:
            rb.POLL_S = old
        self.assertGreater(late, 10000)  # bytes in the last 1.5 s (the old bridge: 0 once the stalled page was full)

    def test_controller_let_go_when_the_page_leaves(self):
        s, _, _ = handshake(self.port, "https://gsfpv.flyreelstudio.eu")
        recv_text(s)
        recv_text(s)
        s.close()
        t0 = time.monotonic()
        while self.b.state is not None and time.monotonic() - t0 < 3:
            time.sleep(0.05)
        self.assertIsNone(self.b.state)

    def test_no_controller_is_said(self):
        self.b.stop()

        class Missing:
            def open(self):
                raise rb.Closed("no DJI RC 2")

            def close(self):
                pass
        self.b = rb.Bridge(Missing, port=0, log=lambda *_: None, dev=True)
        port = self.b.start()
        s, _, _ = handshake(port, "http://localhost")
        try:
            recv_text(s)
            self.assertEqual(recv_text(s), {"state": "no-controller", "why": "no DJI RC 2"})
        finally:
            s.close()

    def test_a_controller_that_stops_answering_is_said_lost(self):
        self.b.stop()
        closed = []

        class Silent:
            def open(self):
                pass

            def read(self):
                time.sleep(rb.REPLY_S)
                return None

            def close(self):
                closed.append(1)
        self.b = rb.Bridge(Silent, port=0, log=lambda *_: None, dev=True)
        port = self.b.start()
        s, _, _ = handshake(port, "http://localhost")
        s.settimeout(3)  # SILENT_S (1 s) and room
        try:
            recv_text(s)
            self.assertEqual(recv_text(s), {"state": "reading"})
            try:
                said = recv_text(s)
            except socket.timeout:
                said = None
            self.assertEqual(said, {"state": "no-controller", "why": "no answer"})
            self.assertTrue(closed)
        finally:
            s.close()


class Src:
    """A source for first_look: `answers` reads with nothing, then a stick answer; `fail` raises on open."""

    def __init__(self, answers=0, fail=None):
        self.answers, self.fail, self.reads, self.closed = answers, fail, 0, False

    def open(self):
        if self.fail:
            raise rb.Closed(self.fail)

    def read(self):
        self.reads += 1
        return [1024] * 6 if self.reads > self.answers else None

    def close(self):
        self.closed = True


class Start(unittest.TestCase):
    """C3: what the pilot reads in the helper's window at start and when the page connects."""

    def test_the_reasons_are_said_in_plain_words(self):
        said = {
            "libusb0_dji.dll of DJI Assistant 2 not found (use --dll)": "DJI Assistant 2 is not installed",
            "the stick channel is busy (close DJI Assistant 2 and try again): x": "close DJI Assistant 2",
            "no DJI controller (USB 2CA3:1021 or another DJI controller) on DJI's driver: x": "connect it with a data cable",
            "no answer": "switch it on",
            "this libusb0_dji.dll (x) does not have the layout the bridge was measured with": "not known to the helper",
            "usb_open: x": "unplug it and plug it in again",
        }
        for why, words in said.items():
            self.assertIn(words, rb.plain(why), why)
            self.assertNotIn("usb_", rb.plain(why))

    def test_first_look_reads_one_answer_and_lets_go(self):
        s = Src(answers=3)
        self.assertEqual(rb.first_look(lambda: s), (True, None))
        self.assertEqual(s.reads, 4)
        self.assertTrue(s.closed)

    def test_first_look_says_why_not(self):
        self.assertEqual(rb.first_look(lambda: Src(fail="no DJI controller (x)")), (False, "no DJI controller (x)"))
        s = Src(answers=99)
        self.assertEqual(rb.first_look(lambda: s, tries=5), (False, "no answer"))
        self.assertEqual(s.reads, 5)
        self.assertTrue(s.closed)

    def test_the_window_says_one_clear_line_when_the_page_reads_the_controller(self):
        said = []
        b = rb.Bridge(lambda: Src(), port=0, log=said.append, dev=True)
        b.set_state("reading")
        b.set_state("reading")
        b.set_state("no-controller", "the stick channel is busy (close DJI Assistant 2 and try again): x")
        self.assertEqual(said[0], rb.READ_LINE)
        self.assertEqual(len(said), 2)
        self.assertIn("close DJI Assistant 2", said[1])

    def test_the_program_says_at_start_that_the_controller_answers(self):
        import subprocess
        p = subprocess.Popen([sys.executable, "-X", "utf8", os.path.join(HERE, "rc_bridge.py"), "--replay", REC, "--port", "0"],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        import threading
        stop = threading.Timer(20, p.kill)  # a program that says less than three lines must fail, not hang
        stop.start()
        try:
            lines = [p.stdout.readline().strip() for _ in range(3)]
        finally:
            stop.cancel()
            p.kill()
            p.wait()
            p.stdout.close()
        self.assertTrue(lines[0].startswith("Shramko helper for DJI controllers on ws://127.0.0.1:"), lines)
        self.assertEqual(lines[1], "Your DJI controller answers. Now open the simulator and press 'Connect my controller'.")
        self.assertNotIn("bridge", " ".join(lines[1:]).lower())


@unittest.skipUnless(os.name == "nt", "start-dji-helper.cmd is a Windows file")
class StartCmd(unittest.TestCase):
    """start-dji-helper.cmd in a folder of its own, with APPDATA and LOCALAPPDATA in that folder too, so the
    "start with Windows" file never lands in the real Startup folder."""

    def run_cmd(self, path_env, answer, files=("start-dji-helper.cmd", "rc_bridge.py"), args=()):
        import shutil
        import subprocess
        import tempfile
        d = tempfile.mkdtemp(prefix="dji-helper-")
        self.addCleanup(shutil.rmtree, d, True)
        for f in files:
            shutil.copyfile(os.path.join(HERE, f), os.path.join(d, f))
        env = dict(os.environ, PATH=path_env, APPDATA=os.path.join(d, "roaming"), LOCALAPPDATA=os.path.join(d, "local"))
        os.makedirs(os.path.join(env["APPDATA"], "Microsoft", "Windows", "Start Menu", "Programs", "Startup"))
        r = subprocess.run(["cmd", "/c", os.path.join(d, "start-dji-helper.cmd")] + list(args), input=answer, env=env,
                           capture_output=True, text=True, timeout=60)
        return r.stdout + r.stderr, d, env

    def test_the_file_has_windows_line_ends(self):
        with open(os.path.join(HERE, "start-dji-helper.cmd"), "rb") as f:
            b = f.read()
        self.assertEqual(b.count(b"\n"), b.count(b"\r\n"))
        self.assertTrue(all(c < 128 for c in b))

    def test_no_python_says_how_to_get_it(self):
        sysdir = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
        stubs = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WindowsApps")  # the Store stubs, as on a clean Windows
        out, _, _ = self.run_cmd(sysdir + ";" + stubs, "N\n")
        self.assertIn("Python is not on this computer", out)
        self.assertIn("no administrator rights needed", out)
        self.assertIn("https://www.python.org/downloads/windows/", out)

    def test_a_missing_program_file_is_said(self):
        out, _, _ = self.run_cmd(os.environ["PATH"], "\n", files=("start-dji-helper.cmd",))
        self.assertIn("rc_bridge.py is not in this folder", out)

    def test_start_with_windows_is_offered_once_and_written_only_on_yes(self):
        startup = ("Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Shramko DJI helper.cmd")
        out, d, env = self.run_cmd(os.environ["PATH"], "N\n\n", args=("--replay", "missing.json"))
        self.assertIn("Start this helper by itself whenever Windows starts?", out)
        self.assertIn("The helper stopped", out)
        self.assertFalse(os.path.exists(os.path.join(env["APPDATA"], *startup)))
        out, d, env = self.run_cmd(os.environ["PATH"], "Y\n\n", args=("--replay", "missing.json"))
        self.assertIn("it starts with Windows from now on", out)
        with open(os.path.join(env["APPDATA"], *startup)) as f:
            self.assertIn('start-dji-helper.cmd" autostart', f.read())


if __name__ == "__main__":
    unittest.main()

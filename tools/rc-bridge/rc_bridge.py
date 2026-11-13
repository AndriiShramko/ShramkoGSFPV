"""Shramko RC bridge: the DJI RC 2's sticks for the simulator page, on Windows with no driver change.

On Windows the RC 2's stick channel (USB interface 0, class FF.43.01) belongs to DJI's own libusb0 driver once DJI
Assistant 2 is installed, so Chrome cannot open it over WebUSB. This program reads the sticks through DJI's own
64-bit libusb0_dji.dll (the stage 1 read of lane rc2, docs/wip/rc2.md) and serves the six raw values on a WebSocket:

    ws://127.0.0.1:47310/

* Bound to 127.0.0.1 only: nothing on the network can reach it.
* Only the pages https://gsfpv.flyreelstudio.eu and http://localhost[:port] may connect (the Origin header), and only
  under the Host 127.0.0.1:<port> or localhost:<port> (a page on another name that points at 127.0.0.1 is refused).
* Read-only towards the controller: the only frame ever sent to it is the DUML stick request (set 06, id 01, empty
  payload), the frame the reference github.com/rusty407/dji-rc2-linux-joystick sends. Nothing is written to it.
* The controller is opened only while a page is connected, and let go when the last page leaves.

Messages to the page (text, JSON):
    {"hello": "shramko-rc-bridge", "version": 1}       once, after the handshake
    {"state": "reading"}                               the controller answers
    {"state": "no-controller", "why": "..."}          not found, or it could not be opened (retried every 2 s)
    {"v": [roll, pitch, throttle, yaw, leftDial, rightDial]}   every stick answer, raw 364..1684, centre 1024

Usage:
    python rc_bridge.py [--port 47310] [--dll <libusb0_dji.dll>]
    python rc_bridge.py --replay <frames.json> [--wiggle]   (recorded frames of evidence/2026-11-13/rc2, no device)
Standard library only (Python 3.8 or newer).
"""
import argparse
import base64
import ctypes as C
import glob
import hashlib
import json
import math
import os
import socket
import struct
import sys
import threading
import time

PORT = 47310  # chosen for this bridge (unassigned by IANA); not a measured number
ALLOWED_ORIGINS = ("https://gsfpv.flyreelstudio.eu",)
ALLOWED_LOCAL_ORIGIN_HOSTS = ("localhost",)  # http://localhost and http://localhost:<port>
VID, PID = 0x2CA3, 0x1021
POLL_S = 0.01  # one request every 10 ms: the reference's default 100 Hz, not measured here
REPLY_S = 0.1  # a request with no answer after this is given up (stage 1 saw every answer within 100 ms)
RETRY_S = 2.0  # look for the controller again after this (estimate)
DEV_DESC_OFF = 1048  # usb_device.descriptor in libusb0_dji.dll 4.8.13 amd64, measured by layout_probe.py (stage 1)
BUS_DEVICES_OFF = 528  # usb_bus.devices in the same DLL, measured in stage 1
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"  # RFC 6455


# ---- DUML (the same frames as packages/input/src/dji-duml.ts) ----
def _table(poly):
    t = []
    for i in range(256):
        c = i
        for _ in range(8):
            c = (c >> 1) ^ poly if c & 1 else c >> 1
        t.append(c)
    return t


_CRC8 = _table(0x8C)
_CRC16 = _table(0x8408)


def crc8(b):
    c = 0x77
    for x in b:
        c = _CRC8[(x ^ c) & 0xFF]
    return c


def crc16(b):
    c = 0x3692
    for x in b:
        c = (c >> 8) ^ _CRC16[(x ^ c) & 0xFF]
    return c & 0xFFFF


def build(seq, sender=0x0A, receiver=0x06, typ=0x40, cset=0x06, cid=0x01, payload=b""):
    n = 13 + len(payload)
    b = bytearray(n)
    b[0] = 0x55
    struct.pack_into("<H", b, 1, n | (1 << 10))
    b[3] = crc8(b[:3])
    b[4], b[5] = sender, receiver
    struct.pack_into("<H", b, 6, seq & 0xFFFF)
    b[8], b[9], b[10] = typ, cset, cid
    b[11:11 + len(payload)] = payload
    struct.pack_into("<H", b, n - 2, crc16(b[:n - 2]))
    return bytes(b)


def parse(buf):
    """Whole frames out of `buf` (a bytearray, consumed); bad bytes are skipped one at a time."""
    out = []
    while buf:
        if buf[0] != 0x55:
            del buf[0]
            continue
        if len(buf) < 4:
            break
        if crc8(buf[:3]) != buf[3]:
            del buf[0]
            continue
        n = (buf[1] | (buf[2] << 8)) & 0x3FF
        if n < 13:
            del buf[0]
            continue
        if len(buf) < n:
            break
        if crc16(buf[:n - 2]) != (buf[n - 2] | (buf[n - 1] << 8)):
            del buf[0]
            continue
        out.append(bytes(buf[:n]))
        del buf[:n]
    return out


def stick_values(frame):
    """The six raw values of a stick reply (receiver 0x0a, response, set 06 id 01), else None."""
    if len(frame) < 13 or frame[5] != 0x0A or not frame[8] & 0x80 or frame[9] != 0x06 or frame[10] != 0x01:
        return None
    p = frame[11:-2]
    if len(p) < 18:
        return None
    return [struct.unpack_from("<H", p, o)[0] for o in (1, 4, 7, 10, 13, 16)]


# ---- sources of stick values ----
class Closed(Exception):
    pass


def find_dll():
    roots = [os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), os.environ.get("ProgramFiles", r"C:\Program Files")]
    for r in roots:
        for p in sorted(glob.glob(os.path.join(r, "DJI Product", "*", "Drivers", "Drivers_Other", "DJI_BULK", "amd64", "libusb0_dji.dll"))):
            return p
    return None


class DjiUsb:
    """The RC 2 through DJI's libusb0_dji.dll (64-bit). open() raises Closed with the reason when it cannot."""

    def __init__(self, dll):
        self.dll = dll
        self.L = None
        self.h = None
        self.seq = 1
        self.rx = bytearray()
        self.rbuf = C.create_string_buffer(16384)

    def _lib(self):
        if self.L:
            return self.L
        if not self.dll or not os.path.exists(self.dll):
            raise Closed("libusb0_dji.dll of DJI Assistant 2 not found (use --dll)")
        L = C.CDLL(self.dll)
        L.usb_get_busses.restype = C.c_void_p
        L.usb_open.restype = C.c_void_p
        L.usb_open.argtypes = [C.c_void_p]
        for f in ("usb_close", "usb_set_configuration", "usb_claim_interface", "usb_release_interface", "usb_bulk_write", "usb_bulk_read"):
            getattr(L, f).restype = C.c_int
        L.usb_close.argtypes = [C.c_void_p]
        L.usb_set_configuration.argtypes = [C.c_void_p, C.c_int]
        L.usb_claim_interface.argtypes = [C.c_void_p, C.c_int]
        L.usb_release_interface.argtypes = [C.c_void_p, C.c_int]
        L.usb_bulk_write.argtypes = [C.c_void_p, C.c_int, C.c_char_p, C.c_int, C.c_int]
        L.usb_bulk_read.argtypes = [C.c_void_p, C.c_int, C.c_char_p, C.c_int, C.c_int]
        L.usb_strerror.restype = C.c_char_p
        L.usb_init()
        self.L = L
        return L

    def open(self):
        L = self._lib()
        L.usb_find_busses()
        L.usb_find_devices()
        bus, dev = L.usb_get_busses(), None
        while bus and dev is None:
            d = C.c_void_p.from_address(bus + BUS_DEVICES_OFF).value
            while d:
                vid, pid = struct.unpack_from("<HH", C.string_at(d + DEV_DESC_OFF, 18), 8)
                if (vid, pid) == (VID, PID):
                    dev = d
                    break
                d = C.c_void_p.from_address(d).value  # usb_device.next
            bus = C.c_void_p.from_address(bus).value  # usb_bus.next
        if dev is None:
            raise Closed("no DJI RC 2 (USB 2CA3:1021) on DJI's driver: plug it in with a data cable and switch it on")
        h = L.usb_open(dev)
        if not h:
            raise Closed("usb_open: " + L.usb_strerror().decode(errors="replace"))
        if L.usb_set_configuration(h, 1) < 0 or L.usb_claim_interface(h, 0) < 0:
            why = L.usb_strerror().decode(errors="replace")
            L.usb_close(h)
            raise Closed("the stick channel is busy (close DJI Assistant 2 and try again): " + why)
        self.h = h
        self.rx = bytearray()

    def read(self):
        """Ask once; the six values of the answer, or None when none came within REPLY_S."""
        L, h = self.L, self.h
        want = self.seq
        pkt = build(want)
        self.seq = (self.seq + 1) & 0xFFFF
        if L.usb_bulk_write(h, 0x01, pkt, len(pkt), 200) < 0:
            raise Closed("write: " + L.usb_strerror().decode(errors="replace"))
        t0 = time.monotonic()
        while time.monotonic() - t0 < REPLY_S:
            k = L.usb_bulk_read(h, 0x81, self.rbuf, 16384, 20)
            if k <= 0:
                continue
            self.rx += self.rbuf.raw[:k]
            for f in parse(self.rx):
                v = stick_values(f)
                if v and struct.unpack_from("<H", f, 6)[0] == want:
                    return v
        return None

    def close(self):
        if self.h:
            self.L.usb_release_interface(self.h, 0)
            self.L.usb_close(self.h)
            self.h = None


class Replay:
    """Recorded frames (evidence/2026-11-13/rc2/frames-rest*.json) played in a loop; --wiggle moves roll slowly."""

    def __init__(self, path, wiggle=False):
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        self.values = []
        for fr in doc["frames"]:
            for raw in parse(bytearray(bytes.fromhex(fr["hex"]))):
                v = stick_values(raw)
                if v:
                    self.values.append(v)
        if not self.values:
            raise ValueError("no stick replies in " + path)
        self.wiggle = wiggle
        self.i = 0
        self.t0 = time.monotonic()

    def open(self):
        self.i = 0

    def read(self):
        v = list(self.values[self.i % len(self.values)])
        self.i += 1
        if self.wiggle:  # 0.5 Hz, 300 of the 660 per side (a visible move on the check screen)
            v[0] = int(1024 + 300 * math.sin((time.monotonic() - self.t0) * math.pi))
        return v

    def close(self):
        pass


# ---- WebSocket (RFC 6455, the subset a browser client needs) ----
def accept_key(key):
    return base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()


def origin_allowed(origin):
    if origin in ALLOWED_ORIGINS:
        return True
    if origin.startswith("http://"):
        host = origin[len("http://"):]
        name, _, port = host.partition(":")
        return name in ALLOWED_LOCAL_ORIGIN_HOSTS and (port == "" or (port.isdigit() and len(port) <= 5))
    return False


def host_allowed(host, port):
    return host in ("127.0.0.1:%d" % port, "localhost:%d" % port)


def frame(text, opcode=1):
    data = text.encode() if isinstance(text, str) else text
    n = len(data)
    head = bytes([0x80 | opcode]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack(">H", n) if n < 65536 else bytes([127]) + struct.pack(">Q", n))
    return head + data


def read_request(conn):
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(4096)
        if not chunk:
            return None, {}
        data += chunk
        if len(data) > 16384:
            return None, {}
    lines = data.split(b"\r\n\r\n", 1)[0].decode("latin-1").split("\r\n")
    headers = {}
    for ln in lines[1:]:
        k, _, v = ln.partition(":")
        headers[k.strip().lower()] = v.strip()
    return lines[0], headers


class Bridge:
    def __init__(self, source_factory, port=PORT, log=lambda s: print(s, flush=True)):
        self.source_factory = source_factory
        self.port = port
        self.log = log
        self.clients = set()
        self.lock = threading.Lock()
        self.stopped = threading.Event()
        self.sock = None
        self.state = None

    # -- clients --
    def send_all(self, msg):
        data = frame(json.dumps(msg, separators=(",", ":")))
        with self.lock:
            dead = []
            for c in self.clients:
                try:
                    c.sendall(data)
                except OSError:
                    dead.append(c)
            for c in dead:
                self.clients.discard(c)

    def set_state(self, state, why=None):
        if state != self.state:
            self.state = state
            self.log("controller: %s%s" % (state, " (" + why + ")" if why else ""))
        msg = {"state": state}
        if why:
            msg["why"] = why
        self.send_all(msg)

    def handle(self, conn):
        try:
            conn.settimeout(5)
            line, hd = read_request(conn)
            origin = hd.get("origin", "")
            ok = (line is not None and line.startswith("GET / ") and hd.get("upgrade", "").lower() == "websocket"
                  and "sec-websocket-key" in hd and origin_allowed(origin) and host_allowed(hd.get("host", ""), self.port))
            if not ok:
                conn.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                self.log("refused a connection from origin %r" % origin[:80])
                conn.close()
                return
            conn.sendall(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          "Sec-WebSocket-Accept: %s\r\n\r\n" % accept_key(hd["sec-websocket-key"])).encode())
            conn.sendall(frame(json.dumps({"hello": "shramko-rc-bridge", "version": 1})))
            conn.settimeout(None)
            with self.lock:
                self.clients.add(conn)
            self.log("page connected: %s" % origin)
            self.client_loop(conn)
        except OSError:
            pass
        finally:
            with self.lock:
                self.clients.discard(conn)
            try:
                conn.close()
            except OSError:
                pass

    def client_loop(self, conn):
        """Reads the page's frames: close and ping only (the page sends nothing else)."""
        buf = b""
        while not self.stopped.is_set():
            chunk = conn.recv(4096)
            if not chunk:
                return
            buf += chunk
            while len(buf) >= 2:
                op, n, at = buf[0] & 0x0F, buf[1] & 0x7F, 2
                if n == 126:
                    if len(buf) < 4:
                        break
                    n, at = struct.unpack(">H", buf[2:4])[0], 4
                elif n == 127:
                    if len(buf) < 10:
                        break
                    n, at = struct.unpack(">Q", buf[2:10])[0], 10
                masked = buf[1] & 0x80
                if len(buf) < at + (4 if masked else 0) + n:
                    break
                mask = buf[at:at + 4] if masked else b"\0\0\0\0"
                at += 4 if masked else 0
                body = bytes(b ^ mask[i % 4] for i, b in enumerate(buf[at:at + n]))
                buf = buf[at + n:]
                with self.lock:
                    if op == 8:
                        conn.sendall(frame(body[:2], 8))
                        return
                    if op == 9:
                        conn.sendall(frame(body, 10))

    # -- the controller --
    def read_loop(self):
        src = None
        while not self.stopped.is_set():
            with self.lock:
                wanted = bool(self.clients)
            if not wanted:
                if src:
                    src.close()
                    src = None
                    self.state = None
                    self.log("controller let go (no page connected)")
                time.sleep(0.2)
                continue
            if src is None:
                s = self.source_factory()
                try:
                    s.open()
                    src = s
                    self.set_state("reading")
                except Closed as e:
                    self.set_state("no-controller", str(e))
                    self.stopped.wait(RETRY_S)
                    continue
            t0 = time.monotonic()
            try:
                v = src.read()
            except Closed as e:
                src.close()
                src = None
                self.set_state("no-controller", str(e))
                continue
            if v:
                self.send_all({"v": v})
            left = POLL_S - (time.monotonic() - t0)
            if left > 0:
                time.sleep(left)
        if src:
            src.close()

    def start(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.bind(("127.0.0.1", self.port))
        self.port = self.sock.getsockname()[1]
        self.sock.listen(8)
        threading.Thread(target=self.read_loop, daemon=True).start()
        threading.Thread(target=self.accept_loop, daemon=True).start()
        return self.port

    def accept_loop(self):
        while not self.stopped.is_set():
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self.handle, args=(conn,), daemon=True).start()

    def stop(self):
        self.stopped.set()
        try:
            self.sock.close()
        except OSError:
            pass
        with self.lock:
            for c in list(self.clients):
                try:
                    c.close()
                except OSError:
                    pass
            self.clients.clear()


def main(argv=None):
    ap = argparse.ArgumentParser(description="Shramko RC bridge: DJI RC 2 sticks on ws://127.0.0.1 for the simulator page")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--dll", default=None, help="DJI's 64-bit libusb0_dji.dll (default: found under DJI Product)")
    ap.add_argument("--replay", default=None, help="recorded frames JSON instead of the controller")
    ap.add_argument("--wiggle", action="store_true", help="with --replay: move roll slowly")
    a = ap.parse_args(argv)
    if a.replay:
        factory = lambda: Replay(a.replay, a.wiggle)  # noqa: E731
        what = "replay of " + a.replay
    else:
        if struct.calcsize("P") != 8:
            sys.exit("Use 64-bit Python: DJI's libusb0_dji.dll in the amd64 folder is 64-bit.")
        dll = a.dll or find_dll()
        factory = lambda: DjiUsb(dll)  # noqa: E731
        what = "DJI RC 2 through " + str(dll)
    b = Bridge(factory, a.port)
    port = b.start()
    print("Shramko RC bridge on ws://127.0.0.1:%d/ (%s)." % (port, what))
    print("Open the simulator, Controls, 'My controller is not in the list', 'Fly through the RC bridge'. Ctrl+C stops.")
    sys.stdout.flush()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        b.stop()


if __name__ == "__main__":
    main()

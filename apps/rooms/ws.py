"""RFC 6455 WebSocket framing for the rooms service: Python stdlib only, asyncio, no extensions.

Server side: `handshake_reply(headers)` checks an upgrade request and gives the 101 answer; `ServerSocket` reads
masked client frames (text, binary, ping, pong, close, continuation) and writes unmasked server frames.
Client side (tests and the load script): `client_request`, `check_accept`, `encode_frame(..., mask=True)`.
Messages are at most MAX_MESSAGE bytes (one frame or the sum of its fragments); larger ones close with 1009.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import struct

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"  # RFC 6455 section 1.3
MAX_MESSAGE = 64 * 1024  # bytes; rooms-plan.md 2.1 ("64 KB max message"); a pose is 36 B, a hello under 1 KB

OP_CONT, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA
CONTROL = (OP_CLOSE, OP_PING, OP_PONG)

# close codes (RFC 6455 7.4.1)
NORMAL, GOING_AWAY, PROTOCOL_ERROR, BAD_DATA, POLICY, TOO_BIG = 1000, 1001, 1002, 1007, 1008, 1009


class WsError(Exception):
    def __init__(self, code: int, reason: str = ""):
        super().__init__(reason or str(code))
        self.code, self.reason = code, reason


def accept_key(key: str) -> str:
    """Sec-WebSocket-Accept for a Sec-WebSocket-Key (RFC 6455 4.2.2 item 5.4)."""
    return base64.b64encode(hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")


def check_accept(key: str, accept: str | None) -> bool:
    """The client's check of the server's answer: anything but the exact value means no connection."""
    return accept is not None and accept.strip() == accept_key(key)


def _valid_key(key: str | None) -> bool:
    if not key:
        return False
    try:
        return len(base64.b64decode(key.strip(), validate=True)) == 16
    except (ValueError, TypeError):
        return False


def handshake_reply(method: str, headers: dict[str, str]) -> bytes | None:
    """The 101 answer for a valid upgrade request (header names lower case), or None when it is not one."""
    if method != "GET":
        return None
    if headers.get("upgrade", "").strip().lower() != "websocket":
        return None
    if "upgrade" not in [t.strip().lower() for t in headers.get("connection", "").split(",")]:
        return None
    if headers.get("sec-websocket-version", "").strip() != "13":
        return None
    key = headers.get("sec-websocket-key")
    if not _valid_key(key):
        return None
    return ("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept_key(key.strip())}\r\n\r\n").encode("ascii")


def client_request(host: str, path: str, key: str | None = None, extra: dict[str, str] | None = None) -> tuple[bytes, str]:
    """An upgrade request and its key (a client in tests and in the load script)."""
    key = key or base64.b64encode(os.urandom(16)).decode("ascii")
    more = "".join(f"{k}: {v}\r\n" for k, v in (extra or {}).items())
    req = (f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n{more}\r\n")
    return req.encode("ascii"), key


def encode_frame(opcode: int, payload: bytes, mask: bool = False, fin: bool = True) -> bytes:
    """One frame; clients mask (RFC 6455 5.3), the server never does."""
    n = len(payload)
    head = bytes([(0x80 if fin else 0) | opcode])
    mbit = 0x80 if mask else 0
    if n < 126:
        head += bytes([mbit | n])
    elif n < 65536:
        head += bytes([mbit | 126]) + struct.pack(">H", n)
    else:
        head += bytes([mbit | 127]) + struct.pack(">Q", n)
    if not mask:
        return head + payload
    key = os.urandom(4)
    return head + key + apply_mask(payload, key)


def apply_mask(data: bytes, key: bytes) -> bytes:
    if not data:
        return b""
    n = len(data)
    k = (key * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "little") ^ int.from_bytes(k, "little")).to_bytes(n, "little")


def close_payload(code: int, reason: str = "") -> bytes:
    return struct.pack(">H", code) + reason.encode("utf-8")[:120]


async def read_frame(reader: asyncio.StreamReader, require_mask: bool, max_size: int = MAX_MESSAGE) -> tuple[bool, int, bytes]:
    """(fin, opcode, payload) of one frame. Raises WsError on a protocol fault, IncompleteReadError at EOF."""
    b0, b1 = await reader.readexactly(2)
    fin, rsv, opcode = bool(b0 & 0x80), b0 & 0x70, b0 & 0x0F
    masked, n = bool(b1 & 0x80), b1 & 0x7F
    if rsv:
        raise WsError(PROTOCOL_ERROR, "no extensions")
    if opcode not in (OP_CONT, OP_TEXT, OP_BINARY) + CONTROL:
        raise WsError(PROTOCOL_ERROR, "opcode")
    if masked != require_mask:
        raise WsError(PROTOCOL_ERROR, "mask")
    if n == 126:
        n = struct.unpack(">H", await reader.readexactly(2))[0]
    elif n == 127:
        n = struct.unpack(">Q", await reader.readexactly(8))[0]
    if opcode in CONTROL and (n > 125 or not fin):
        raise WsError(PROTOCOL_ERROR, "control frame")
    if n > max_size:
        raise WsError(TOO_BIG, "too big")
    key = await reader.readexactly(4) if masked else b""
    data = await reader.readexactly(n) if n else b""
    return fin, opcode, apply_mask(data, key) if masked else data


class ServerSocket:
    """One accepted WebSocket. `recv()` gives the next text or binary message ((opcode, bytes)), answers pings,
    and returns None after a close (the close is echoed). Writes never wait: `buffered()` is what the kernel has
    not taken yet, so the room can skip a slow reader instead of queueing for it."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, max_size: int = MAX_MESSAGE):
        self.reader, self.writer, self.max_size = reader, writer, max_size
        self.closed = False
        self.close_code: int | None = None

    def buffered(self) -> int:
        t = self.writer.transport
        return 0 if t is None or t.is_closing() else t.get_write_buffer_size()

    def _write(self, frame: bytes) -> None:
        if not self.closed and not self.writer.transport.is_closing():
            self.writer.write(frame)

    def send_text(self, text: str) -> None:
        self._write(encode_frame(OP_TEXT, text.encode("utf-8")))

    def send_binary(self, data: bytes) -> None:
        self._write(encode_frame(OP_BINARY, data))

    def close(self, code: int = NORMAL, reason: str = "") -> None:
        if self.closed:
            return
        self._write(encode_frame(OP_CLOSE, close_payload(code, reason)))
        self.closed, self.close_code = True, code
        try:
            self.writer.close()
        except OSError:
            pass

    async def recv(self) -> tuple[int, bytes] | None:
        parts: list[bytes] = []
        first = 0
        size = 0
        while not self.closed:
            try:
                fin, op, data = await read_frame(self.reader, require_mask=True, max_size=self.max_size)
            except WsError as e:
                self.close(e.code, e.reason)
                return None
            except (asyncio.IncompleteReadError, ConnectionError, OSError):
                self.closed = True
                self.writer.close()
                return None
            if op == OP_PING:
                self._write(encode_frame(OP_PONG, data))
                continue
            if op == OP_PONG:
                continue
            if op == OP_CLOSE:
                code = struct.unpack(">H", data[:2])[0] if len(data) >= 2 else NORMAL
                self.close(code if 1000 <= code < 5000 and code not in (1005, 1006, 1015) else PROTOCOL_ERROR)
                return None
            if op == OP_CONT and not parts:
                self.close(PROTOCOL_ERROR, "continuation")
                return None
            if op != OP_CONT and parts:
                self.close(PROTOCOL_ERROR, "interleaved")
                return None
            if op != OP_CONT:
                first = op
            size += len(data)
            if size > self.max_size:
                self.close(TOO_BIG, "too big")
                return None
            parts.append(data)
            if fin:
                msg = b"".join(parts)
                if first == OP_TEXT:
                    try:
                        msg.decode("utf-8")
                    except UnicodeDecodeError:
                        self.close(BAD_DATA, "utf-8")
                        return None
                return first, msg
        return None

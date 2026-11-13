"""RFC 6455 framing and handshake (apps/rooms/ws.py)."""
from __future__ import annotations

import asyncio
import socket
import threading
import unittest

from helpers import W, Client, HandshakeRejected, ServiceThread

# RFC 6455 section 1.3: the key of the example and the answer it must get
RFC_KEY, RFC_ACCEPT = "dGhlIHNhbXBsZSBub25jZQ==", "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="


class Handshake(unittest.TestCase):
    def test_the_rfc_test_vector(self):
        self.assertEqual(W.accept_key(RFC_KEY), RFC_ACCEPT)
        reply = W.handshake_reply("GET", {"upgrade": "websocket", "connection": "keep-alive, Upgrade",
                                          "sec-websocket-version": "13", "sec-websocket-key": RFC_KEY})
        self.assertIn(f"Sec-WebSocket-Accept: {RFC_ACCEPT}\r\n".encode(), reply)
        self.assertTrue(reply.startswith(b"HTTP/1.1 101 "))

    def test_control_a_wrong_accept_is_rejected_by_the_client(self):
        self.assertTrue(W.check_accept(RFC_KEY, RFC_ACCEPT))
        self.assertFalse(W.check_accept(RFC_KEY, "s3pPLMBiTxaQ9kYGzzhZRbK+xOx="))
        self.assertFalse(W.check_accept(RFC_KEY, None))

    def test_control_a_server_with_a_wrong_accept_gets_no_connection(self):
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        port = srv.getsockname()[1]

        def liar():
            c, _ = srv.accept()
            c.recv(4096)
            c.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      b"Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n")
            c.close()

        t = threading.Thread(target=liar, daemon=True)
        t.start()
        with self.assertRaises(HandshakeRejected):
            Client(port)
        t.join(5)
        srv.close()

    def test_requests_that_are_not_upgrades_get_no_101(self):
        ok = {"upgrade": "websocket", "connection": "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": RFC_KEY}
        self.assertIsNotNone(W.handshake_reply("GET", ok))
        for change in ({"upgrade": "h2c"}, {"connection": "keep-alive"}, {"sec-websocket-version": "8"},
                       {"sec-websocket-key": "short"}, {"sec-websocket-key": ""}):
            self.assertIsNone(W.handshake_reply("GET", {**ok, **change}), change)
        self.assertIsNone(W.handshake_reply("POST", ok))


class Frames(unittest.TestCase):
    def _read(self, raw: bytes, require_mask: bool = True, max_size: int = W.MAX_MESSAGE):
        async def go():
            r = asyncio.StreamReader()
            r.feed_data(raw)
            r.feed_eof()
            return await W.read_frame(r, require_mask, max_size)
        return asyncio.run(go())

    def test_masked_frames_of_each_length_form_round_trip(self):
        for n in (0, 1, 125, 126, 65535, 65536):
            data = bytes(i % 251 for i in range(n))
            fin, op, got = self._read(W.encode_frame(W.OP_BINARY, data, mask=True), max_size=1 << 20)
            self.assertEqual((fin, op, got), (True, W.OP_BINARY, data), n)

    def test_an_unmasked_client_frame_is_a_protocol_error(self):
        with self.assertRaises(W.WsError) as e:
            self._read(W.encode_frame(W.OP_TEXT, b"hi", mask=False))
        self.assertEqual(e.exception.code, W.PROTOCOL_ERROR)

    def test_a_message_above_64_kb_closes_with_1009(self):
        self._read(W.encode_frame(W.OP_BINARY, bytes(W.MAX_MESSAGE), mask=True))
        with self.assertRaises(W.WsError) as e:
            self._read(W.encode_frame(W.OP_BINARY, bytes(W.MAX_MESSAGE + 1), mask=True))
        self.assertEqual(e.exception.code, W.TOO_BIG)

    def test_extensions_and_long_control_frames_are_refused(self):
        rsv = bytearray(W.encode_frame(W.OP_TEXT, b"x", mask=True))
        rsv[0] |= 0x40
        for raw in (bytes(rsv), W.encode_frame(W.OP_PING, bytes(126), mask=True),
                    W.encode_frame(W.OP_PING, b"x", mask=True, fin=False)):
            with self.assertRaises(W.WsError):
                self._read(raw)


class LiveSocket(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.t = ServiceThread()

    @classmethod
    def tearDownClass(cls):
        cls.t.stop()

    def test_ping_gets_pong_and_close_is_echoed(self):
        c = Client(self.t.port)
        c.send(W.OP_PING, b"abc")
        self.assertEqual(c.recv(), (W.OP_PONG, b"abc"))
        c.send(W.OP_CLOSE, W.close_payload(W.NORMAL))
        op, data = c.recv()
        self.assertEqual(op, W.OP_CLOSE)
        c.close()

    def test_fragments_are_joined_into_one_message(self):
        c = Client(self.t.port)
        c.sock.sendall(W.encode_frame(W.OP_TEXT, b'{"type":"he', mask=True, fin=False)
                       + W.encode_frame(W.OP_PING, b"p", mask=True)
                       + W.encode_frame(W.OP_CONT, b'llo","v":"rooms/0"}', mask=True))
        self.assertEqual(c.recv(), (W.OP_PONG, b"p"))
        self.assertEqual(c.next_json(), {"type": "error", "code": "version"})
        c.close()

    def test_a_plain_get_on_the_socket_route_is_refused(self):
        from helpers import http
        code, got = http(self.t.port, "GET", "/api/rooms/ws")
        self.assertEqual((code, got), (400, {"error": "upgrade"}))


if __name__ == "__main__":
    unittest.main()

"""The binary layouts, the shared fixtures, and the validators of what a pilot sends (apps/rooms/protocol.py)."""
from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

from helpers import FIXTURES, P

API = Path(__file__).resolve().parents[2] / "api"


def hand_pose() -> bytes:
    """The 36 bytes of one pose written field by field without the struct format of protocol.py."""
    le = lambda v, n, s=False: int(v).to_bytes(n, "little", signed=s)  # noqa: E731
    out = le(1, 1) + le(1 | 8, 1) + le(513, 2) + le(70000, 4)
    out += struct.pack("<f", 10.0) + struct.pack("<f", 0.5) + struct.pack("<f", -20.0)
    out += le(16384, 2, True) + le(-16384, 2, True) + le(0, 2, True) + le(32767, 2, True)
    out += le(321, 2, True) + le(-50, 2, True) + le(-1234, 2, True) + le(49151, 2)
    return out


class Layout(unittest.TestCase):
    def test_a_pose_is_36_bytes_and_a_snapshot_6_plus_37_each(self):
        self.assertEqual(P.POSE_BYTES, 36)
        self.assertEqual(len(P.encode_snapshot(1, [(0, bytes([1]) + bytes(35))] * 3)), 6 + 3 * 37)

    def test_field_order_matches_bytes_written_by_hand(self):
        p = {"flags": 9, "seq": 513, "tick": 70000, "pos": [10.0, 0.5, -20.0],
             "quat": [16384 / 32767, -16384 / 32767, 0, 1], "vel": [3.21, -0.5, -12.34], "throttle": 49151 / 65535}
        self.assertEqual(P.encode_pose(p), hand_pose())

    def test_control_x_and_z_swapped_is_caught(self):
        p = {"flags": 9, "seq": 513, "tick": 70000, "pos": [-20.0, 0.5, 10.0],
             "quat": [16384 / 32767, -16384 / 32767, 0, 1], "vel": [3.21, -0.5, -12.34], "throttle": 49151 / 65535}
        self.assertNotEqual(P.encode_pose(p), hand_pose())

    def test_out_of_range_values_are_clamped_not_wrapped(self):
        d = P.decode_pose(P.encode_pose({"seq": 1, "tick": 1, "pos": [0, 0, 0], "quat": [2, -2, 0, 1],
                                         "vel": [999, -999, 0], "throttle": 1.5}))
        self.assertEqual(d["raw"]["quat"][:2], [32767, -32768])
        self.assertEqual(d["raw"]["vel"][:2], [32767, -32768])
        self.assertEqual(d["raw"]["throttle"], 65535)

    def test_only_36_byte_kind_1_messages_are_poses(self):
        good = P.encode_pose({"seq": 1, "tick": 1, "pos": [0, 0, 0], "quat": [0, 0, 0, 1], "vel": [0, 0, 0], "throttle": 0})
        self.assertTrue(P.is_pose(good))
        self.assertFalse(P.is_pose(good[:-1]))
        self.assertFalse(P.is_pose(b"\x02" + good[1:]))


class Fixtures(unittest.TestCase):
    """The files the TypeScript codec of stage R2 reads: each hex decodes to its value and the value encodes back."""

    def test_pose_fixtures(self):
        f = json.loads((FIXTURES / "pose.json").read_text(encoding="utf-8"))
        self.assertEqual(f["version"], P.VERSION)
        self.assertGreaterEqual(len(f["cases"]), 4)
        for c in f["cases"]:
            b = bytes.fromhex(c["hex"])
            self.assertEqual(len(b), 36, c["name"])
            self.assertEqual(P.decode_pose(b), c["value"], c["name"])
            self.assertEqual(P.encode_pose(c["value"]).hex(), c["hex"], c["name"])

    def test_snapshot_fixtures(self):
        f = json.loads((FIXTURES / "snapshot.json").read_text(encoding="utf-8"))
        for c in f["cases"]:
            b = bytes.fromhex(c["hex"])
            self.assertEqual(P.decode_snapshot(b), c["value"], c["name"])
            back = P.encode_snapshot(c["value"]["serverMs"], [(m["slot"], P.encode_pose(m["pose"])) for m in c["value"]["members"]])
            self.assertEqual(back.hex(), c["hex"], c["name"])


class Names(unittest.TestCase):
    def test_nicknames_by_the_rule(self):
        for ok in ("Ala", "Jan Kowalski", "O'Brien-2", "pilot_07", "\u0410\u043d\u0434\u0440\u0456\u0439", "\u0141\u00f3d\u017a FPV"):
            self.assertEqual(P.clean_nick(ok), ok, ok)
        self.assertEqual(P.clean_nick("  Ala  "), "Ala")
        self.assertEqual(P.clean_nick("e\u0301cole"), "\u00e9cole")  # NFC
        for bad in ("A", "x" * 21, "http://x", "www.site", "a\u0000b", "a\nb", "<b>hi</b>", "Admin", "Mod-er.ator",
                    "GSFPV team", "--", None, 42, "a\u202eb"):
            self.assertIsNone(P.clean_nick(bad), repr(bad))

    def test_room_names_allow_40(self):
        self.assertEqual(P.clean_text("x" * 40, *P.NAME_LEN), "x" * 40)
        self.assertIsNone(P.clean_text("x" * 41, *P.NAME_LEN))


class RoomRequest(unittest.TestCase):
    def test_the_scene_is_required(self):
        for bad in (None, {}, {"scene": "39e63ce9"}, {"scene": {"id": "XYZ"}}, {"scene": {"id": "39e6"}}, []):
            self.assertIsNone(P.room_request(bad), repr(bad))

    def test_optional_fields_are_kept_cleaned_or_dropped(self):
        r = P.room_request({"scene": {"id": "39e63ce9", "render": {"budgetM": 4, "stochastic": True, "x": 1}},
                            "name": "Evening", "listed": True, "course": "g1.12345",
                            "shared": {"size": 2.5, "walls": "on", "wind": "off", "bogus": 1}, "extra": 1})
        self.assertEqual(r, {"scene": {"id": "39e63ce9", "render": {"budgetM": 4.0, "stochastic": True}}, "name": "Evening",
                             "listed": True, "course": "g1.12345", "shared": {"size": 2.5, "walls": "on", "wind": "off"}})
        r = P.room_request({"scene": {"id": "39e63ce9"}, "name": "<script>", "listed": "yes", "course": "a b",
                            "shared": {"size": 1000}})
        self.assertRegex(r.pop("name"), r"^Room-\d{4}$")  # a refused name falls back (review RV-4)
        self.assertEqual(r, {"scene": {"id": "39e63ce9"}, "listed": False})

    def test_the_port_answers_as_the_api_does(self):
        """protocol.shared_settings and link_render are a port of apps/api/server.py: the same answers on the same input."""
        sys.path.insert(0, str(API))
        import server  # noqa: E402
        rows = [None, {}, {"size": 0.2}, {"size": 0.25}, {"size": 100}, {"size": 100.0004}, {"size": 2.0005},
                {"size": True}, {"size": "2"}, {"walls": "on"}, {"walls": "yes"}, {"floaters": 64}, {"floaters": 65},
                {"floaters": True}, {"wind": "off"}, {"wind": {"fromDeg": 90, "speed": 5.05, "gust": 1}},
                {"wind": {"fromDeg": 90, "speed": 31, "gust": 1}}, {"ceiling": "off"}, {"ceiling": -6749.125},
                {"ceiling": 10001}, {"drone": "5in-freestyle"}, {"drone": "-x"}, {"drone": "A"},
                {"size": float("nan")}, {"size": 3, "walls": "off", "floaters": 3, "ceiling": 12.345, "drone": "tiny"}]
        for row in rows:
            self.assertEqual(P.shared_settings(row), server.shared_settings(row), repr(row))
        for r in (None, {"budgetM": 0.24}, {"budgetM": 32}, {"budgetM": 1.23456}, {"stochastic": False}, {"budgetM": True}):
            self.assertEqual(P.link_render(r), server.link_render(r), repr(r))


if __name__ == "__main__":
    unittest.main()

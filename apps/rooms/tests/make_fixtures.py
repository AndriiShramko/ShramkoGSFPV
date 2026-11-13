"""Writes tests/fixtures/pose.json and snapshot.json: the bytes (hex) and the decoded value of each case.
The TypeScript codec (apps/fly/src/rooms/codec.ts, stage R2) and tests/test_protocol.py read them.
  python -X utf8 apps/rooms/tests/make_fixtures.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import protocol as P  # noqa: E402

OUT = Path(__file__).resolve().parent / "fixtures"

POSES = [
    ("hover-armed", {"flags": P.FLAG_ARMED, "seq": 1, "tick": 480, "pos": [1.5, 2.25, -3.0], "quat": [0, 0, 0, 1],
                     "vel": [0, 0, 0], "throttle": 0.5}),
    ("x-and-z-differ", {"flags": P.FLAG_ARMED | P.FLAG_IN_RACE, "seq": 2, "tick": 484, "pos": [10.0, 0.5, -20.0],
                        "quat": [0.5, -0.5, 0.5, 0.5], "vel": [3.21, -0.5, -12.34], "throttle": 0.75}),
    ("crashed-paused", {"flags": P.FLAG_CRASHED | P.FLAG_PAUSED, "seq": 65535, "tick": 4294967295,
                        "pos": [-123.456, 78.9, 0.001], "quat": [0.7071068, 0, 0, 0.7071068], "vel": [0, -9.81, 0],
                        "throttle": 0.0}),
    ("clamped", {"flags": 15, "seq": 7, "tick": 1000, "pos": [1e6, -1e6, 3.4e38], "quat": [-1, 1, -1, 1],
                 "vel": [400.0, -400.0, 327.67], "throttle": 1.0}),
]


def main() -> None:
    OUT.mkdir(exist_ok=True)
    cases = []
    for name, p in POSES:
        b = P.encode_pose(p)
        cases.append({"name": name, "hex": b.hex(), "value": P.decode_pose(b)})
    layout = "u8 kind=1, u8 flags (1 armed, 2 crashed, 4 paused, 8 in race), u16 seq, u32 tick, f32 x3 pos (m), " \
             "i16 x4 quat x y z w (/32767), i16 x3 vel (cm/s), u16 throttle (/65535); little-endian, 36 bytes"
    (OUT / "pose.json").write_text(json.dumps({"version": P.VERSION, "layout": layout, "cases": cases}, indent=1) + "\n",
                                   encoding="utf-8", newline="\n")
    snaps = []
    for name, ms, slots in (("two-members", 123456, [0, 3]), ("empty", 0, []), ("full-room-wraps-ms", 4294967295, list(range(8)))):
        poses = [(s, P.encode_pose(POSES[s % len(POSES)][1])) for s in slots]
        b = P.encode_snapshot(ms, poses)
        snaps.append({"name": name, "hex": b.hex(), "value": P.decode_snapshot(b)})
    layout = "u8 kind=2, u32 serverMs, u8 count, then count x (u8 slot + 36-byte pose); little-endian"
    (OUT / "snapshot.json").write_text(json.dumps({"version": P.VERSION, "layout": layout, "cases": snaps}, indent=1) + "\n",
                                       encoding="utf-8", newline="\n")
    print(f"wrote {len(cases)} poses, {len(snaps)} snapshots to {OUT}")


if __name__ == "__main__":
    main()

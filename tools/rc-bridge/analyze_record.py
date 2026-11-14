"""Read a record of the Shramko RC bridge (rc_bridge.py --record <file>: one JSON line per stick answer,
{"t": ms since start, "v": six raw values}) and say what each channel did.

Per channel: min, max, the value at rest (median of the first REST_MS of the record, or of the first REST_MIN lines if
that is fewer), and the order in which the channels first left their rest value by more than MOVE counts, with the
direction. The owner's window (docs/wip/rc2-lna.md) moves "left stick up, left stick left, right stick up, right stick
left" in that order, so the first four moves name the channels and their directions.
Standard library only. Usage: python -X utf8 tools/rc-bridge/analyze_record.py <record.jsonl> [--json]
"""
import json
import sys

REST_MS = 1000
REST_MIN = 10
MOVE = 200
GESTURES = ("left stick up", "left stick left", "right stick up", "right stick left")


def load(path):
    rows = []
    with open(path, encoding="ascii") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                m = json.loads(line)
            except ValueError:
                continue  # a line cut by a stop: skipped
            v = m.get("v")
            if isinstance(v, list) and len(v) == 6 and isinstance(m.get("t"), int):
                rows.append((m["t"], v))
    return rows


def median(xs):
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) // 2


def analyze(rows):
    if not rows:
        return {"lines": 0, "channels": [], "moves": []}
    t0 = rows[0][0]
    rest_rows = [v for t, v in rows if t - t0 <= REST_MS]
    if len(rest_rows) < REST_MIN:
        rest_rows = [v for _, v in rows[:REST_MIN]]
    channels = []
    for c in range(6):
        vals = [v[c] for _, v in rows]
        channels.append({"channel": c + 1, "min": min(vals), "max": max(vals), "rest": median([v[c] for v in rest_rows])})
    moves = []
    for c in range(6):
        rest = channels[c]["rest"]
        for t, v in rows:
            if abs(v[c] - rest) > MOVE:
                moves.append({"channel": c + 1, "t": t, "direction": "+" if v[c] > rest else "-", "value": v[c]})
                break
    moves.sort(key=lambda m: m["t"])
    for i, m in enumerate(moves):
        m["gesture"] = GESTURES[i] if i < len(GESTURES) else None
    return {"lines": len(rows), "ms": rows[-1][0] - t0, "channels": channels, "moves": moves}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        sys.exit(__doc__)
    r = analyze(load(argv[0]))
    if "--json" in argv:
        print(json.dumps(r))
        return r
    print("%d lines over %d ms" % (r["lines"], r.get("ms", 0)))
    print("channel   min   max  rest")
    for c in r["channels"]:
        print("%7d %5d %5d %5d" % (c["channel"], c["min"], c["max"], c["rest"]))
    print("first left the rest by more than %d (in order):" % MOVE)
    for m in r["moves"]:
        print("  t=%6d ms  channel %d %s (%d)%s" % (m["t"], m["channel"], m["direction"], m["value"],
                                                 "  <- " + m["gesture"] if m["gesture"] else ""))
    return r


if __name__ == "__main__":
    main()

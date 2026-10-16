"""Facts from the owner's 40 s DJI RC 3 recording (evidence/2026-10-15/dji-rc3/winmm-40s-recording.csv).

Prints, for the stir part (0..25 s), how the four stick axes move together, and the button-bit
transitions of the whole recording. Used for docs/research/radios/dji-rc3.md ("Which axis is which
stick"), so every number there can be re-run:

    python tools/radios/dji-recording.py

- Correlation: a person stirring both sticks moves the two horizontal axes mirrored (anti-phase) and
  the two vertical axes together (in phase), so the sign of the correlation tells horizontals from
  verticals without knowing what the hands did.
- Direction reversals: for each pair of axes, how often the angle atan2(b, a) turns back while both
  sit far from the centre. The two axes of one stick trace a circle that turns one way; axes of two
  different sticks only look circular when both hands happen to move in step.
- Negative control: the same statistics on the recording with the axis columns shuffled in time
  (each axis shifted by a different offset) must lose the structure (correlations near 0).
"""
import csv
import itertools
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, '..', '..', 'evidence', '2026-10-15', 'dji-rc3', 'winmm-40s-recording.csv')
AXES = ['x', 'y', 'z', 'u']  # winmm x, y, z and u = HID X, Y, Z, Rx (facts.json); r is the wheel (Ry)
NAMES = {'x': 'X', 'y': 'Y', 'z': 'Z', 'u': 'Rx'}


def norm(v):
    return (int(v) - 32767.5) / 32767.5


def corr(a, b):
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    sab = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    sa = math.sqrt(sum((x - ma) ** 2 for x in a))
    sb = math.sqrt(sum((y - mb) ** 2 for y in b))
    return sab / (sa * sb) if sa > 0 and sb > 0 else 0.0


def reversals(cols, a, b):
    rev = 0
    prev = 0.0
    for i in range(1, len(cols[a])):
        p = (cols[a][i - 1], cols[b][i - 1])
        q = (cols[a][i], cols[b][i])
        if math.hypot(*p) < 0.6 or math.hypot(*q) < 0.6:
            continue
        d = math.atan2(q[1], q[0]) - math.atan2(p[1], p[0])
        d = (d + math.pi) % (2 * math.pi) - math.pi
        if d * prev < 0 and abs(d) > 0.05:
            rev += 1
        if abs(d) > 0.05:
            prev = d
    return rev


def stats(cols, title):
    print(title)
    for a, b in itertools.combinations(AXES, 2):
        print('  %-2s %-2s  corr %+.2f  reversals %3d' % (NAMES[a], NAMES[b], corr(cols[a], cols[b]), reversals(cols, a, b)))


def main():
    rows = list(csv.DictReader(open(CSV, newline='')))
    stir = [r for r in rows if int(r['t_ms']) < 25000]
    cols = {a: [norm(r[a]) for r in stir] for a in AXES}
    stats(cols, 'stir 0..25 s, %d samples' % len(stir))
    n = len(stir)
    shifted = {a: cols[a][k * n // 5:] + cols[a][:k * n // 5] for k, a in enumerate(AXES)}
    stats(shifted, 'negative control: each axis shifted in time by a different offset')
    print('button transitions (bits 0..7; pairs 4/5 and 6/7)')
    prev = None
    for r in rows:
        b = int(r['buttons'])
        if b != prev:
            print('  %6s ms  0x%02x  pair45=%d%d  pair67=%d%d  push=%s' % (r['t_ms'], b, (b >> 5) & 1, (b >> 4) & 1, (b >> 7) & 1, (b >> 6) & 1, format(b & 15, '04b')))
            prev = b
    return 0


if __name__ == '__main__':
    sys.exit(main())

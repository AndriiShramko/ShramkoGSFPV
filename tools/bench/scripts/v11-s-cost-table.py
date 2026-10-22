#!/usr/bin/env python3
"""Cost tables of lane S from the bench's JSON (tools/bench/src/v11-s-cost.ts), so that every number in docs/wip/v11-s.md can be recomputed.

  python tools/bench/scripts/v11-s-cost-table.py [--clocks gpu.csv] evidence/2026-10-21/v11-s-cost-repeat.json ...

Per cell (scene, resolution, budget) and arm: the p50 of the engine's GPU profiler of each repeat, their median and range, and the
paired ratio A / S per repeat (A is lower in k of n pairs). With --clocks (the nvidia-smi log the repeat was taken beside:
timestamp, utilization, SM clock, max clock, ...) each run also gets the median SM clock of its measured window and its p50 scaled to the
maximum clock (p50 x clock / max clock), which is what the pass would take with the clock held up; that scaling is a heuristic (it holds only
for work that scales with the core clock) and is printed beside the raw number, never instead of it.
"""
import csv
import json
import statistics as st
import sys
from datetime import datetime

NAMES = {'39e63ce9': 'Villa room', 'ba7aa29d': 'Opole', '2f1ddf5f': 'Lublin'}


def load_clocks(path):
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        for r in csv.reader(f):
            if not r or not r[0][:1].isdigit():
                continue
            try:
                t = datetime.strptime(r[0].strip(), '%Y/%m/%d %H:%M:%S.%f').timestamp() * 1000
                rows.append((t, float(r[2].split()[0]), float(r[3].split()[0]), r[5].strip()))
            except ValueError:
                continue
    return rows


def clock_in(rows, w):
    inside = [c for c in rows if w[0] <= c[0] <= w[1]]
    if not inside:
        return None
    return st.median(c[1] for c in inside), inside[0][2], max(set(c[3] for c in inside), key=[c[3] for c in inside].count)


def main(argv):
    clocks = None
    files = []
    i = 0
    while i < len(argv):
        if argv[i] == '--clocks':
            clocks = load_clocks(argv[i + 1])
            i += 2
        else:
            files.append(argv[i])
            i += 1
    runs = []
    for n, f in enumerate(files):
        for r in json.load(open(f, encoding='utf-8'))['runs']:
            if 'arm' in r and 'gpuProfilerMs' in r:
                r['_f'] = n  # repeats of different files are different repeats, however they are numbered
                runs.append(r)
    cells = {}
    for r in runs:
        cells.setdefault((r['scene'], r['res'], r['budgetM']), {}).setdefault(r['arm'], []).append(r)
    head = '| scene, size, budget | arm | p50 per repeat (ms) | median | p95 per repeat (ms) | video memory MiB |'
    sep = '|---|---|---|---|---|---|'
    if clocks:
        head += ' SM clock MHz (median of the window) | p50 at max clock, median |'
        sep += '---|---|'
    print(head)
    print(sep)
    pairs = []
    for key in sorted(cells, key=lambda k: (k[1], k[2], list(NAMES).index(k[0]) if k[0] in NAMES else 9)):
        c = cells[key]
        for arm in ('S', 'E', 'A'):
            if arm not in c:
                continue
            rs = sorted(c[arm], key=lambda r: r.get('rep', 0))
            p50 = [r['gpuProfilerMs']['p50'] for r in rs]
            p95 = [r['gpuProfilerMs']['p95'] for r in rs]
            vr = [r['vramMiB']['afterRun']['total'] for r in rs if r.get('vramMiB', {}).get('afterRun')]
            line = f"| {NAMES.get(key[0], key[0])} {key[1].replace('1280x720', '720p').replace('3840x2160', '4K')} {key[2]} M | {arm} | {' / '.join(f'{x:g}' for x in p50)} | **{st.median(p50):g}** | {' / '.join(f'{x:g}' for x in p95)} | {min(vr):.0f} to {max(vr):.0f} |"
            if clocks:
                cl = [clock_in(clocks, r['window']) if r.get('window') else None for r in rs]
                if all(cl):
                    full = [r['gpuProfilerMs']['p50'] * x[0] / x[1] for r, x in zip(rs, cl)]
                    line += f" {' / '.join(f'{x[0]:.0f}' for x in cl)} | {st.median(full):.2f} |"
                else:
                    line += ' - | - |'
            print(line)
        if 'S' in c and 'A' in c:
            s = {(r['_f'], r.get('rep', 0)): r for r in c['S']}
            a = {(r['_f'], r.get('rep', 0)): r for r in c['A']}
            reps = sorted(set(s) & set(a))
            lower = sum(1 for k in reps if a[k]['gpuProfilerMs']['p50'] < s[k]['gpuProfilerMs']['p50'])
            ms, ma = st.median(r['gpuProfilerMs']['p50'] for r in c['S']), st.median(r['gpuProfilerMs']['p50'] for r in c['A'])
            s95, a95 = st.median(r['gpuProfilerMs']['p95'] for r in c['S']), st.median(r['gpuProfilerMs']['p95'] for r in c['A'])
            pairs.append((key, ma / ms, lower, len(reps), a95 / s95))
    print()
    print('A / S, ratio of the medians of the p50, and the repeats in which A is below S:')
    for key, ratio, lower, n, r95 in pairs:
        print(f"  {NAMES.get(key[0], key[0])} {key[1]} {key[2]} M: {ratio:.2f}, A below S in {lower} of {n}; p95 A / S {r95:.2f}")
    if pairs:
        rs = [p[1] for p in pairs]
        print(f"  all cells: ratio {min(rs):.2f} to {max(rs):.2f}, median {st.median(rs):.2f}; A below S in {sum(p[2] for p in pairs)} of {sum(p[3] for p in pairs)} pairs")
        k4 = [p for p in pairs if p[0][1] == '3840x2160']
        if k4:
            print(f"  4K cells, p95 of A over p95 of S (the pre-fixed bar is at most 1.25): {min(p[4] for p in k4):.2f} to {max(p[4] for p in k4):.2f}")


if __name__ == '__main__':
    main(sys.argv[1:])

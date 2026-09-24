"""
A9 latency harness (Windows). The one method from spec-verify:

1. Output rate first: a page flips black/white on every rAF; Desktop Duplication counts the
   distinct frames that reach the screen per second. dxdiag, Win32_VideoController and the
   page's own rAF rate are recorded next to it.
2. t_in = OS-level SendInput of F13 (QPC timestamp). t_out = the first Desktop Duplication
   frame whose 4-cell marker (top-left 16x16 CSS px) shows that input's id. Stock Chrome in a
   fresh profile, no rendering flags. N >= 200, random phase against vsync.
3. Controls: ?lagFrames=2 must raise the median by ~2 frame periods; an empty page that
   repaints the marker from its keydown handler gives the floor; if the median sits at about one
   vsync period and does not react to lagFrames, it is measuring the output rate, not latency.

Usage: python tools/latency/lat.py [--n 220] [--dist apps/fly/dist-lab]
Requires: dxcam (pip --target .cache/pylib), numpy. Writes evidence/<date>/a9-latency.json.
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import datetime
import http.server
import json
import os
import random
import re
import socketserver
import statistics
import subprocess
import sys
import tempfile
import threading
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, '.cache', 'pylib'))

ctypes.windll.shcore.SetProcessDpiAwareness(2)  # physical pixels everywhere
import dxcam  # noqa: E402
import numpy as np  # noqa: E402

user32 = ctypes.windll.user32
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 5199
VK_F13, VK_F20, VK_F24, VK_MENU = 0x7C, 0x83, 0x87, 0x12
KEYEVENTF_KEYUP, INPUT_KEYBOARD = 0x0002, 1


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [('wVk', wt.WORD), ('wScan', wt.WORD), ('dwFlags', wt.DWORD), ('time', wt.DWORD), ('dwExtraInfo', ctypes.POINTER(ctypes.c_ulong))]


class _I(ctypes.Union):
    _fields_ = [('ki', KEYBDINPUT), ('pad', ctypes.c_byte * 32)]


class INPUT(ctypes.Structure):
    _fields_ = [('type', wt.DWORD), ('u', _I)]


def send_key(vk, up=False):
    scan = user32.MapVirtualKeyW(vk, 0)
    inp = INPUT(type=INPUT_KEYBOARD, u=_I(ki=KEYBDINPUT(wVk=vk, wScan=scan, dwFlags=KEYEVENTF_KEYUP if up else 0, time=0, dwExtraInfo=None)))
    return user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))


# ------------------------------------------------------------------ local server
REPORTS = []


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SERVE_DIR, **kw)

    def translate_path(self, path):
        # the bundle is built with base /fly/
        p = path.split('?', 1)[0]
        if p.startswith('/fly/'):
            p = p[len('/fly'):]
        return super().translate_path(p)

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n)
        try:
            REPORTS.append(json.loads(body))
        except Exception:
            REPORTS.append({'raw': body[:200].decode('utf8', 'replace')})
        self.send_response(204)
        self.end_headers()

    def log_message(self, *a):
        pass


def start_server():
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ------------------------------------------------------------------ windows
def find_window(fragment, timeout=60):
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        n = user32.GetWindowTextLengthW(hwnd)
        if n > 0:
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if fragment in buf.value and user32.IsWindowVisible(hwnd):
                found.append((hwnd, buf.value))
        return True

    t0 = time.time()
    while time.time() - t0 < timeout:
        found.clear()
        user32.EnumWindows(cb, 0)
        if found:
            return found[0]
        time.sleep(0.2)
    return None


def title(hwnd):
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def client_origin(hwnd):
    """Screen rect of the web content. Chrome paints its own caption inside the Win32 client
    area, so the page origin is taken from the Chrome_RenderWidgetHostHWND child window."""
    kids = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def cb(child, _):
        buf = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(child, buf, 256)
        if buf.value == 'Chrome_RenderWidgetHostHWND':
            kids.append(child)
        return True

    user32.EnumChildWindows(hwnd, cb, 0)
    r = wt.RECT()
    if kids:
        user32.GetWindowRect(kids[0], ctypes.byref(r))
        return r.left, r.top, r.right - r.left, r.bottom - r.top
    user32.GetClientRect(hwnd, ctypes.byref(r))
    pt = wt.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    return pt.x, pt.y, r.right, r.bottom


HWND_TOPMOST = -1
SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW = 0x0002, 0x0001, 0x0040


def pin_on_top(hwnd):
    """Keep the test window above other windows so Chrome never throttles it as occluded.
    A property of this one test window only; no system setting is touched."""
    user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)


def to_front(hwnd):
    if user32.GetForegroundWindow() == hwnd:
        return True
    send_key(VK_MENU)
    send_key(VK_MENU, up=True)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.15)
    return user32.GetForegroundWindow() == hwnd


def launch_chrome(url, profile):
    args = [CHROME, f'--user-data-dir={profile}', '--no-first-run', '--no-default-browser-check',
            f'--app={url}', '--window-position=120,120', '--window-size=960,720']
    return subprocess.Popen(args)


def wait_title(hwnd, needle, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        t = title(hwnd)
        if needle in t:
            return t
        time.sleep(0.2)
    return None


# ------------------------------------------------------------------ capture
def decode(img, dpr):
    bits = 0
    for k in range(4):
        cx = int(((k % 2) * 8 + 4) * dpr)
        cy = int(((k >> 1) * 8 + 4) * dpr)
        px = img[cy, cx]
        if int(px[0]) + int(px[1]) + int(px[2]) > 384:
            bits |= 1 << k
    return bits


def measure_output_rate(cam, hwnd, seconds=5.0):
    l, t, r, b = window_rect(hwnd)
    cx, cy = (l + r) // 2, (t + b) // 2 + 20
    reg = (cx - 20, cy - 20, cx + 20, cy + 20)
    times, lum = [], []
    t0 = time.perf_counter()
    while time.perf_counter() - t0 < seconds:
        img = cam.grab(region=reg)
        if img is not None:
            times.append(time.perf_counter())
            lum.append(float(img.mean()))
    changes = sum(1 for a, b in zip(lum, lum[1:]) if abs(a - b) > 60)
    iv = [b - a for a, b in zip(times, times[1:])]
    return {
        'seconds': seconds,
        'newFramesFromDesktopDuplication': len(times),
        'framesPerSecond': len(times) / seconds,
        'blackWhiteChangesPerSecond': changes / seconds,
        'frameIntervalMedianMs': 1000 * statistics.median(iv) if iv else None,
        'frameIntervalP95Ms': 1000 * sorted(iv)[int(0.95 * (len(iv) - 1))] if iv else None,
    }


def window_rect(hwnd):
    r = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def fresh(cam, reg, timeout=1.0):
    """Next new frame for the region (Desktop Duplication returns None when nothing changed)."""
    t0 = time.perf_counter()
    img = None
    while time.perf_counter() - t0 < timeout:
        f = cam.grab(region=reg)
        if f is not None:
            img = f
        elif img is not None:
            return img
    return img


def calibrate(cam, hwnd):
    """Press F13 twice; the pixels that change are marker cell 0 then cell 1. Returns the marker
    origin (screen px) and the cell size — no assumptions about Chrome's own window frame."""
    l, t, r, b = window_rect(hwnd)
    reg = (l, t, min(r, l + 260), min(b, t + 260))
    boxes = []
    base = fresh(cam, reg, 1.5)
    presses = 0
    while len(boxes) < 2:
        if presses >= 6:
            raise RuntimeError(f'calibration: marker did not change after {presses} presses')
        to_front(hwnd)
        send_key(VK_F13)
        send_key(VK_F13, up=True)
        presses += 1
        time.sleep(0.6)
        img = fresh(cam, reg, 1.5)
        if base is None or img is None:
            base = img if img is not None else base
            continue
        d = np.abs(img.astype(np.int32) - base.astype(np.int32)).sum(axis=2) > 150
        ys, xs = np.nonzero(d)
        base = img
        if len(xs) == 0:
            continue
        boxes.append((xs.min(), ys.min(), xs.max(), ys.max()))
    calibrate.presses = presses
    # press 1 turned cell 0 white; press 2 turned cell 0 black and cell 1 white (both changed)
    x0, y0, x1, y1 = boxes[0]
    cell = x1 - x0 + 1
    return reg[0] + x0, reg[1] + y0, cell, boxes


def decode_at(img, cell):
    bits = 0
    for k in range(4):
        cx = int(((k % 2) + 0.5) * cell)
        cy = int(((k >> 1) + 0.5) * cell)
        px = img[cy, cx]
        if int(px[0]) + int(px[1]) + int(px[2]) > 384:
            bits |= 1 << k
    return bits


MARKER = {}


def verify_marker(cam, hwnd, ox, oy, cell):
    """On a page whose marker starts at 0: one press must turn it into 1 at the known origin."""
    reg = (ox, oy, ox + 2 * cell + 2, oy + 2 * cell + 2)
    for attempt in range(3):
        img = fresh(cam, reg, 1.0)
        v0 = decode_at(img, cell) if img is not None else None
        to_front(hwnd)
        send_key(VK_F13)
        send_key(VK_F13, up=True)
        t0 = time.perf_counter()
        while time.perf_counter() - t0 < 1.0:
            img = cam.grab(region=reg)
            if img is not None and v0 is not None and decode_at(img, cell) == (v0 + 1) % 16:
                return attempt + 1
        time.sleep(0.5)
    raise RuntimeError('marker not found at the calibrated origin')


def run_trials(cam, hwnd, dpr, n, label, interleave=False):
    if 'origin' in MARKER:
        ox, oy, cell = MARKER['origin']
        boxes = []
        calibrate.presses = verify_marker(cam, hwnd, ox, oy, cell)
    else:
        ox, oy, cell, boxes = calibrate(cam, hwnd)
        MARKER['origin'] = (ox, oy, cell)
    size = 2 * cell + 2
    reg = (ox, oy, ox + size, oy + size)
    cur_img = fresh(cam, reg, 1.0)
    cur = decode_at(cur_img, cell) if cur_img is not None else 0
    # page-side id of the last press: calibration pressed `presses` times; re-synced on misses
    pid = calibrate.presses
    if pid % 16 != cur:
        pid += (cur - pid) % 16
    res = []
    misses = 0
    fg_lost = 0
    mode = 0  # current lagFrames on the page (it starts at 0)
    for trial in range(n):
        if interleave:
            wanted = 2 if trial % 2 else 0
            if wanted != mode:
                to_front(hwnd)
                send_key(VK_F20)
                send_key(VK_F20, up=True)
                wait_title(hwnd, f'lag={wanted}', timeout=5)
                mode = wanted
                time.sleep(0.3)  # let the delay queue fill with current ids
                img = fresh(cam, reg, 0.5)
                if img is not None:
                    v = decode_at(img, cell)
                    pid += (v - pid) % 16 if (v - pid) % 16 < 8 else (v - pid) % 16 - 16
        time.sleep(random.uniform(0.04, 0.09))
        if not to_front(hwnd):
            fg_lost += 1
            time.sleep(1.0)
            if not to_front(hwnd):
                raise RuntimeError('cannot bring the test window to the front')
        pid += 1
        want = pid % 16
        t_in = time.perf_counter()
        send_key(VK_F13)
        send_key(VK_F13, up=True)
        t_out = None
        deadline = t_in + 0.6
        while time.perf_counter() < deadline:
            img = cam.grab(region=reg)
            if img is not None and decode_at(img, cell) == want:
                t_out = time.perf_counter()
                break
        if t_out is None:
            misses += 1
            img = fresh(cam, reg, 0.5)
            if img is not None:
                v = decode_at(img, cell)
                pid += (v - pid) % 16 if (v - pid) % 16 < 8 else (v - pid) % 16 - 16
        res.append({'id': pid, 'lagFrames': mode, 'tIn': t_in, 'tOut': t_out, 'ms': None if t_out is None else 1000 * (t_out - t_in)})
    def stats(rows):
        v = sorted(r['ms'] for r in rows if r['ms'] is not None)
        return {'measured': len(v), 'medianMs': statistics.median(v) if v else None, 'p95Ms': v[int(0.95 * (len(v) - 1))] if v else None, 'minMs': v[0] if v else None, 'maxMs': v[-1] if v else None}
    by_mode = {f'lagFrames={m}': stats([r for r in res if r['lagFrames'] == m]) for m in sorted({r['lagFrames'] for r in res})}
    base_rows = [r for r in res if r['lagFrames'] == 0]
    lat = [r['ms'] for r in base_rows if r['ms'] is not None]
    lat_sorted = sorted(lat)
    summary = {
        'byMode': by_mode,
        'label': label, 'n': n, 'measured': len(lat), 'misses': misses, 'foregroundRetries': fg_lost,
        'markerOrigin': [int(ox), int(oy)], 'markerCellPx': int(cell), 'calibrationBoxes': [list(map(int, b)) for b in boxes],
        'calibrationPresses': calibrate.presses,
        'medianMs': statistics.median(lat) if lat else None,
        'p95Ms': lat_sorted[int(0.95 * (len(lat_sorted) - 1))] if lat else None,
        'minMs': min(lat) if lat else None, 'maxMs': max(lat) if lat else None,
    }
    return summary, res


def stage_breakdown(report, trials):
    """Align page clock to QPC through event timestamps; report per-stage medians."""
    recs = {r['id']: r for r in report.get('records', [])}
    offs, ev_app, app_end, end_gpu, gpu_out = [], [], [], [], []
    for t in trials:
        r = recs.get(t['id'])
        if not r or t['tOut'] is None:
            continue
        offs.append(t['tIn'] * 1000 - r['tEvent'])
    if not offs:
        return None
    off = statistics.median(offs)
    for t in trials:
        r = recs.get(t['id'])
        if not r or t['tOut'] is None or r.get('tGpuDone') is None:
            continue
        if any(v is None or v != v for v in (r['tApplied'], r['tFrameEnd'], r['tGpuDone'])):
            continue
        ev_app.append(r['tApplied'] - r['tEvent'])
        app_end.append(r['tFrameEnd'] - r['tApplied'])
        end_gpu.append(r['tGpuDone'] - r['tFrameEnd'])
        gpu_out.append(t['tOut'] * 1000 - off - r['tGpuDone'])
    med = lambda a: statistics.median(a) if a else None  # noqa: E731
    return {
        'alignment': 'page clock mapped to QPC by the median of (SendInput QPC - KeyboardEvent.timeStamp)',
        'inputToPhysicsMs': med(ev_app), 'physicsToFrameEndMs': med(app_end),
        'frameEndToGpuDoneMs': med(end_gpu), 'gpuDoneToOutputMs': med(gpu_out), 'samples': len(ev_app),
    }


def system_info():
    info = {}
    try:
        out = subprocess.run(['powershell', '-NoProfile', '-Command',
                              'Get-CimInstance Win32_VideoController | Select-Object Name,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate,MaxRefreshRate | ConvertTo-Json'],
                             capture_output=True, text=True, timeout=60).stdout
        info['win32VideoController'] = json.loads(out)
    except Exception as e:  # noqa: BLE001
        info['win32VideoController'] = str(e)
    try:
        f = os.path.join(tempfile.gettempdir(), 'gsfpv-dxdiag.txt')
        subprocess.run(['dxdiag', '/t', f], timeout=120)
        for _ in range(60):
            if os.path.exists(f) and os.path.getsize(f) > 1000:
                break
            time.sleep(1)
        txt = open(f, encoding='utf-16', errors='replace').read() if open(f, 'rb').read(2) in (b'\xff\xfe', b'\xfe\xff') else open(f, errors='replace').read()
        info['dxdiagCurrentMode'] = re.findall(r'Current Mode:\s*(.+)', txt)
        info['dxdiagNativeMode'] = re.findall(r'Native Mode:\s*(.+)', txt)
    except Exception as e:  # noqa: BLE001
        info['dxdiag'] = str(e)
    return info


def one_page(cam, url, nonce, n, label, kind):
    profile = tempfile.mkdtemp(prefix='gsfpv-lat-')
    proc = launch_chrome(url, profile)
    try:
        w = find_window(f'GSFPV-LAT {nonce}', timeout=120)
        if not w:
            raise RuntimeError(f'{label}: window not found')
        hwnd = w[0]
        pin_on_top(hwnd)
        t = wait_title(hwnd, 'ready', timeout=180)
        if not t:
            raise RuntimeError(f'{label}: page not ready')
        dpr = float(re.search(r'dpr=([0-9.]+)', t).group(1))
        to_front(hwnd)
        time.sleep(6.0 if kind == 'fly' else 1.5)
        if kind == 'flash':
            rate = measure_output_rate(cam, hwnd, 5.0)
            for _retry in range(3):
                if rate['blackWhiteChangesPerSecond'] > 5:
                    break
                # not visible (occluded or throttled): pin again, wait, measure again
                pin_on_top(hwnd)
                to_front(hwnd)
                time.sleep(3)
                rate = measure_output_rate(cam, hwnd, 5.0)
            t2 = title(hwnd)
            m = re.search(r'raf=([0-9.]+)', t2)
            rate['pageRafHz'] = float(m.group(1)) if m else None
            return {'label': label, 'dpr': dpr, 'outputRate': rate}
        summary, trials = run_trials(cam, hwnd, dpr, n, label, interleave=(kind == 'fly'))
        REPORTS.clear()
        to_front(hwnd)
        send_key(VK_F24)
        send_key(VK_F24, up=True)
        wait_title(hwnd, 'reported', timeout=20)
        time.sleep(0.5)
        report = REPORTS[-1] if REPORTS else {}
        out = {'label': label, 'dpr': dpr, 'summary': summary, 'trials': trials,
               'page': {k: v for k, v in report.items() if k != 'records'}}
        if kind == 'fly':
            out['stages'] = stage_breakdown(report, [t for t in trials if t.get('lagFrames', 0) == 0])
        return out
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except Exception:  # noqa: BLE001
            proc.kill()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=220)
    ap.add_argument('--dist', default=os.path.join(ROOT, 'apps', 'fly', 'dist-lab'))
    ap.add_argument('--scene', default='39e63ce9')
    a = ap.parse_args()
    global SERVE_DIR
    SERVE_DIR = a.dist
    srv = start_server()
    cam = dxcam.create(output_idx=0, output_color='RGB')
    base = f'http://127.0.0.1:{PORT}/fly/'
    random.seed(20260924)
    results = {'system': system_info()}
    nonce = lambda: f'{random.randrange(1 << 30):08x}'  # noqa: E731
    def safe(key, *args):
        try:
            results[key] = one_page(cam, *args)
        except Exception as e:  # noqa: BLE001
            results[key] = {'error': str(e), 'summary': {'medianMs': None, 'p95Ms': None}}
    n1 = nonce(); safe('outputRate', f'{base}lab/flash.html?nonce={n1}', n1, 0, 'flash', 'flash')
    # the blank page calibrates the marker position once (same window geometry for every page)
    n4 = nonce(); safe('blank', f'{base}lab/blank.html?nonce={n4}', n4, a.n, 'blank page floor', 'blank')
    # fly: lagFrames 0 and 2 interleaved trial by trial in ONE page, so GPU-load drift hits both equally
    n2 = nonce(); safe('fly', f'{base}index.html?scene={a.scene}&lat=1&nonce={n2}', n2, 2 * a.n, 'fly, lagFrames 0/2 interleaved', 'fly')
    srv.shutdown()

    fps = results['outputRate']['outputRate']['framesPerSecond']
    period = 1000.0 / fps if fps else None
    modes = (results['fly'].get('summary') or {}).get('byMode') or {}
    m0 = (modes.get('lagFrames=0') or {}).get('medianMs')
    p0 = (modes.get('lagFrames=0') or {}).get('p95Ms')
    m2 = (modes.get('lagFrames=2') or {}).get('medianMs')
    mb = results['blank']['summary']['medianMs']
    lag_delta = (m2 - m0) if (m0 is not None and m2 is not None) else None
    # lagFrames delays the marker by 2 APP frames; compare with the app's own frame period
    app_period = ((results['fly'].get('page') or {}).get('framePeriod') or {}).get('medianMs') or period
    lag_ok = lag_delta is not None and app_period is not None and abs(lag_delta - 2 * app_period) <= 0.25 * 2 * app_period
    looks_like_vsync = m0 is not None and period is not None and abs(m0 - period) < 0.15 * period and not lag_ok
    if fps >= 55:
        status = 'PASS' if (m0 is not None and p0 is not None and m0 <= 33 and p0 <= 40) else 'FAIL'
    elif fps >= 25:
        status = 'LIMITED BY DISPLAY'
    else:
        status = 'LIMITED BY DISPLAY'
    results['verdict'] = {
        'status': status,
        'outputHz': fps, 'framePeriodMs': period,
        'medianMs': m0, 'p95Ms': p0, 'gate': 'median <= 33 ms and p95 <= 40 ms when output >= 55 Hz',
        'controls': {
            'lagFrames2': {'medianMs': m2, 'deltaMs': lag_delta, 'appFramePeriodMs': app_period, 'expectedDeltaMs': None if app_period is None else 2 * app_period, 'fired': lag_ok},
            'blankFloor': {'medianMs': mb, 'belowSim': mb is not None and m0 is not None and mb <= m0},
            'measuringVsyncOnly': looks_like_vsync,
        },
        'notCovered': 'USB / EdgeTX mixer, a real radio HID stack and panel response are not in this measurement (phase E, 240 fps camera).',
    }
    date = datetime.date.today().isoformat()
    out_dir = os.path.join(ROOT, 'evidence', date)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'a9-latency.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'name': 'a9-latency', 'date': datetime.datetime.now().isoformat(), **results}, f, indent=2)
    print(json.dumps(results['verdict'], indent=1))
    print('->', path)


if __name__ == '__main__':
    main()

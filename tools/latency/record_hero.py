"""Record the landing's hero video: a real bot flight with a crash in our simulator, captured from
the screen with ffmpeg's Desktop Duplication grabber (not stock footage, not generated).

python tools/latency/record_hero.py --url "http://localhost:5190/fly/?scene=39e63ce9&simradio=scenario&clean=1&nowarn=1" --seconds 30 --out .cache/hero-raw.mp4
"""
import argparse
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(__file__))
import lat  # noqa: E402  (DPI awareness, dxcam, window helpers)
import numpy as np  # noqa: E402

FFMPEG = r'C:\Program Files\Shutter Encoder\Library\ffmpeg.exe'


def content_rect(cam, hwnd):
    """The page shows its #07080a loading screen first: the content is the near-black box."""
    l, t, r, b = lat.window_rect(hwnd)
    for _ in range(100):
        img = cam.grab(region=(l, t, r, b))
        if img is not None:
            dark = (np.abs(img.astype(np.int32) - np.array([7, 8, 10])).sum(axis=2) < 12)
            ys, xs = np.nonzero(dark)
            if len(xs) > 1000:
                x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
                return l + int(x0), t + int(y0), int(x1 - x0 + 1) // 2 * 2, int(y1 - y0 + 1) // 2 * 2
        time.sleep(0.05)
    raise RuntimeError('content area not found')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True)
    ap.add_argument('--seconds', type=float, default=30)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    cam = lat.dxcam.create(output_idx=0, output_color='RGB')
    profile = tempfile.mkdtemp(prefix='gsfpv-hero-')
    args = [lat.CHROME, f'--user-data-dir={profile}', '--no-first-run', '--no-default-browser-check',
            f'--app={a.url}', '--window-position=0,0', '--window-size=1296,800']
    proc = subprocess.Popen(args)
    try:
        w = None
        for _ in range(200):
            w = lat.find_window('ShramkoGSFPV', timeout=1)
            if w:
                break
        if not w:
            raise RuntimeError('window not found')
        hwnd = w[0]
        lat.pin_on_top(hwnd)
        lat.to_front(hwnd)
        x, y, wd, ht = content_rect(cam, hwnd)
        print('content', x, y, wd, ht, flush=True)
        del cam  # release the duplication before ffmpeg opens its own
        cmd = [FFMPEG, '-hide_banner', '-y', '-f', 'lavfi', '-i',
               f'ddagrab=output_idx=0:framerate=30:offset_x={x}:offset_y={y}:video_size={wd}x{ht}:draw_mouse=0',
               '-t', str(a.seconds), '-vf', 'hwdownload,format=bgra', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', a.out]
        r = subprocess.run(cmd, capture_output=True, text=True)
        print(r.stderr[-800:], flush=True)
    finally:
        proc.terminate()


if __name__ == '__main__':
    main()

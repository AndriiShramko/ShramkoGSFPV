"""Debug helper: where is the marker on the Desktop Duplication frame?"""
import os
import sys
import time
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
import lat  # noqa: E402  (sets DPI awareness, imports dxcam)
import numpy as np  # noqa: E402

lat.SERVE_DIR = os.path.join(lat.ROOT, 'apps', 'fly', 'dist-lab')
srv = lat.start_server()
cam = lat.dxcam.create(output_idx=0, output_color='RGB')
nonce = 'dbg00001'
proc = lat.launch_chrome(f'http://127.0.0.1:{lat.PORT}/fly/lab/blank.html?nonce={nonce}', tempfile.mkdtemp(prefix='gsfpv-dbg-'))
try:
    hwnd, t = lat.find_window(f'GSFPV-LAT {nonce}')
    print('title', t, 'client', lat.client_origin(hwnd), 'front', lat.to_front(hwnd))
    time.sleep(1.5)
    for i in range(3):
        lat.send_key(lat.VK_F13); lat.send_key(lat.VK_F13, up=True); time.sleep(0.3)
    full = None
    t0 = time.time()
    while full is None and time.time() - t0 < 3:
        full = cam.grab()
    print('frame shape', None if full is None else full.shape)
    x, y, w, h = lat.client_origin(hwnd)
    from PIL import Image  # noqa: E402
    Image.fromarray(full).save(os.path.join(lat.ROOT, '.cache', 'dbg-full.png'))
    crop = full[y:y + 40, x:x + 40]
    print('crop mean', crop.mean(), 'corner pixels', crop[4, 4], crop[4, 16], crop[16, 4], crop[16, 16])
finally:
    proc.terminate()
    srv.shutdown()

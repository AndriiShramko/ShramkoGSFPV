# Join the clipped full-page captures written by verify.mjs (<name>.partN.png) into <name>.png.
# python scripts/stitch.py
import glob
import os
import re

from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
shots = os.path.join(here, "..", ".shots")
groups = {}
for p in glob.glob(os.path.join(shots, "*.part*.png")):
    m = re.match(r"(.*)\.part(\d+)\.png$", p)
    groups.setdefault(m.group(1), []).append((int(m.group(2)), p))
for base, parts in groups.items():
    imgs = [Image.open(p) for _, p in sorted(parts)]
    out = Image.new("RGB", (imgs[0].width, sum(i.height for i in imgs)))
    y = 0
    for i in imgs:
        out.paste(i, (0, y))
        y += i.height
    out.save(base + ".png")
    for _, p in parts:
        os.remove(p)
    print(f"stitch: {os.path.basename(base)}.png {out.width}x{out.height} from {len(imgs)} part(s)")

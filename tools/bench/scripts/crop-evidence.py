"""Cut 1:1 crops of full frames into the evidence folder (v0.10 lane R).

The SuperSplat comparison (tools/bench/src/v10-r-supersplat.ts) leaves full 1280x720 PNG screenshots in .cache/v10-r-supersplat/
(gitignored: about 1.5 MB each). The evidence keeps the same piece of every picture, at 1:1, so the grain and the detail can be
compared by eye: python tools/bench/scripts/crop-evidence.py <src-dir> <out-dir> [x y w h]   (default: the middle 480 x 270).
Needs Pillow. Files are named <scene>-<variant>-full.png in, <scene>-<variant>-crop.png out.
"""
import sys
from pathlib import Path

from PIL import Image


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    src, out = Path(argv[1]), Path(argv[2])
    box = [int(v) for v in argv[3:7]] if len(argv) >= 7 else [400, 225, 480, 270]
    x, y, w, h = box
    out.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in sorted(src.glob("*-full.png")):
        im = Image.open(f).convert("RGB")
        im.crop((x, y, x + w, y + h)).save(out / f.name.replace("-full.png", "-crop.png"), optimize=True)
        n += 1
    print(f"{n} crops of {w}x{h} at ({x},{y}) in {out}")
    return 0 if n else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

#!/usr/bin/env bash
# Publish walls built offline (tools/walls/bake-published.mjs) for every pilot (docs/wip/walls.md, W2).
#   bash deploy/release-walls.sh <dir> [<id> ...]
# <dir> holds <id>/v<N>/scene.voxel.json + scene.voxel.bin and manifest.json (the bake tool's output);
# without ids every scan with ok:true in the manifest goes. Needs deploy/nginx.conf with "location ^~ /walls/"
# live first (bash deploy/release-nginx.sh). Files go to releases/walls/ on the hub (beside the releases,
# so a new release keeps them), each through a temporary name and a rename, so a pilot never reads half a
# file. Then the sha256 on the hub and the bytes the site serves are compared with the local ones.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
DIR="${1:?usage: bash deploy/release-walls.sh <dir> [<id> ...]}"; shift
set -a; . deploy/hub.env; set +a
KEY="${GSFPV_KEY/#\~/$HOME}"
SSH=(ssh -p "$GSFPV_PORT" -i "$KEY" -o BatchMode=yes "$GSFPV_HOST")
B="$GSFPV_BASE"
SITE="${GSFPV_SITE:-https://gsfpv.flyreelstudio.eu}"
IDS=("$@")
if [ ${#IDS[@]} -eq 0 ]; then
  mapfile -t IDS < <(node -e "const m=require(require('path').resolve(process.argv[1],'manifest.json'));for(const [k,r] of Object.entries(m)) if(r.ok) console.log(k)" "$DIR")
fi
fail=0
for id in "${IDS[@]}"; do
  for vdir in "$DIR/$id"/v*; do
    [ -f "$vdir/scene.voxel.json" ] && [ -f "$vdir/scene.voxel.bin" ] || { echo "$id: no scene.voxel.json + .bin in $vdir"; fail=1; continue; }
    v=$(basename "$vdir")
    R="$B/releases/walls/$id/$v"
    "${SSH[@]}" "mkdir -p $R && chmod a+rx $B/releases/walls $B/releases/walls/$id $R"
    for f in scene.voxel.bin scene.voxel.json; do
      scp -q -P "$GSFPV_PORT" -i "$KEY" -o BatchMode=yes "$vdir/$f" "$GSFPV_HOST:$R/.$f.tmp"
      "${SSH[@]}" "chmod a+r $R/.$f.tmp && mv -f $R/.$f.tmp $R/$f"
      L=$(sha256sum "$vdir/$f" | cut -d' ' -f1)
      H=$("${SSH[@]}" "sha256sum $R/$f" | cut -d' ' -f1)
      W=$(curl -s "$SITE/walls/$id/$v/$f" | sha256sum | cut -d' ' -f1)
      code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/walls/$id/$v/$f")
      size=$(wc -c < "$vdir/$f" | tr -d ' ')
      echo "$id/$v/$f bytes=$size local=${L:0:12} hub=${H:0:12} site=${W:0:12} http=$code"
      if [ "$L" != "$H" ] || [ "$L" != "$W" ] || [ "$code" != "200" ]; then echo "STOP: $id/$v/$f differs or is not served"; fail=1; fi
    done
  done
done
echo "missing walls answer: $(curl -s -o /dev/null -w '%{http_code}' "$SITE/walls/00000000/v1/scene.voxel.json") (want 404)"
exit $fail

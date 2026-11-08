#!/usr/bin/env bash
# Put deploy/nginx.conf on the hub and reload gsfpv-web (release order step 2, deploy/README.md).
#   bash deploy/release-nginx.sh
# nginx.conf.prev first; the file on the hub and the copy gsfpv-web sees (a read-only bind mount) must both equal
# the local one; then nginx -t, reload, and the headers that changed are printed. A failed test puts .prev back.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
set -a; . deploy/hub.env; set +a
KEY="${GSFPV_KEY/#\~/$HOME}"
SSH=(ssh -p "$GSFPV_PORT" -i "$KEY" -o BatchMode=yes "$GSFPV_HOST")
B="$GSFPV_BASE"
SITE="${GSFPV_SITE:-https://gsfpv.flyreelstudio.eu}"
"${SSH[@]}" "cp -p $B/nginx.conf $B/nginx.conf.prev"
scp -q -P "$GSFPV_PORT" -i "$KEY" -o BatchMode=yes deploy/nginx.conf "$GSFPV_HOST:$B/nginx.conf"
L=$(sha256sum deploy/nginx.conf | cut -d' ' -f1)
H=$("${SSH[@]}" "sha256sum $B/nginx.conf" | cut -d' ' -f1)
C=$("${SSH[@]}" "docker exec gsfpv-web sha256sum /etc/nginx/conf.d/default.conf" | cut -d' ' -f1)
echo "local=${L:0:12} hub=${H:0:12} container=${C:0:12}"
if [ "$L" != "$H" ] || [ "$L" != "$C" ]; then
  "${SSH[@]}" "cp -p $B/nginx.conf.prev $B/nginx.conf"; echo "STOP: sha256 differs, nginx.conf.prev put back"; exit 3
fi
if ! "${SSH[@]}" "docker exec gsfpv-web nginx -t"; then
  "${SSH[@]}" "cp -p $B/nginx.conf.prev $B/nginx.conf"; echo "STOP: nginx -t failed, nginx.conf.prev put back (still serving the old config)"; exit 4
fi
"${SSH[@]}" "docker exec gsfpv-web nginx -s reload" && echo reloaded
sleep 2
for p in /en/ /en/fly/; do
  echo "$p $(curl -s -o /dev/null -w '%{http_code}' "$SITE$p")"
  curl -sI "$SITE$p" | grep -i -E '^(permissions-policy|content-security-policy):' | cut -c1-220
done

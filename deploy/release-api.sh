#!/usr/bin/env bash
# Put API files on the hub and restart the API (release order step 1, deploy/README.md).
#   bash deploy/release-api.sh [--compose] [--recreate] [--locales] <file>...
#   bash deploy/release-api.sh --undo [--compose] <file>...      the .prev copies go back, then the same restart
# <file>: a path under apps/api (server.py, sessions.py, locales/roadmap-seed.json ...).
# --compose   also deploy/compose.yml (implies --recreate: compose applies a changed limit or mount only on recreate)
# --recreate  docker compose up -d --force-recreate gsfpv-api (after a config.env change), else docker restart
# --locales   also apps/api/locales/ and packages/i18n/locales/{bot,mail} -> api/locales/
# Each file gets a .prev copy on the hub first; sha256 is compared on both ends; the API must then answer
# /api/health 200 within 40 s (about 10 s of 502 after a restart is normal) with no traceback in its log.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
set -a; . deploy/hub.env; set +a
KEY="${GSFPV_KEY/#\~/$HOME}"
SSH=(ssh -p "$GSFPV_PORT" -i "$KEY" -o BatchMode=yes "$GSFPV_HOST")
SCP=(scp -q -P "$GSFPV_PORT" -i "$KEY" -o BatchMode=yes)
B="$GSFPV_BASE"
SITE="${GSFPV_SITE:-https://gsfpv.flyreelstudio.eu}"
RECREATE=0 COMPOSE=0 LOCALES=0 UNDO=0
FILES=()
for a in "$@"; do
  case "$a" in
    --recreate) RECREATE=1 ;;
    --compose) COMPOSE=1; RECREATE=1 ;;
    --locales) LOCALES=1 ;;
    --undo) UNDO=1 ;;
    -*) echo "unknown option $a"; exit 2 ;;
    *) [[ "$a" =~ ^[A-Za-z0-9._/-]+$ && "$a" != *..* ]] || { echo "STOP: odd file name $a"; exit 2; }
       FILES+=("$a") ;;
  esac
done
[ "${#FILES[@]}" -gt 0 ] || [ "$COMPOSE" = 1 ] || [ "$LOCALES" = 1 ] || { sed -n 2,10p "$0"; exit 2; }

if [ "$UNDO" = 1 ]; then
  for f in "${FILES[@]}"; do "${SSH[@]}" "cp -p $B/api/$f.prev $B/api/$f" && echo "back: $f"; done
  [ "$COMPOSE" = 0 ] || { "${SSH[@]}" "cp -p $B/compose.yml.prev $B/compose.yml" && echo "back: compose.yml"; }
else
  for f in "${FILES[@]}"; do [ -f "apps/api/$f" ] || { echo "STOP: apps/api/$f is not a file"; exit 1; }; done
  # 1. .prev copies of what is there now
  for f in "${FILES[@]}"; do "${SSH[@]}" "[ ! -f $B/api/$f ] || cp -p $B/api/$f $B/api/$f.prev"; done
  [ "$COMPOSE" = 0 ] || "${SSH[@]}" "cp -p $B/compose.yml $B/compose.yml.prev"
  # 2. upload
  for f in "${FILES[@]}"; do "${SSH[@]}" "mkdir -p $B/api/$(dirname "$f")"; "${SCP[@]}" "apps/api/$f" "$GSFPV_HOST:$B/api/$f"; done
  [ "$COMPOSE" = 0 ] || "${SCP[@]}" deploy/compose.yml "$GSFPV_HOST:$B/compose.yml"
  if [ "$LOCALES" = 1 ]; then
    "${SCP[@]}" -r apps/api/locales "$GSFPV_HOST:$B/api/"
    "${SCP[@]}" -r packages/i18n/locales/bot packages/i18n/locales/mail "$GSFPV_HOST:$B/api/locales/"
  fi
  # 3. the same bytes on both ends
  bad=0
  for f in "${FILES[@]}"; do
    l=$(sha256sum "apps/api/$f" | cut -d' ' -f1); r=$("${SSH[@]}" "sha256sum $B/api/$f" | cut -d' ' -f1)
    [ "$l" = "$r" ] || { echo "SHA MISMATCH $f"; bad=1; }
  done
  if [ "$COMPOSE" = 1 ]; then
    [ "$(sha256sum deploy/compose.yml | cut -d' ' -f1)" = "$("${SSH[@]}" "sha256sum $B/compose.yml" | cut -d' ' -f1)" ] || { echo "SHA MISMATCH compose.yml"; bad=1; }
  fi
  if [ "$LOCALES" = 1 ]; then
    l=$( { (cd apps/api && find locales -type f); (cd packages/i18n && find locales/bot locales/mail -type f); } | LC_ALL=C sort)
    loc=$( { (cd apps/api && find locales -type f -exec sha256sum {} +); (cd packages/i18n && find locales/bot locales/mail -type f -exec sha256sum {} +); } | LC_ALL=C sort -k2)
    rem=$("${SSH[@]}" "cd $B/api && sha256sum $(echo $l)" | LC_ALL=C sort -k2)
    [ "$loc" = "$rem" ] || { echo "SHA MISMATCH in locales"; bad=1; }
  fi
  [ "$bad" = 0 ] || { echo "STOP: put the .prev copies back: bash deploy/release-api.sh --undo ${FILES[*]}"; exit 3; }
  echo "sha256 equal: ${FILES[*]} $([ "$COMPOSE" = 1 ] && echo compose.yml) $([ "$LOCALES" = 1 ] && echo locales/)"
fi

# 4. restart or recreate, then health and tracebacks
if [ "$RECREATE" = 1 ]; then
  "${SSH[@]}" "cd $B && docker compose up -d --force-recreate gsfpv-api 2>&1 | tail -2"
else
  "${SSH[@]}" "docker restart gsfpv-api >/dev/null"
fi
code=000
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/api/health" || true)
  [ "$code" = 200 ] && break
  sleep 2
done
echo "api/health $code; $("${SSH[@]}" "docker inspect gsfpv-api --format 'memory {{.HostConfig.Memory}} {{.State.Status}}'")"
tb=$("${SSH[@]}" "docker logs --since 2m gsfpv-api 2>&1 | grep -c Traceback || true")
echo "tracebacks since the restart: $tb"
[ "$code" = 200 ] && [ "$tb" = 0 ] || { echo "STOP: the API is not well; undo: bash deploy/release-api.sh --undo $([ "$COMPOSE" = 1 ] && echo --compose) ${FILES[*]}"; exit 4; }

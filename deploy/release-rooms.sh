#!/usr/bin/env bash
# Put the rooms service on the hub and (re)start its container (release order step 3, deploy/README.md "Rooms").
#   bash deploy/release-rooms.sh [--compose]       upload apps/rooms/{ws,protocol,rooms}.py, then restart gsfpv-rooms
#   bash deploy/release-rooms.sh --undo [--compose] the .prev copies go back, then the same restart
# --compose   also deploy/compose.yml: the first release (the service is new) and every change of its limits.
#             `docker compose up -d gsfpv-rooms` creates or recreates ONLY that container; web and api are not touched.
# Each file gets a .prev copy on the hub first; sha256 is compared on both ends; the service must then answer
# /api/rooms/health 200 from inside the network (nginx may not route /api/rooms yet: step 4 comes after this one)
# within 40 s, with no traceback in its log. Prints no value from deploy/hub.env.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
set -a; . deploy/hub.env; set +a
KEY="${GSFPV_KEY/#\~/$HOME}"
SSH=(ssh -p "$GSFPV_PORT" -i "$KEY" -o BatchMode=yes "$GSFPV_HOST")
SCP=(scp -q -P "$GSFPV_PORT" -i "$KEY" -o BatchMode=yes)
B="$GSFPV_BASE"
FILES=(ws.py protocol.py rooms.py)
COMPOSE=0 UNDO=0
for a in "$@"; do
  case "$a" in
    --compose) COMPOSE=1 ;;
    --undo) UNDO=1 ;;
    *) sed -n 2,9p "$0"; exit 2 ;;
  esac
done

if [ "$UNDO" = 1 ]; then
  for f in "${FILES[@]}"; do "${SSH[@]}" "[ ! -f $B/rooms/$f.prev ] || cp -p $B/rooms/$f.prev $B/rooms/$f" && echo "back: $f"; done
  [ "$COMPOSE" = 0 ] || { "${SSH[@]}" "cp -p $B/compose.yml.prev $B/compose.yml" && echo "back: compose.yml"; }
else
  for f in "${FILES[@]}"; do [ -f "apps/rooms/$f" ] || { echo "STOP: apps/rooms/$f is not a file"; exit 1; }; done
  # 1. .prev copies of what is there now
  "${SSH[@]}" "mkdir -p $B/rooms"
  for f in "${FILES[@]}"; do "${SSH[@]}" "[ ! -f $B/rooms/$f ] || cp -p $B/rooms/$f $B/rooms/$f.prev"; done
  [ "$COMPOSE" = 0 ] || "${SSH[@]}" "cp -p $B/compose.yml $B/compose.yml.prev"
  # 2. upload
  for f in "${FILES[@]}"; do "${SCP[@]}" "apps/rooms/$f" "$GSFPV_HOST:$B/rooms/$f"; done
  [ "$COMPOSE" = 0 ] || "${SCP[@]}" deploy/compose.yml "$GSFPV_HOST:$B/compose.yml"
  # 3. the same bytes on both ends
  bad=0
  for f in "${FILES[@]}"; do
    l=$(sha256sum "apps/rooms/$f" | cut -d' ' -f1); r=$("${SSH[@]}" "sha256sum $B/rooms/$f" | cut -d' ' -f1)
    [ "$l" = "$r" ] || { echo "SHA MISMATCH $f"; bad=1; }
  done
  if [ "$COMPOSE" = 1 ]; then
    [ "$(sha256sum deploy/compose.yml | cut -d' ' -f1)" = "$("${SSH[@]}" "sha256sum $B/compose.yml" | cut -d' ' -f1)" ] || { echo "SHA MISMATCH compose.yml"; bad=1; }
  fi
  [ "$bad" = 0 ] || { echo "STOP: put the .prev copies back: bash deploy/release-rooms.sh --undo $([ "$COMPOSE" = 1 ] && echo --compose)"; exit 3; }
  echo "sha256 equal: ${FILES[*]} $([ "$COMPOSE" = 1 ] && echo compose.yml)"
fi

# 4. create or restart only gsfpv-rooms, then health from inside the network and tracebacks
if [ "$COMPOSE" = 1 ]; then
  "${SSH[@]}" "cd $B && docker compose up -d gsfpv-rooms 2>&1 | tail -2"
else
  "${SSH[@]}" "docker restart gsfpv-rooms >/dev/null"
fi
code=000
for i in $(seq 1 20); do
  code=$("${SSH[@]}" "docker exec gsfpv-web wget -q -S -O /dev/null http://gsfpv-rooms:8091/api/rooms/health 2>&1 | awk '/HTTP\//{print \$2}' | tail -1" || true)
  [ "$code" = 200 ] && break
  sleep 2
done
echo "rooms/health $code; $("${SSH[@]}" "docker inspect gsfpv-rooms --format 'memory {{.HostConfig.Memory}} pids {{.HostConfig.PidsLimit}} {{.State.Status}}'")"
tb=$("${SSH[@]}" "docker logs --since 2m gsfpv-rooms 2>&1 | grep -c Traceback || true")
echo "tracebacks since the restart: $tb"
[ "$code" = 200 ] && [ "$tb" = 0 ] || { echo "STOP: rooms is not well; undo: bash deploy/release-rooms.sh --undo $([ "$COMPOSE" = 1 ] && echo --compose)"; exit 4; }

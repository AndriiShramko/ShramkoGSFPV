#!/usr/bin/env bash
# Background loops cut from the owner's REAL FPV flights (not the simulator): the 12 s loops of his FPV
# lecture deck (repository shramko-immersive-warsaw-2026, branch fpv-talk, talks/fpv/deck_public/media,
# 1920x1080 H.264, already seamless: the deck's cut cross-fades the last 0.6 s into the first 0.6 s).
# Used by the Fly by Sound page (src/config/videos.ts). Run from the repository root in Git Bash:
#   bash apps/site/scripts/encode-flight-videos.sh pond "U:/ImmersiveWarsaw2026/talks/fpv/deck_public/media/s04_fpv_view.mp4"
#   bash apps/site/scripts/encode-flight-videos.sh acro "U:/ImmersiveWarsaw2026/talks/fpv/deck_public/media/s10_acro_flip.mp4"
# pond: low over a pond with reflections, a park in Bydgoszcz (deck slide 4, source 71-83 s, no people).
# acro: up a spruce, a full roll, a dive to a path, over the grass, into the trees, Bydgoszcz (deck slide 10, 30-42 s).
# Same outputs as scripts/encode-videos.sh: the 16:9 frame cropped to 2:1 in the middle (1920x960), 30 fps,
# exactly 12 s, H.264 and AV1 at 1280 and 1920 px (bitrate capped: 1280 under 2.5 MB, 1920 under 5 MB),
# no audio, and the first frame as WebP posters at 800 and 1600 px. ffmpeg is the one of Shutter Encoder.
set -e
FF=${FF:-"/c/Program Files/Shutter Encoder/Library/ffmpeg.exe"}
OUT=${OUT:-apps/site/public/media}
TMP_DIR=${TMP_DIR:-/u/Temp/gsfpv-train2/page}
mkdir -p "$OUT" "$TMP_DIR"
name=$1; src=$2
c1=${3:-26}; c2=${4:-27}; a1=${5:-40}; a2=${6:-42}
mezz=$TMP_DIR/mezz-$name.mp4
if [ ! -f "$mezz" ]; then
  "$FF" -hide_banner -loglevel error -y -i "$src" -an -t 12 -vf "crop=1920:960:0:60,fps=30,format=yuv420p" \
    -c:v libx264 -preset veryfast -crf 8 "$mezz"
fi
X264="-c:v libx264 -preset slow -profile:v high -pix_fmt yuv420p -g 60 -movflags +faststart -an -map_metadata -1"
AV1="-c:v libsvtav1 -preset 4 -pix_fmt yuv420p -g 60 -movflags +faststart -an -map_metadata -1"
"$FF" -hide_banner -loglevel error -y -i "$mezz" -vf scale=1280:640:flags=lanczos $X264 -crf $c1 -maxrate 1500k -bufsize 3000k "$OUT/$name-1280.mp4"
"$FF" -hide_banner -loglevel error -y -i "$mezz" $X264 -crf $c2 -maxrate 3000k -bufsize 6000k "$OUT/$name-1920.mp4"
"$FF" -hide_banner -loglevel error -y -i "$mezz" -vf scale=1280:640:flags=lanczos $AV1 -crf $a1 -maxrate 1200k -bufsize 2400k "$OUT/$name-1280.av1.mp4"
"$FF" -hide_banner -loglevel error -y -i "$mezz" $AV1 -crf $a2 -maxrate 2400k -bufsize 4800k "$OUT/$name-1920.av1.mp4"
for w in 800 1600; do
  "$FF" -hide_banner -loglevel error -y -i "$mezz" -frames:v 1 -vf scale=$w:$((w / 2)):flags=lanczos -c:v libwebp -quality 74 "$OUT/$name-poster-$w.webp"
done
ls -l "$OUT"/$name-* | awk '{print $5, $9}'

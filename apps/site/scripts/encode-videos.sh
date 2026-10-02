#!/usr/bin/env bash
# Landing background loops (src/config/videos.ts) from the owner's own flights recorded in the
# simulator (2160x1080, 60 fps H.264, 2 October 2026). Run from the repository root in Git Bash:
#   bash apps/site/scripts/encode-videos.sh tunis  887f27aa 12
#   bash apps/site/scripts/encode-videos.sh garden 7a475d38 1
#   bash apps/site/scripts/encode-videos.sh villa  39e63ce9 41.5
# args: <clip name> <scene id> <start second> [crf h264-1280 h264-1920 av1-1280 av1-1920] (26 27 40 42)
# One 12 s loop per clip: the burned-in credit strip cropped off (the page credits the scan in text,
# 2000x1000 from x=80, still 2:1), 30 fps, and the last 0.6 s cross-faded into the first 0.6 s (xfade
# of the clip with its own head; never the concat filter, which is broken in this ffmpeg build), so
# the loop has no jump. Then H.264 and AV1 (both MP4, +faststart, no audio track) at 1280 and 1920 px,
# each capped in bitrate (1280: under 2.5 MB, 1920: under 5 MB), and the loop's first frame as WebP
# posters at 800 and 1600 px (the video starts on that frame, so there is no jump when it starts).
set -e
FF=${FF:-"/c/Program Files/Shutter Encoder/Library/ffmpeg.exe"}
SRC_DIR=${SRC_DIR:-"/u/mtp/New folder (4)"}
OUT=${OUT:-apps/site/public/media}
TMP_DIR=${TMP_DIR:-/d/gsfpv-tmp} # the ~130 MB intermediates: keep them off the nearly full C:
mkdir -p "$OUT" "$TMP_DIR"
name=$1; id=$2; start=$3
c1=${4:-26}; c2=${5:-27}; a1=${6:-40}; a2=${7:-42}
D=0.6
src=$(ls "$SRC_DIR"/gsfpv-$id-*.mp4)
mezz=$TMP_DIR/mezz-$name.mp4
if [ ! -f "$mezz" ]; then
  "$FF" -hide_banner -loglevel error -y -ss "$start" -t 12.6 -i "$src" -an -filter_complex \
    "[0:v]crop=2000:1000:80:0,fps=30,scale=1920:960:flags=lanczos,split[s1][s2];[s1]trim=start=$D:end=12.6,setpts=PTS-STARTPTS[a];[s2]trim=start=0:end=$D,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=$D:offset=11.4,format=yuv420p[v]" \
    -map "[v]" -c:v libx264 -preset veryfast -crf 8 "$mezz"
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

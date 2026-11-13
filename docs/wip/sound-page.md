# Lane page: the Fly by Sound page gets its picture (/{lang}/sound/)

Branch sound-page (from origin/main 2a5ac433), worktree C:/dev/gsfpv-site-sound. Files: apps/site/**, packages/i18n/locales/site/**.
Owner's word (2026-11-13): the page is dry, no interesting videos in the background; put his real FPV flights behind it and the animated
infographics with explanations; people ask how one flies by sound at all; it has to be visual and clear.

## Status

Stage P1-video-layout:
- [x] 1. Video slots and layout. config/videos.ts: slot soundHero (garden) and FLIGHTS soundHow (pond), soundStart (acro); BgVideo takes both kinds of slot; media.mjs knows pond and acro. Page: first screen with the Winter Garden loop, h1, one-line lead (sound.hero.lead), the start button, the note; h2 order how, hear, need, start, now, test, who, open, help (10 h2 became 9; keys and record are h3 with their old anchors #sound-keys, #sound-record). The first four h2 are the newcomer's questions. Real-flight strips open "how" and "start". Locales en, ru, pl, es: how/need/start titles as questions, new sound.hero.lead, sound.hear.title, sound.media.{garden,pond,acro}. verify.mjs: new h2 order, 11 h3, the three loops with posters and captions. Site typecheck PASS, i18n-check OK (1172 strings x 4).
- [ ] 2. Build, full-page shots 1440x900 and 360x800 in en and ru (U:/Temp/gsfpv-train2/shots/sound-page-p1-*.png), look at them, fix.

## Decisions

- Real flights: the owner's FPV lecture deck already has his own flights cut as seamless 12 s loops (U:/ImmersiveWarsaw2026/talks/fpv/deck_public/media, cuts described in talks/fpv/scripts/spec.py). Taken: s04_fpv_view (low over a pond, Bydgoszcz park, source 71-83 s, no people) as "pond" and s10_acro_flip (up a spruce, a roll, a dive into the trees, Bydgoszcz, 30-42 s) as "acro".
- Encoding: apps/site/scripts/encode-flight-videos.sh, ffmpeg of Shutter Encoder ("C:/Program Files/Shutter Encoder/Library/ffmpeg.exe"). Exact commands run from the repository root:
  bash apps/site/scripts/encode-flight-videos.sh pond "U:/ImmersiveWarsaw2026/talks/fpv/deck_public/media/s04_fpv_view.mp4"
  bash apps/site/scripts/encode-flight-videos.sh acro "U:/ImmersiveWarsaw2026/talks/fpv/deck_public/media/s10_acro_flip.mp4"
  Crop 1920x1080 to 1920x960 (y 60), 30 fps, 12.000 s, H.264 and AV1 at 1280 and 1920, WebP posters 800 and 1600 (the loop's first frame).
- Sizes (ls -l): pond 1280 H.264 2378203, 1280 AV1 1829516, 1920 H.264 4741098, 1920 AV1 3976278, posters 73288 and 224626; acro 1280 H.264 2390893, 1280 AV1 1756324, 1920 H.264 4723279, 1920 AV1 3465635, posters 60000 and 144454. All under the landing's L5 caps (1280 under 2.5 MB, 1920 under 5 MB). ffprobe: 1280x640 and 1920x960, 30 fps, 12.000000 s.
- Both widths were encoded (not only 1280) because scripts/media.mjs marks a clip as video only when all four files and both posters exist, and BgVideos picks 1920 from 1100 px CSS width.
- The acro poster (the loop's first frame) is a blurred spruce in a climb; kept, so the video starts without a jump.
- Text over video: the h1 and the strip h2 sit on a gradient scrim from the page colour plus a text shadow; all other text is on the plain page.
- Facts kept: the old lead moved into "How can one fly by sound at all?" with how.text, now.tested and the status (no longer in the first screen); how.items under "What do I hear?"; start text, steps and keys under "How do I start?"; record under "Join the testing".
- Animated infographics: none of the 28 lecture infographics explains flying by sound (scout-B B3); they belong to a later stage, not P1.

## For the lead

- tools/bench/scripts/sound-page-shots.mjs (not in this lane) reads #sound-how and prints the h2 order; it does not assert the old order in code read so far, but its log line will show the new order how,hear,need,start,now,test,who,open,help.
- packages/sonic-fpv shows as modified in this worktree (submodule pointer); not touched, not staged.

## Not verified

## Cost notes

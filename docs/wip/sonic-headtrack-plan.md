# Head tracking, HRTF choice and a walking app: where the consultant's advice lives (design only)

Lane hearing, stage R1-design, 2026-11-15. No product code. Source of the advice: the reply of Bartlomiej Mroz (Gdansk
University of Technology) of 2026-11-14 in the owner's vault, note "Bartlomiej Mroz - odpowiedz w LinkedIn (2026-11-14)".
It builds on docs/wip/sonic3-plan.md section 5 (d). Marks: [read] = read in the named source or file; [measured] = bytes
counted by curl, unzip or gzip on 2026-11-15 (scratch files under U:/Temp/gsfpv-train2/hearing/); [guess] = not checked.

His advice in one line each [read]: front-back errors are the limit of a generic HRTF, not a bug; movement resolves them
(head tracking best: a web camera in the browser, motion-sensor headphones in a phone app); do not rest key facts on the HRTF
alone; approach coded by level, pulse rate and brightness works without the HRTF; pick an HRTF from SADIE II or HUTUBS by a
short listening test; a light reverb helps externalisation.

## 1. Head tracking with a web camera in the browser

### 1.1 What Cat3DA does (read from its repository through the GitLab API; the web page refused this agent with 403)

- Repository: https://git.iem.at/lukas_goelles/cat3da (last activity 2023-03-10 [read]). Its licence: "The Cat3DA player is
  released under BSD 3 License." [read, README]. Author Lukas Goelles, IEM Graz [read].
- What it is: a higher-order Ambisonics player whose listener's head is tracked by the webcam; without a camera or with
  access denied it plays as a static binaural player [read, README].
- Tracker: the legacy TensorFlow.js "facemesh" model with the BlazeFace detector, tf.js with the "webgl" backend
  (js/VideoTracker_2022.js: tf.setBackend("webgl"), facemesh.load({maxFaces: 1})) [read]. The README credits Google's
  MediaPipe Face Mesh [read]. Model weights shipped in the repo: dependencies/facemesh/group1-shard1of1.bin 2,955,780 bytes
  and dependencies/blazeface/group1-shard1of1.bin 401,768 bytes [measured, GitLab API sizes]. Runs in the page's main
  thread on the GPU through WebGL [read]. Camera asked at 640 x 480 [read].
- Pose: yaw, pitch and roll from four landmarks (forehead 10, chin 152, cheeks 234 and 454): yaw from the ear-to-ear vector,
  pitch and roll from the forehead-to-chin vector; each clamped to +-35 degrees (controls.FOV = 35) [read]. It also derives
  a 6-DoF head position from the face size and centre [read]. A deviceorientation listener exists for phones [read].
- Feed to the renderer: every 25 ms (Audio3.js SPATIALIZATION_UPDATE_MS = 25) the whole third-order Ambisonics scene is
  rotated by JSAmbisonics' sceneRotator (yaw negated, pitch, roll) and decoded binaurally by convolution filters
  (decodingFilters/mls_o3.wav) [read]. One-euro filters smooth positions and object angles [read]. So: scene rotation, not
  per-source panning.
- Face lost: confidence drops to 0 and the 25 ms update is skipped, so the last rotation is held [read].
- Latency: the README gives no number [read]; a search found no measured Cat3DA motion-to-sound delay. Its README warns the
  combination is "computationally demanding" and does not work on phones or older computers [read]. Firefox and Chromium only,
  not Safari (Opus) [read]. A benchmark of webcam head trackers found only one of four "achieved a sufficiently low latency"
  [read, search summary of TU Berlin work; link not opened: https://dael.euracoustics.org/confs/fa2023/data/articles/000605.pdf].

### 1.2 What a browser page can ship today

- MediaPipe Face Landmarker (tasks-vision): npm @mediapipe/tasks-vision 1.2.3, licence Apache-2.0 [read, npm registry].
  Wasm runtime vision_wasm_internal.wasm 14,665,716 bytes, 4,147,452 after gzip -9 [measured]; JS bundle 156,016 bytes
  [measured]. Model face_landmarker.task (float16) 3,758,596 bytes [measured]; inside: face_detector.tflite 229,746,
  face_landmarks_detector.tflite 2,553,590, face_blendshapes.tflite 955,312 [measured]. Model card: "Apache License,
  Version 2.0" [read, https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf].
  It outputs 478 landmarks and, with outputFacialTransformationMatrixes, a 4 x 4 head pose matrix per face [read,
  https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker]: yaw, pitch and roll come straight from it.
  Blendshapes are not needed: switch them off (outputFaceBlendshapes false) [guess: that skips the 955 KB model's run, its
  bytes stay in the bundle unless we repack].
- Cost per frame: the official guide shows no Face Landmarker benchmark [read]; no per-frame cost is taken from anywhere.
  It must be measured on our three machine classes (desktop GPU, integrated GPU, phone) by a probe before any number enters code.
- Others [guess, not read today]: TF.js face-landmarks-detection (Apache-2.0, what Cat3DA uses in its older form);
  human.js (MIT). MediaPipe is chosen as the candidate because it gives the pose matrix and has an Apache model card.

### 1.3 What our page needs

- Permission: deploy/nginx.conf, location ~ ^/(en|es|pl|ru)/fly/ (line 192) sends camera=() today [read]. Change there only:
  camera=(self). Every other location (the asset location line 125, "/" line 203, the admin 153 and 365) keeps camera=().
  The CSP already has 'wasm-unsafe-eval' and worker-src 'self' blob: [read], so a same-origin wasm in a worker needs no CSP
  change [guess until a local serve-csp run proves it]. The wasm and .task files are served from our own origin, never a CDN.
- Frames never leave the device: the video stream goes into an OffscreenCanvas/ImageBitmap posted to a worker; only three
  angles come back; no frame is stored, drawn to a visible canvas, recorded in Fly by Sound's recordings or sent anywhere.
  A unit test asserts the worker's message carries only numbers [design]. The camera stops when the item is switched off or
  the page is hidden.
- Where the turn enters the sound package (read in C:/dev/ShramkoSonicFPV, commit 30836c1): the engine fixes the
  AudioListener at the origin, forward -Z, up +Y (src/audio/engine.ts lines 497-505); every voice has its own HRTF
  PannerNode (8 moving, 24 static, 1 target; setPannerDefaults line 286); directions come from the planner in the listener
  frame "x right, y up, z back" (src/sense/frame.ts listenerBasis(sample, prefs.listenerFrame) and worldToListener), pass
  foldToFront (src/cues/beacon.ts line 66) for the beacon, then rules.ts pannerDirection (line 159) and the ILD boost.
- Design: a new optional input headPose (yaw, pitch, roll, quaternion) in SonicFrameInput. The planner keeps computing every
  cue's meaning in the craft frame (what is ahead or behind the nose, foldToFront, rear timbre, height tone by
  elevationSteps): these are the unambiguous codes he asked for and they must not change when the head moves. Only the
  binaural placement follows the head: dirHead = inverse(headPose) * dirL, applied right before pannerDirection and the
  ILD side gain. Rotating the AudioListener instead would be one call, but the ILD stage and pannerDirection's elevation fix
  would then disagree with the panners, so per-voice rotation is the design (Cat3DA rotates the scene for the same reason:
  one transform for everything it renders).
- Smoothing and clamp: one-euro filter on the pose (as Cat3DA); clamp yaw to the angle where the face is still tracked
  [guess: Cat3DA uses 35 degrees; ours to be measured by the probe below]. Recentre by a key (the pilot faces the screen,
  presses it: that pose becomes zero) and automatically when tracking starts.
- Switch-on for a blind pilot: one item in the Fly by Sound menu, "Turn my head to listen", reached by keys like every item.
  Pressing it speaks first, in the four locales: what the camera is for (only to know where your head points, so sounds
  stay put when you turn), that no picture leaves the computer, and that the browser will now ask. Only then getUserMedia.
  A spoken result follows: "Head tracking on, face the screen and press R to centre" or the refusal reason. Never at load.
- Face lost: hold the last pose for 0.5 s [guess], then glide back to straight ahead over 0.3 s [guess], say once "head
  lost" with a soft sound; resume silently when the face returns. Craft-frame codes keep working throughout, so losing the
  face never loses information, only the movement cue.

### 1.4 Build stages and their checks

1. H1 package math: headPose input, inverse rotation before pannerDirection and ILD. Unit test: a cue at world bearing 30
   degrees, head yaw +30 gives panner direction straight ahead; head yaw 0 gives 30; foldToFront and elevationSteps outputs
   identical with and without headPose. Negative control on the old code.
2. H2 recorded head turn (offline): a scripted pose track (yaw 0 to 60 to 0 over 3 s) through the virtual listener rig
   (pnpm listen in the package). Check: the interaural level and time difference of a fixed beacon follow the inverse turn,
   so the cue stays in the world; a control run with headPose ignored fails the check.
3. H3 tracker in a worker in the simulator, behind the menu item: a headless probe feeds a recorded webcam clip (fake
   device via Chrome's --use-file-for-fake-video-capture) and reports pose per frame, frame time and the share of frames
   with a face. This is where the per-frame cost and the motion-to-sound delay (video timestamp to panner update) get their
   first measured numbers.
4. H4 nginx camera=(self) on the simulator page, local serve-csp run showing the permission prompt path works and that
   other pages still refuse the camera.
5. H5 ear check with people: front-back quadrant errors with and without tracking on the ear pilot's lesson set
   (sonic3-plan section 4) and later with Bartlomiej Mroz after 15 December.

## 2. Picking an HRTF by a short listening test

- SADIE II (University of York): licence Apache 2.0 [read, https://www.york.ac.uk/sadie-project/database.html and Zenodo
  record 12092466 "apache2.0"]. Its page: "The original dataset must be referenced whenever used in original or modified
  form." [read]. Citation: the paper "A Perceptual Evaluation of Individual and Non-Individual HRTFs: A Case Study of the
  SADIE II Database", doi 10.3390/app8112029 [read]. Subjects: 20 (D1 KU100, D2 KEMAR, H3 to H20 humans) [read].
  Directions: 8802 for the dummy heads, 2818 for H3 to H8, 2114 for H9 to H20 [read]. Format AES69 SOFA (and WAV) [read].
  Files: each HRIR zip 9.2 MB to 12.6 MB, dummy heads 38 MB [measured, Zenodo API]; H20's zip holds 44.1 kHz 16-bit 256 taps
  (8,753,949 bytes), 48 kHz 24-bit 256 taps (8,753,949), 96 kHz 512 taps (17,413,619) [measured].
- HUTUBS (TU Berlin): licence Creative Commons Attribution 4.0 [read, https://depositonce.tu-berlin.de/handle/11303/9429],
  96 subjects [read], HRIRs.zip 1.27 GB [read]; cite doi 10.14279/depositonce-8487 and the JAES article
  doi 10.17743/jaes.2019.0024 [read]. Measured and simulated sets per subject in SOFA [read, irdl docs
  https://artpelling.de/irdl/_generated/datasets/hutubs_dataset.html]; direction count and sample rate not read today (the
  documentation PDF on core.ac.uk refused this agent with 403; the lead reads it).
- May an open-source project ship a subset? Both licences allow redistribution of modified parts [read: Apache 2.0 and
  CC BY 4.0 both permit it]. Conditions: keep the licence text and a NOTICE line for SADIE II (Apache 2.0 section 4) and
  state the changes (resampled, reduced directions); credit and licence link for HUTUBS. Both also fit a phone app.
- Size of a shipped set: 48 kHz, 256 taps, float32, two ears: a 100-direction subset is 100 x 2 x 256 x 4 = 204,800 bytes
  per subject [arithmetic]; 8 candidates about 1.6 MB before compression. A spherical-harmonic or interpolated form is smaller
  [guess].
- What the package uses today: Chrome's built-in PannerNode HRTF (panningModel 'HRTF', src/audio/engine.ts line 287) [read];
  the Web Audio API cannot load another set into PannerNode [guess, matches sonic3-plan 5.2]. So a chosen set needs our own
  binaural stage: per moving voice two ConvolverNodes swapped at direction changes, or an AudioWorklet with an interpolated
  HRIR (8 moving voices, voices.ts MAX_MOVING_VOICES = 8 [read]). Loading: a small JSON or binary file per candidate built
  at release time from the SOFA (a node script reads SOFA as netCDF4/HDF5 [guess: a library is needed]), fetched on demand.
  Its CPU cost is measured before it ships.
- The five-minute test, keys only [design]: 6 candidate sets (KU100, KEMAR and 4 humans chosen for spread [guess]). Per set
  8 trials: a short broadband burst (noise with the package's air, 300 ms, twice) from one of front, back, left, right,
  front-up, back-up, in random order. Spoken question: "Where was it? Arrow up front, down behind, left, right; add Shift if
  it was above." One trial about 5 s, 48 trials about 4 minutes [estimate]. Score per set: quadrant errors (front-back
  first), ties broken by elevation errors. Then the best two face each other in 6 paired trials ("which one sounded more
  outside your head, 1 or 2"), with and without the light reverb (his last point). Winner = fewer quadrant errors, then the
  pair vote.
- Where the result lives: a sonic pref (for example hrtfSet: id string, default 'browser') in the package's prefs
  (src/prefs/prefs.ts KEYS list), which means a new localStorage key path in the simulator: packages/prefs/test/migrate.test.ts
  and the pinned tables of docs/agent-map.md apply when it is built. The trial answers stay in the session only.

## 3. Motion-sensor headphones and a phone app for blind walkers

- Web today [guess, not read today; the lead checks MDN]: DeviceOrientationEvent and DeviceMotionEvent give the phone's
  attitude (Chrome Android, Safari iOS after DeviceOrientationEvent.requestPermission on a tap, HTTPS only); WebXR
  immersive-ar gives a 6-DoF phone pose on Chrome Android only (our nginx sends xr-spatial-tracking=() today [read]); no
  browser exposes the motion sensors of headphones. The phone's own attitude is the walker's body or hand, not the head.
- Native only [guess]: headphone head motion is iOS CMHeadphoneMotionManager (AirPods with spatial audio) and Android 13+
  head-tracker sensors through the Spatializer path; LiDAR depth on iPhone Pro; ARCore Depth on Android.
- Where it lives: a separate app and repository (name with Shramko, sonic3-plan 5.3) reusing the package's DOM-free core;
  the phone's depth implements SonicWorld castRay, walking speed replaces craft speed in the reach-in-seconds rule.
- Smallest experiment that shows whether the sound language works for walking: no app yet. A web page on Chrome Android
  using WebXR depth or the camera with a depth model is still too much; the smallest is the simulator itself: a "walk"
  scene in an open room at 1.4 m/s [guess, typical walking speed] with the wall and gap cues, flown by a blind tester on a
  phone in hand, phone attitude as the heading. Question answered: can the tester find a doorway and stop before a wall by
  sound alone, with the same cues as in flight. Only if yes, a native prototype with headphone tracking.
- Risks: safety first (the app must never be the only aid; open-back or bone conduction headphones so traffic stays audible;
  no cue may mask street sound); latency (camera depth plus inference plus audio: tens to hundreds of ms [guess], a moving
  obstacle may be wrong by the time it sounds); false negatives on glass, kerbs and holes; battery and heat; privacy of
  people filmed in the street (frames stay on the phone).

## 4. The three papers

- Wenzel, Arruda, Kistler and Wightman 1993, doi 10.1121/1.407089 (abstract read via Europe PMC, PMID 8354753): 16
  inexperienced listeners localised noise bursts in the free field and over headphones with one other person's HRTFs; once
  confusions were resolved most were accurate, but front-back and up-down confusions rose markedly with virtual sources.
  For us: left-right from a generic HRTF is reliable; front-back and height are not, so they need our own codes (rear
  timbre, height tone).
- Wightman and Kistler 1999, doi 10.1121/1.426899 (abstract read via Europe PMC, PMID 10335634): front-back confusions
  "nearly disappeared" when head movements were encouraged, and also when the listener (not the experimenter) moved the
  source. For us: the pilot turning the craft by the stick is already a valid cue if the pilot drives it, so teach the small
  yaw sweep in the lessons; head tracking adds the same cue without flying.
- Begault, Wenzel and Anderson 2001, J. Audio Eng. Soc. 49(10) 904-916 (only the short abstract read via Europe PMC,
  PMID 11885605; the AES page https://aes2.org/publications/elibrary-page/?id=10175 is paywalled): speech over headphones,
  head tracking, individual HRTFs and reflections compared; significant effects on azimuth and elevation error, reversals
  and externalisation. A 2025 paper summarises that individual HRTFs did not beat non-individual ones for tracked listeners
  [read, search snippet of https://arxiv.org/pdf/2510.09161v1]. For us: head tracking before HRTF picking; reverb for
  externalisation. Full text not opened: he offered his academic access.

## What to build first and why

1. Teach the stick yaw sweep in a voiced lesson: zero code risk, and Wightman and Kistler show source motion the listener
   drives resolves front-back.
2. H1 and H2 (headPose in the package, recorded head-turn check): small, testable offline, needed by both web and phone.
3. H3 and H4 (MediaPipe in a worker, camera=(self) on the simulator page only): the measured frame cost decides if it ships.
4. HRTF picking after that: it needs our own binaural renderer, and the 2001 study suggests tracking matters more.
5. The walking app waits for a blind tester's walk scene in the simulator; native work only if that passes.

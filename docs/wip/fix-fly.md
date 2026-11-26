# fix-fly (train 5): accept-fly B10 navigation timeout on the live site

## Status

- [ ] S1 reproduce and decide: (a) the page or (b) the probe
- [ ] S2 repair and prove, as the answer says

S1 notes so far:
- Live run 1 (2026-11-21, U:/Temp/gsfpv-train4/ship-car5/live/accept-fly.log) did not fail on the page: it died in
  `browserType.launch` (Chrome closed at start, accept-fly.ts:120), before any navigation. Only run 2 shows the timeout.
- Isolated repro (B9's three opens, key P, drone picker, then the B10 address) on the live site: the navigation
  reached `load` in 0.7 s (U:/Temp/gsfpv-train4/fix-fly/live1.json). Next: replay B6 B7 B9 B10 in order, instrumented.

## Claims

## Not verified

## For the lead

## Cost notes

# Train 4 integration

## Status

Car 1 (job int4-car1, work copy C:/dev/gsfpv-v13-int, branch train4 from e3201fec).

- [ ] S1 the merges (car 1: the lanes whose review said SHIP when S1 reached them)
- [ ] S2 the seams between car 1 lanes, the one full check
- [ ] S3 the hand-over (U:/Temp/gsfpv-train4/int4-car1.json)

## Progress

Car 1

- site4: merged (review SHIP), no conflict
- ux4a: car 2 (review Verdict: HOLD when S1 reached it)
- edit4b: merged (review SHIP); one conflict, evidence/2026-11-19/b-repo-b18.json (add/add, a gate's output): took edit4b's file whole, S2's gates write it again; no source conflict, so the typecheck waits for the last merge
- ux4b: car 2 (review Verdict: HOLD)
- vox4: car 2 (no review file)
- gen4a: car 2 (no review file)
- gen4b: car 2, needs gen4a (review SHIP, but on a tree without gen4a planCourse is the S0 stub that uses only the seed: the level and spread buttons of the Generate dialog would change nothing)
- edit4a: car 2 (no review file)
- menu4: merged (review SHIP); the same b-repo-b18.json add/add conflict only, menu4's file taken whole
- tails4: merged (review SHIP), no conflict
- edit4s: car 2 (review Verdict: HOLD)
- edit4c: car 2 (no review file)
- sound6: car 2 (no review file)

## Seams

Car 1

## Deploy order

Car 1

## Live checks

Car 1

## What the owner should try

Car 1

## Not verified

Car 1

## Cost notes


# Train 4 integration

## Status

Car 1 (job int4-car1, work copy C:/dev/gsfpv-v13-int, branch train4 from e3201fec).

- [x] S1 the merges (car 1: the lanes whose review said SHIP when S1 reached them): 71e9f0d0 site4, 37d6c672 edit4b,
      8eaa97c5 menu4, b174107b tails4, 3e7a7c6e head4; the car 1 list is closed (a second look at the review files after
      the last merge found no new SHIP); every merged lane head is an ancestor of HEAD; pnpm install --frozen-lockfile,
      gen-catalog (everything up to date, no change) and pnpm -r typecheck (rc 0) on 3e7a7c6e
- [ ] S2 the seams between car 1 lanes, the one full check
- [ ] S3 the hand-over (U:/Temp/gsfpv-train4/int4-car1.json)

## Progress

Car 1 (one line a lane, in the merge order)

- site4: merged 71e9f0d0 (review SHIP), no conflict
- ux4a: car 2 (review Verdict: HOLD when S1 reached it, and again after the last merge)
- ux4b: car 2 (review Verdict: HOLD, both looks)
- vox4: car 2 (no review file, both looks)
- gen4a: car 2 (no review file, both looks)
- gen4b: car 2, needs gen4a (review SHIP, but on a tree without gen4a planCourse is the S0 stub that uses only the seed: the level and spread buttons of the Generate dialog would change nothing)
- edit4a: car 2 (no review file, both looks)
- edit4b: merged 37d6c672 (review SHIP); one conflict, evidence/2026-11-19/b-repo-b18.json (add/add, a gate's output): edit4b's file taken whole, S2's gates write it again; no source conflict
- edit4s: car 2 (review Verdict: HOLD, both looks)
- edit4c: car 2 (no review file, both looks)
- menu4: merged 8eaa97c5 (review SHIP); the same b-repo-b18.json add/add conflict only, menu4's file taken whole
- tails4: merged b174107b (review SHIP), no conflict
- head4: merged 3e7a7c6e (review SHIP), no conflict (adds @mediapipe/tasks-vision 1.2.3 to apps/fly and the lock)
- sound6: car 2 (no review file, both looks)

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

- S1 (car 1): about 20 replies; the most went to deciding whether gen4b stands without gen4a (its status file and the
  plan.ts stub). Cheaper: a one-line 'needs: <lane>' field in each lane's status head, and gate B18 writing its evidence
  under the lane's own folder so that every merge does not meet the same add/add conflict in b-repo-b18.json.


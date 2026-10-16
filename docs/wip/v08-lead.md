# v0.8 lead handoff (read this first after any interruption)

Plan: `docs/wip/v08-plan.md`. Each lane's own status: `docs/wip/v08-<lane>.md` in its worktree. Project skill: `/gsfpv`.

## State (2026-10-16)

- Live: release 26d594279ed6 (`main` 097300d: DJI RC 3 / any HID game controller by its descriptor; admin Outreach tab).
- Base of v0.8: `0df437d` (plan). Lanes in `C:/dev/gsfpv-v08-{a,b,c,d}` (branches `v08-*`), workflow wf_07841db3-172:
  each lane implement -> one review -> fix, all four at once, RESUME-FIRST prompts with checkpoints.
- If cut off: `/limit-resume` (digest of wf_07841db3-172), new continuation prompts per lane, never rerun.

## Merge and ship (after the lanes)

1. Merge a, b, c, d into v03-lead (fetch origin/main first: other sessions push there); gates; B18 checked explicitly.
2. Local release: accept-fly (SITE=localhost), wizard-auto-check + hid-source-probe (base with /en), each lane's bench.
3. Ship per /gsfpv section 6 (API first if apps/api changed), live checks, STATE + vault.
4. Owner checks that need him: the DJI controller-check screen on his real controller, a tablet, the keyboard scheme.

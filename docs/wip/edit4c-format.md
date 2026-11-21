# Course format change for gate looks and markers (lane edit4c C3, brief 545, 557)

Status: SPEC ONLY. Nothing here is built. The course file format lives in the Fly by Sound package
(packages/sonic-fpv, its own repository, pinned by commit 293ebae); AGENTS.md forbids editing it here, and a format
change needs the owner's yes. This file is what the change in that repository and the pin move would be.

The owner's words (brief 557): "for a ring there should be a choice of its style: neon, or a cloth ring, or some
texture ... think what is used most at races. Later we may put our own logos on these rings and frames." Brief 545:
"or just a pole, as they use at races. Or a flag."

## 1. Today

- `TrackFile` = `shramko-sonic-track/1` (packages/sonic-fpv/src/contract.ts `FORMATS.track`).
- `TrackGate` = `{ id, shape, pos, quat, direction }`; `shape.kind` one of `GATE_KINDS` = ring, square, cube-frame
  (track/validate.ts 21; apps/api/tracks.py 91).
- Both validators are strict: `keys()` refuses an unknown key AND a missing one (tracks.py 152-158, validate.ts 110).
  So any new field must be added to both, as OPTIONAL, or every old file breaks.
- `ObjectShape` already has `pillar { radius, height }` (lesson objects), but it is not a gate kind.
- The editor's pieces (C2, packages/tracks/src/pieces.ts) are ordinary square gates: no format change was needed.

## 2. The look of a gate (E13): data of the element, not a new kind

```ts
export const GATE_LOOKS = ['plain', 'fabric', 'led'] as const;
export type GateLook = (typeof GATE_LOOKS)[number];

export interface TrackGate {
    readonly id: string;
    readonly shape: ObjectShape;
    readonly pos: Vec3;
    readonly quat: Quat;
    readonly direction: 'forward' | 'any';
    /** how it is drawn; absent = 'plain' (every file made before this change) */
    readonly look?: {
        readonly kind: GateLook;
        /** '#rrggbb'; absent = the look's own colour */
        readonly color?: string;
        /** always null until an asset allowlist exists (logos come later) */
        readonly logo?: null;
    };
}
```

- `plain`: the drawing of today (the course view's flat material). Default when `look` is absent.
- `fabric`: a cloth skin over a frame, the grassroots MultiGP gate (1.5 m / 5 ft square PVC frames with printed
  fabric skins). Default for NEW pieces and new gates once built: the most used look at club races.
- `led`: a lit frame, the 'neon' look the owner names (DRL lit gates, DCL inflatable LED gates and arches). Drawn
  as an emissive material; no extra light source (cost on weak devices).
- `color` is free; `logo` is reserved: the validators accept only `null` for it, so no file can point at an outside
  picture before an allowlist and a size rule exist.
- Judging is unchanged: the look never enters laps.ts, collision or the walls check. Same physics for every look.

Validation (both places, the same rules): `look` optional; when present, `kind` one of GATE_LOOKS; `color` optional,
`^#[0-9a-f]{6}$`; `logo` optional, must be null; no other key.

## 3. A pole and a flag (E12): a marker, judged by the side passed

Real races judge a pole or a flag by the side the pilot passes it on (MultiGP 'flags' are tall feather flags used as
turn markers; the marshal calls a missed side). The sim needs a judged element, so a marker is a gate kind of its own:

```ts
| { readonly kind: 'marker'; readonly form: 'pole' | 'flag'; readonly radius: number; readonly height: number;
    readonly side: 'left' | 'right' }
```

- The pass: crossing the half-line on the ground plane from the marker's axis to its `side` (in the marker's own
  frame, `quat` gives the way the course goes past it), within `MARKER_PASS_M` 3 m of the marker and below `height`.
  laps.ts builds a virtual gate 3 m wide on that side and judges it like a square gate with `direction` as given.
- Collision: the pole is a cylinder `radius` x `height` (the existing `pillar` drawing and wall test); the flag is
  the same pole plus a cloth part drawn only (no collision on the cloth: it bends at a race).
- Sizes (estimates, to measure): pole radius 0.05 m, height 2.5 m; flag height 3 m.
- The editor: two more Add list items, 'Pole' and 'Flag' (piece-menu.ts reads ADD_CHOICES; one table row each in
  pieces.ts), side chosen by the course's line at the click (the inside of the turn), the gate bar gets a 'Side' row.
- The walls check (check.ts): a marker has no opening; 'wall-in-opening' is skipped for it; legs run through the
  virtual gate's centre.

## 4. Order of work (not in the 3-hour train)

1. The owner says yes to the look list and to markers.
2. In the Fly by Sound repository: contract.ts (GATE_LOOKS, look?, the marker shape), track/validate.ts (optional
   keys: `keys()` needs an `optional` list), its tests and AGENTS.md. Format stays `shramko-sonic-track/1`: old
   files stay valid; a file with `look` or a marker is refused by an old page with a plain 'is not a known key'
   (the pin move and the API go together, so the live pair never disagrees).
3. Here: move the pin; apps/api/tracks.py (the same optional keys), server.ts; course/view.ts draws the looks
   (rules.ts paint stays the editor's state colour on top); laps.ts judges markers; pieces.ts gets Pole and Flag;
   the gate bar gets a 'Look' row (en es pl ru texts in fly/course-pieces).
4. Tests: an old file (no look) loads and draws plain; each look round-trips through both validators; a logo that is
   not null is refused by both; a marker passed on the wrong side gives no gate; a6-reference holds its hash (no
   flight change).
5. Deploy: API first (it accepts more), then the page.

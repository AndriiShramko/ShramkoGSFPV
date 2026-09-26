# ShramkoGSFPV v0.3: architecture and implementation plan

Status: design, 2026-09-25, lead architect. Nothing here is built yet. Baseline is the **v0.2 commit**: the radio wave, plus items 1, 2, 4, 5, 6, 8, 17, 22 and the pause-menu shortcuts of item 7.

Inputs:
- `research-a.md` (settings, modes, respawn, other sims, Betaflight OSD);
- `research-b.md` (SuperSplat catalogue, scene scale, recording, voxels);
- `research-physics.md` (Pavo20 feel);
- the scene-version and throttle-freeze diagnoses;
- Andrii's verbatim brief (vault note of the FPV simulator project, 2026-09-25, message 2);
- a read of the current working tree: `main.ts`, `session.ts`, `simclock.ts`, `runner.ts`, `sim.ts`, `params.ts`, `controls.ts`, `ui/flight.ts`, `ui/scenes.ts`, `scenes/index.ts`, `cinema.ts`, `calib.ts` ArmGate, `check-architecture.mjs` and the site scripts.

How to read the numbers:
- **measured**: taken from the research notes, which ran them.
- **measured today**: one new check I ran (0.3, D-e).
- **from code**: read in the source, not run.
- Everything else is **design**.

---

## 0. Scope, principles, findings

### 0.1 Items, parts and waves

| Item | What Andrii asked | Part | Wave |
|---|---|---|---|
| 3 | Settings option to turn crashes off, so a beginner flies longer | C.7, A | 1 (sim), 2 (UI) |
| 7 | End-of-flight statistics like the goggles OSD, shown with the panel of all options, with each option's key | D (+ keymap 1.2) | 1 (stats core), 2 (panel) |
| 9 | A tab in the scans section that shows what superspl.at shows, with the same filters | E.6 | 3 (phase 1), 4 (phase 2, only with permission) |
| 10 | From the crash menu, jump to the next favourite or a random highly rated scene; auto-switch toggle, default OFF; default rotation = admin-curated scenes | E.2 to E.5 | 3 |
| 11 | The user can rescale a wrong-size scene around the drone | E.7 | 1 (collision), 3 |
| 12 | Show every setting on the site and on GitHub | I | 2, re-run each wave |
| 13 | Keep every setting (drones, scenes, everything) across visits; export and import them | A | 1, 2 |
| 14 | Auto-record on/off next to the record button, into the last chosen folder | F.2 | 3 |
| 15 | Click the ACRO label to pick another mode, and remember it forever | B | 1 (sim), 2 (UI) |
| 16 | Start from an invisible platform at spawn height | C.2 | 1, 2 |
| 18 | If lying in a weird pose or stuck, restart automatically like Liftoff | C.6 | 1, 2 |
| 19 | Record video at 60 fps | F.1, F.3 | 3, 4 |
| 20 | Settings must not come back to defaults; reset one or all | A | 1, 2 |
| 21 | Physics does not feel like the real Pavo20s | H | 1 (data + model), 4 (blackbox) |
| 23 | After a crash, respawn 5 s earlier on a platform, within 2 s; R = start; self-level by default for everyone | C, B, A defaults | 1, 2 |
| 24 | Voxel overlay with opacity and style; hide the scan and fly the voxels; phantom walls | G | 1 (mesh), 3 (overlay), 4 (fix) |
| 25 | No crutches | the whole document | all |

Items 15 and 23 conflict. Item 15 says "default ACRO"; item 23 says later "all the same, by default for everyone self-levelling". Item 23 wins, as the vault note already records. Default: **angle**.

### 0.2 Principles (item 25)

1. **One source of truth per concern.**
   - The preferences store holds every value the user can change.
   - The keymap is the single table behind key handlers, menu key-caps and the catalogue.
   - The setting schema generates the settings UI, the site section, `docs/settings.md` and the README block.
2. **Anything that moves the drone lives in sim-core and in the log.** That covers modes, the platform, crash-off, respawns and world scale. The page never writes flight state. Every respawn, automatic or manual, is a log record, so replays stay bit-exact.
3. **The page is composed from feature modules.** `main.ts` shrinks to composition. Each feature installs into one `FlightContext` and owns its files, which is what lets agents work in parallel.
4. **Contracts first.** Before each wave the lead commits the interface files named in section J, so parallel agents code against the same signatures.
5. **Every check has a negative control that must fire.** This is the existing repo rule, kept.

### 0.3 Defects this design removes

These are not patched one by one: each belongs to the part that replaces the broken mechanism.

| # | Defect | Evidence | Removed by |
|---|---|---|---|
| D-a | Physics and camera settings live only in `session.overrides`. "Change scan" reloads the page and drops them (item 20). | research-a (a) | A (store), E.4 (scene switch without reload) |
| D-b | `settingsFrom()` hard-codes `hud: true` and `quality: 0.7`, and re-reads reduced motion from the OS. Apply writes those values back. | research-a defect 2, from code | A (the panel reads the store) |
| D-c | Overrides leak across drones. After one Apply, `overrides.pid` and `tauMs` hold the current drone's values, and the drone picker passes them to the next drone (`rebuildSim(id, session.overrides)`). | from code, main.ts drone pick | A.6 per-drone scope |
| D-d | The safe point is sampled only when a frame ends on tick % 500: 0 updates per minute at steady 30/60/144 Hz. | research-a defect 3, measured | C.5 per-tick history |
| D-e | Log time is Int32 microseconds and wraps after 35.79 min of one flight model. Tick 2 147 484 is stored as -2 147 483 296 (`.cache/v02/arch-int32.ts`). With auto-respawn a pilot stays in one model for hours, so long logs would corrupt. | measured today | C.9 format /2 |
| D-f | Log and trajectory memory grow without bound: 36 B per applied input sample (about 65 MB/h at a 500 Hz radio) plus one trajectory object every 10 ticks (100/s). | from code, runner.ts | C.9 lives, trajectory from the log |
| D-g | Replays use the session's current params, not the log's. `configHash` hashes only `{overrides, presetId}`, not the preset content, and `startReplay` checks only simCore + collision. A PID change after saving a log makes its replay diverge silently. | from code | C.9 header v2 |
| D-h | Camera FOV and uptilt are physics overrides: changing them rebuilds the model and resets the flight to the spawn. | research-a (a), from code | A.7 apply 'live' |
| D-i | The battery state survives every respawn. A 550 mAh pack lasts about 5-6 min, so with item 23 keeping pilots in a scan, the craft sinks after a few minutes with no explanation. | from code, sim.ts respawn | C.8 |
| D-j | The recorder declares a 30 fps track but adds every rendered frame: 29 duplicate timestamps per second at 60 Hz. | research-b 3.1, measured | F.1 |

### 0.4 What v0.3 takes from v0.2

- `SimClock` (the freeze fix: `restart()` while paused).
- `ResolvedScene.version`, `posterUrl()` and `gsfpv.versions.v1`.
- Loading progress.
- The new calibration wizard and the `Profile` type.
- `PAUSE_KEYS` / `KeyHint` in `ui/flight.ts`.
- Auto-reconnect of a known radio.

---

## 1. Core structure (everything hangs on these)

```
packages/prefs  ── schema (+ defs per group) ── PrefsStore ── keymap ── buildCatalogue
      │                                                          │
      │ get / set / onChange                     scripts/gen-catalog.ts ─► site features.json,
      ▼                                                          docs/settings.md, README block
apps/fly/src/app ── FlightContext { prefs, session, controls, keys, menu, events, hud, crash }
      │                 ▲ install(ctx)
      │           features/* (settings, respawn, modes, summary, scene-rotation, scale, voxels, recording…)
      ▼
FlightSession (one per scene) ── SimClock (v0.2) ── Runner (lives, director hook) ── Sim
      │                                               │
 WorldController (collision + transform + filter)     StateHistory · RespawnDirector · FlightStats
 (session/world.ts)                                   (sim-core, deterministic, Node-testable)
```

### 1.1 FlightContext and feature modules (`apps/fly/src/app/`)

`main.ts` today is 725+ lines and wires everything. v0.3 splits it (wave 1, pure refactor) into:

- `app/boot.ts`: preflight, picker, the first-visit warning.
- `app/flight.ts`: builds the context and installs `FEATURES`.
- `app/context.ts`: the types below.
- `app/features.ts`: the list, one line per feature, append-only.
- `app/keys.ts`: the KeyRouter.
- `app/test-hook.ts`: `window.__gsfpv`.
- `app/test-modes.ts`: `?simradio`, `?lat`.

```ts
// app/context.ts
export type PauseReason = 'menu' | 'panel' | 'hidden' | 'scene' | 'export' | 'controls';
export interface AppEvents {
    sim: SimEvent;                      // every runner event, in order
    frame: { now: number };
    life: { index: number; reason: RespawnReason | 'start' };
    session: FlightSession;             // a new scene session (E.4)
    pause: { on: boolean; reasons: readonly PauseReason[] };
}
export interface FlightContext {
    readonly ui: HTMLElement;
    readonly canvas: HTMLCanvasElement;
    readonly renderer: SplatRenderer;   // created once by the shell (E.4)
    readonly prefs: PrefsStore;
    session: FlightSession;             // replaced on scene switch; listen to events.session
    readonly controls: Controls;
    readonly crash: CrashView;
    readonly hud: Hud;
    readonly keys: KeyRouter;
    readonly menu: MenuRegistry;
    readonly events: Bus<AppEvents>;
    readonly hook: TestHook;
    pause(reason: PauseReason): void;   // a pause stack: resumes only when every reason is released
    resume(reason: PauseReason): void;
}
export interface Feature { id: string; install(ctx: FlightContext): (() => void) | void }
export interface MenuItem { id: string; action: ActionId | null; labelKey: string; order: number; section: 'flight' | 'scene' | 'setup' | 'tools'; run(): void; enabled?(): boolean }
export interface MenuRegistry { add(item: MenuItem): () => void; items(): readonly MenuItem[] }
export class Bus<E> { on<K extends keyof E>(k: K, cb: (v: E[K]) => void): () => void; emit<K extends keyof E>(k: K, v: E[K]): void }
```

The pause stack builds on v0.2's `SimClock.pause`. Today one boolean is shared by the menu, panels and hidden-tab handling, so one close can resume while another panel is still open.

### 1.2 Keymap (`packages/prefs/src/keymap.ts`, pure data)

One table drives three things:
- the single `keydown` handler (`app/keys.ts`);
- the key-caps beside menu items (it replaces `PAUSE_KEYS`, same `KeyHint` shape, same `aria-keyshortcuts`);
- the catalogue.

```ts
export type ActionId =
    | 'pause.toggle' | 'respawn.start' | 'respawn.rewind' | 'crash.keep' | 'scene.next' | 'scene.random' | 'scene.favourite'
    | 'mode.cycle' | 'voxels.cycle' | 'hud.toggle' | 'scale.down' | 'scale.up' | 'record.toggle' | 'frameStats.toggle'
    | 'settings.open' | (string & {});   // v0.2 pause items keep the keys v0.2 shipped
export interface KeyBinding { action: ActionId; keys: readonly { code: string; shift?: boolean; cap: string; aria: string }[]; when: 'flight' | 'crash' | 'always'; labelKey: string }
export const KEYMAP: readonly KeyBinding[];
export function keysFor(action: ActionId): KeyHint[];
```

| Action | Keys | Shown at |
|---|---|---|
| Pause / resume, summary panel | Esc, P (v0.2) | HUD hint, panel title |
| Back to start (respawn at the spawn, on the platform) | R (v0.2) | summary, crash toast/panel |
| Rewind 5 s now | Y (Liftoff's rewind key, research-a (c) [L10]) | summary, crash panel |
| Keep the wreck (open the crash panel instead of auto-respawn) | Enter | crash toast |
| Next scene / random scene / next favourite | N / Shift+N / F | summary, crash |
| Flight mode cycle | M (keyboard flying already uses M) | HUD mode chip |
| Voxel overlay cycle (off, overlay, voxels only) | V | summary, voxel legend |
| HUD on/off | H | summary |
| Scene size down / up (around the drone) | [ / ] | scale row |
| Record | F9 | cinema bar |
| Frame stats | F3 (existing) | settings |
| Settings | O | summary |

The router ignores keys while an `input`, `textarea` or `select` has focus. A unit test asserts that no code is bound twice in the same `when`, and that no menu action uses a keyboard-flying key: W, A, S, D, the arrows, and Space (arm). M is shared on purpose, because it is the same action.

Radio aux switches bound to actions (respawn, rewind, mode) are a later extension on `Controls` channels 6-7. They are not in v0.3.

### 1.3 Namespaced i18n dictionaries

Five parallel agents editing the same four locale files is the likeliest merge conflict. New keys therefore go into namespaced files, `packages/i18n/locales/fly/<ns>/<lang>.json`. The existing flat `locales/fly/<lang>.json` stays.

- `apps/fly/src/i18n.ts` merges them with `import.meta.glob(..., { eager: true })`.
- New vitest `packages/i18n/test/fly-parity.test.ts` checks, for every namespace:
  - the same keys and placeholders in en/es/pl/ru;
  - no Cyrillic in `en`.

  This check does not exist today; only the site dictionary is checked.

Namespaces used below: `prefs`, `set`, `group`, `mode`, `respawn`, `stats`, `summary`, `rotation`, `superspl`, `scale`, `voxels`, `rec`, `keys`.

### 1.4 Architecture rules added to `scripts/check-architecture.mjs`

- `packages/prefs/src/**` touches no DOM globals, except `browser.ts`.
- sim-core rules stay as they are, and the new sim-core files obey them: no `Math.sin` or `Math.random`, no clock.
- The site still imports only generated JSON, never simulator packages.

---

## A. Preferences store (items 13, 20; defaults of 3, 15, 16, 18, 23; feeds 12)

### A.1 Modules

| File | Content |
|---|---|
| `packages/prefs/package.json` | `@gsfpv/prefs`, no dependencies |
| `src/schema.ts` | types, `defineSettings()`, validation of defs |
| `src/defs/{flight,crash,camera,display,stats,input,drone,tune,scenes,scene,voxels,recording}.ts` | setting definitions, one file per owner (J); a file is not a group: `scene.ts` holds the scene-scoped `scene.transform` (group scenes) and `scene.dropFloaters` (group voxels), `stats.ts` holds `stats.onDisarm` (group display) |
| `src/defs/index.ts` | `SCHEMA` = all defs in group order |
| `src/keymap.ts` | 1.2 |
| `src/doc.ts` | `PrefsDoc`, collection types and validators, canonical JSON |
| `src/store.ts` | `PrefsStore` |
| `src/migrate.ts` | `MIGRATIONS`, legacy import |
| `src/io.ts` | export, import, merge, `ImportReport` |
| `src/catalog.ts` | `buildCatalogue(schema, keymap, dicts, presets)` |
| `src/browser.ts` | `LocalStorageBackend`, `CookieValue` (language), `requestPersistence()`, `IdbKv` |
| `test/*.test.ts` | A.11 |

### A.2 Schema

```ts
export type Scope = 'global' | 'drone' | 'scene';
export type Apply = 'live' | 'life' | 'reload';
export type Surface = 'settings' | 'hud' | 'pause' | 'crash' | 'picker' | 'controls' | 'cinema' | 'key' | 'url';
export type GroupId = 'flight' | 'crash' | 'camera' | 'display' | 'input' | 'drone' | 'tune' | 'scenes' | 'voxels' | 'recording';
export type Status = 'shipped' | 'planned' | 'test';     // planned: stored and validated, hidden from the UI and the catalogue
export type Unit = 'deg' | 'ms' | 's' | 'm' | 'mps' | 'mps2' | 'x' | 'pct' | 'per_s' | 'blocks' | 'min';
export interface PresetRef { preset: string; scale?: number }   // default/min/max read from the drone preset field
interface Base<T> {
    id: string;              // '<group>.<name>', stable forever; a rename is a migration
    group: GroupId;
    scope: Scope;
    default: T | PresetRef;
    apply: Apply;
    shown: readonly Surface[];
    status: Status;
    since: number;           // schema version that introduced it
    label?: string;          // i18n key, default `set.<id>`
    help?: string;           // i18n key, default `set.<id>.help`
    action?: ActionId;       // key that changes it, shown beside the row
    url?: string;            // legacy / diagnostic URL parameter (session layer only)
    advanced?: boolean;
    items?: readonly number[];   // brief items it answers (catalogue, tests)
}
export interface BoolDef extends Base<boolean> { type: 'bool' }
export interface NumDef extends Base<number> { type: 'number'; min: number | PresetRef; max: number | PresetRef; step: number; unit?: Unit; curve?: 'linear' | 'log' }
export interface EnumDef extends Base<string> { type: 'enum'; options: readonly string[] }
export interface JsonDef<T = unknown> extends Base<T | null> { type: 'json'; kind: 'pid' | 'rates' | 'throttle' | 'transform' | 'folder'; validate(v: unknown): T | null }
export type SettingDef = BoolDef | NumDef | EnumDef | JsonDef;
export const SCHEMA_VERSION = 1;
export interface Schema { version: number; defs: readonly SettingDef[]; byId: ReadonlyMap<string, SettingDef>; groups: readonly GroupId[] }
export function defineSettings(defs: readonly SettingDef[]): Schema;   // throws on duplicate id, default outside range/options
```

### A.3 Store API

```ts
export interface Ctx { drone?: string; scene?: string }
export interface PresetResolver { field(presetId: string, key: string): number | undefined; curatedScale?(sceneId: string): number | undefined }
export interface Backend { read(): string | null; write(text: string): boolean; onExternal?(cb: () => void): () => void }
export type ChangeSource = 'user' | 'import' | 'reset' | 'migration' | 'external' | 'session';
export interface PrefChange { id: string; scope: Scope; key: string | null; value: unknown; previous: unknown; source: ChangeSource }
export type SetResult = { ok: true; value: unknown; clamped: boolean } | { ok: false; reason: 'unknown-id' | 'type' | 'range' | 'option' | 'no-context' };
export type CollectionId = 'radioProfiles' | 'sceneLibrary' | 'stats' | 'ui';

export class PrefsStore {
    constructor(schema: Schema, backend: Backend, presets: PresetResolver, o?: { now?: () => number; debounceMs?: number });
    get<T = unknown>(id: string, ctx?: Ctx): T;             // session layer ?? stored entry for the scope ?? default(ctx)
    defaultOf<T = unknown>(id: string, ctx?: Ctx): T;
    isExplicit(id: string, ctx?: Ctx): boolean;             // drives the "changed" dot and the reset button
    set(id: string, value: unknown, ctx?: Ctx): SetResult;  // stores explicitly, even when equal to the default
    reset(id: string, ctx?: Ctx): void;
    resetGroup(group: GroupId, ctx?: Ctx): void;
    resetAll(o?: { settings?: boolean; collections?: readonly CollectionId[] }): void;
    setSession(id: string, value: unknown): SetResult;      // URL / test layer, never persisted
    explicitList(ctx?: Ctx): { id: string; scope: Scope; key: string | null; value: unknown }[];
    collection<K extends CollectionId>(k: K): Readonly<Collections[K]>;
    updateCollection<K extends CollectionId>(k: K, fn: (draft: Collections[K]) => void): void;
    onChange(cb: (c: PrefChange) => void): () => void;
    exportFile(o?: { include?: readonly CollectionId[] }): PrefsFile;
    previewImport(file: unknown): ImportReport;
    importFile(file: unknown, mode: 'replace' | 'merge'): ImportReport;
    flush(): void;                                          // pagehide / visibility hidden
    readonly writable: boolean;                             // false: private mode or blocked storage
    persisted: 'yes' | 'no' | 'unknown';                    // navigator.storage.persisted(), set by browser.ts
}
export interface ImportReport { ok: boolean; fromVersion: number; changes: { id: string; key: string | null; from: unknown; to: unknown }[]; clamped: string[]; dropped: { id: string; why: string }[]; unknown: string[]; collections: Record<CollectionId, { added: number; changed: number }>; error?: 'not-a-settings-file' | 'newer-version' | 'corrupt' }
```

### A.4 Document and file format

There is one localStorage key, `gsfpv.prefs.v1`. The export file is the same document plus `exportedAt` and `origin`, named `gsfpv-settings-YYYY-MM-DD.json`.

```jsonc
{
  "format": "gsfpv-prefs",
  "version": 1,
  "app": "0.3.0",
  "savedAt": "2026-10-02T09:14:03.120Z",
  "settings": {
    "global": { "flight.mode": "horizon", "respawn.rewindS": 5 },
    "drone":  { "pavo20pro-3s": { "physics.vCrash": 6, "camera.fovDeg": 120,
                                  "tune.pid": { "roll": [54,111,44,0], "pitch": [68,139,60,0], "yaw": [54,111,0,0] } } },
    "scene":  { "9d09ab82": { "scene.transform": { "s": 1.5, "t": [0.3, 0, -1.2], "v": 2 } } }
  },
  "collections": {
    "radioProfiles": { "v": 1, "items": { "<deviceKey>": { /* @gsfpv/input Profile, unchanged */ } } },
    "sceneLibrary":  { "v": 1, "history": [ { "id": "9d09ab82", "version": 2, "title": "…", "lastFlown": 1759400000000, "flights": 4, "airtimeS": 312, "hasCollision": true } ],
                       "favourites": ["39e63ce9"], "filter": { "collisionOnly": true, "kind": "all", "flown": "all", "maxMb": null }, "versions": { "9d09ab82": 2 } },
    "stats":         { "v": 1, "byDrone": { "pavo20pro-3s": { "flights": 41, "airtimeS": 3802, "distanceM": 21450, "crashes": 77 } } },
    "ui":            { "v": 1, "warned": true }
  }
}
```

- **Flight logs are not in the settings file.** They live in IndexedDB and have their own `.gsfpvlog` export.
- **Radio profiles are included.** They are keyed by device fingerprint, so the same radio model works on the other computer.
- **Import:**
  - The format is checked first. A file with `version` above `SCHEMA_VERSION` is refused ("made by a newer version"); an older one goes through migrations.
  - Each value is validated against its def. Out-of-range values are clamped and reported. Wrong types are dropped and reported. Unknown ids are kept in the doc (they survive a downgrade and upgrade) and reported.
  - A preview ("12 settings, 1 radio, 3 favourites will change") comes before applying.
  - Mode `replace` is the default, for moving to another computer.
  - Mode `merge`: radio profiles by `deviceKey`, favourites as a union, history by id with the latest `lastFlown`, and the imported value wins for settings.

### A.5 Persistence

- **Writes.** They are debounced 250 ms and flushed on `pagehide` and on `visibilitychange: hidden`. Andrii switches windows often, so a hidden tab is a natural flush point.
- **Writing without losing another tab's changes.** Each write re-reads the stored doc and applies only this tab's dirty entries, so two open tabs do not erase each other's changes. The `storage` event reloads the doc and emits `external` changes.
- **Persistence request.** `navigator.storage.persist()` is called on the pilot's first explicit change, which is a click; Firefox shows a prompt otherwise. Settings → Data shows the result.
- **IndexedDB `gsfpv`** (`IdbKv`) has three stores:
  - `handles`: the recording folder.
  - `logs`: saved flight logs, up to 50 MB with the oldest dropped. This replaces the single `gsfpv.lastLog`.
  - `blobs`: reserved.
  
  Settings stay in localStorage because the first frame needs them synchronously at boot.
- **Blocked storage.** The store runs in memory and one banner appears: "Settings can't be saved in this browser window (private mode or blocked storage)". Export still works.
- **Legacy migration v0 to v1**, run once on the first v0.3 boot:
  - `gsfpv.profiles.v1`, `gsfpv.stickMode`, `gsfpv.history.v1`, `gsfpv.favourites.v1`, `gsfpv.filter.v1`, `gsfpv.versions.v1` (from v0.2) and `gsfpv.warned` move into the doc.
  - `gsfpv.lastLog` moves to IndexedDB.
  - The legacy keys are left untouched for one release, so rolling back to v0.2 still works. Migration 1 to 2 in v0.4 deletes them.
- **Language.** It stays in the `NEXT_LOCALE` cookie, because the landing reads it. `ui.language` is a setting whose backend is that cookie, and it is exported with the rest.

### A.6 Layers, scopes, explicit semantics

- **Where a value comes from:** `get(id, ctx)` returns the first of:
  - the session layer: `?set.<id>=`, the legacy `?g=`, `?gm=` and `?drone=`, and the test hook;
  - the stored entry for the def's scope: global, `drone[ctx.drone]` or `scene[ctx.scene]`;
  - the default: a literal, or the preset field for `ctx.drone`. For `scene.transform`, the curated scale.
- **Drone scope removes D-c.** PID, rates, throttle curve, tau, drag, duct drag, idle, vCrash, TWR and camera FOV/uptilt each belong to one drone.
- **Explicit semantics.**
  - `set()` always stores, even a value equal to the default, and `reset()` deletes the entry.
  - If a later release changes a default, a pilot who chose the old value keeps it, and one who never touched it gets the new default.
  - This is how item 23's new defaults reach Andrii: he has no explicit `flight.mode` today.

### A.7 How changes apply

This removes "closing with x throws the edits away" and "Apply resets the flight".

- There is no Apply button. Every control writes to the store at once, so closing the panel never loses a change.
- **`live`** settings apply immediately through `onChange`: camera, display, mode, respawn policy, overlay, recording and rotation.
  - Camera FOV and uptilt leave `ParamOverrides` for good (D-h). They are render-only.
- **`life`** settings change the flight model. Changes collect while the panel is open and apply once when it closes: the session starts a new life at the drone's **current** position, level and still, on a platform, with its arm state kept (C.4). It does not go back to the spawn.
- **`reload`** is language only.
- Each row shows a badge: "applies now", "applies when you continue" or "reloads the page".

### A.8 Initial schema (status `shipped` once its wave lands)

| id | group | scope | type / range | default | apply | shown | item |
|---|---|---|---|---|---|---|---|
| `flight.mode` | flight | global | acro / angle / horizon | **angle** | live | HUD chip, settings, M | 15, 23 |
| `level.angleLimitDeg` | flight | drone | 10–85 deg | 60 (BF 4.5.1) | life | settings (adv) | 21 |
| `level.strength` | flight | drone | 0–200 | 50 (BF) | life | adv | 21 |
| `level.horizonStrength` | flight | drone | 0–200 | 75 (BF) | life | adv | 15 |
| `crash.enabled` | crash | global | bool | **on** (crashes exist) | life | settings, crash panel | 3, 23 |
| `physics.vCrash` | crash | drone | 2–10 m/s | preset `v_crash_ms` (4.0) | life | settings | 20 |
| `respawn.auto` | crash | global | bool | **on** | live | settings, toast | 23 |
| `respawn.delayS` | crash | global | 0.5–10 s | **2** | live | settings | 23 |
| `respawn.target` | crash | global | rewind / start | **rewind** | live | settings | 23 |
| `respawn.rewindS` | crash | global | 1–30 s | **5** | live | settings | 23 |
| `respawn.platform` | crash | global | bool | **on** | live (next respawn) | settings | 16, 23 |
| `respawn.keepArmed` | crash | global | bool | on | live | settings | 23 |
| `respawn.unstuck` | crash | global | bool | on | live | settings | 18 |
| `respawn.showPad` | crash | global | bool | off (Andrii: invisible) | live | settings | 16 |
| `battery.refill` | crash | global | start / respawn / never | start | live | settings | D-i |
| `camera.fovDeg` | camera | drone | 70–150 deg | preset (115) | live | settings | 20 |
| `camera.uptiltDeg` | camera | drone | 0–50 deg | preset (20) | live | settings | 20 |
| `display.hud` | display | global | bool | on | live | settings, H | 20 |
| `display.units` | display | global | metric / imperial | metric | live | settings | 12 |
| `display.quality` | display | global | 0–1 | 1.0 (today's effective value; the panel wrongly showed 0.7) | live | settings (adv) | 20 |
| `display.governor` | display | global | bool | on (was URL-only `?governor=0`) | live | adv | 12 |
| `display.reducedMotion` | display | global | system / on / off | system | live | settings | 20 |
| `display.frameStats` | display | global | bool | off | live | F3 | 12 |
| `stats.onDisarm` | display | global | bool | on | live | settings | 7 |
| `ui.language` | display | global | en / es / pl / ru | browser | reload | settings | 12 |
| `input.stickMode` | input | global | 1 / 2 | 2 | live | Controls screen | 1 |
| `drone.current` | drone | global | 6 preset ids | pavo20pro-3s | life | drone picker | 13 |
| `physics.gravity` | drone | global | 0–30 m/s2 (Earth/Moon/Mars/zero) | 9.81 | life | settings | 12 |
| `physics.gravityMode` | drone | global | honest / same-twr / auto-throttle | honest | life | settings | 12 |
| `physics.twr` | drone | drone | 2–8 | preset | life | adv | 21 |
| `physics.tauMs` | drone | drone | 8–30 ms | preset (15) | life | adv | 20 |
| `physics.dragScale` | drone | drone | 0.5–2 x | 1 | life | adv | 20 |
| `physics.ductDrag` | drone | drone | 0–1.5 1/s | preset `rotor_drag_per_s` (0.6) | life | adv | 21 |
| `physics.propInertia` | drone | drone | 0–3 x | 1 | life | adv | 21 |
| `physics.idlePct` | drone | drone | 0–15 % | preset `motor_idle` | life | adv | 21 |
| `tune.pid` | tune | drone | P/I/D/F x 3 axes, 0–250 | preset | life | settings | 20 |
| `tune.rates` | tune | drone | type + 3 axes (Betaflight import) | preset | life | settings | 21 |
| `tune.throttle` | tune | drone | mid / expo | preset | life | settings | 21 |
| `scenes.autoSwitch` | scenes | global | bool | **off** | live | settings, crash panel | 10 |
| `scenes.rotation` | scenes | global | curated / favourites / history | **curated** | live | settings | 10 |
| `scenes.order` | scenes | global | random / sequential | random | live | settings | 10 |
| `scenes.allowNoWalls` | scenes | global | bool | off | live | settings | 10 |
| `scene.transform` | scenes | scene | { s 0.25–4, t } | curated `scale` or 1 | live (world record) | summary row, [ ] | 11 |
| `scene.dropFloaters` | voxels | scene | 0–64 blocks | 0 (off) | life | settings | 24 |
| `voxels.show` | voxels | global | off / overlay / only | off | live | V, settings | 24 |
| `voxels.opacity` | voxels | global | 0–1 | 0.35 | live | settings | 24 |
| `voxels.style` | voxels | global | solid / grid / edges / height / floaters | grid | live | settings | 24 |
| `voxels.radiusM` | voxels | global | 5–40 m | 15 | live | settings | 24 |
| `recording.fps` | recording | global | 30 / 60 | **60** | live | cinema bar, settings | 19 |
| `recording.resolution` | recording | global | 1080p / 1440p / 2160p / native | 1080p | live | settings | 19 |
| `recording.auto` | recording | global | bool | off | live | cinema bar, next to REC | 14 |
| `recording.folder` | recording | global | { name } (handle in IDB) | none | live | cinema bar | 14 |
| `recording.splitMin` | recording | global | 1–30 min | 10 | live | adv | 14 |

That is 53 settings. Item 12 wants the count visible: it goes into the site and README headline (I.2).

### A.9 UI placement

- **How to open Settings:**
  - "Settings (O)" in the summary panel (D.2);
  - a gear in the top bar next to Controls and Pause;
  - "Settings" in the crash panel;
  - a deep link, `/{locale}/fly/?open=settings&focus=<id>`, used by the site catalogue.
- **Layout.**
  - A group rail: Flight, Crashes & respawn, Camera, Display, Controls, Drone & physics, Tune, Scenes, Voxels, Recording, Data. On phones it becomes an accordion.
  - A search box over labels, help text and ids.
  - Each row has: label, control, value with unit, a "changed" dot with a reset button (only when the value is explicit), the apply badge and a help toggle.
  - Drone-scoped rows say which drone ("for Pavo20 Pro 3S") and have a drone switcher. Scene-scoped rows show the scene title.
- **Controls by type:**
  - bool: switch;
  - number: slider plus number field;
  - enum: segmented control (4 options or fewer) or a select;
  - json kinds: registered editors (PID grid; rates, read-only with "Import from Betaflight"; folder chip; transform row).
- **Footers.**
  - Each group has "Reset this group".
  - Data has: Export settings, Import settings (file then preview dialog), Reset all settings, Erase everything (settings, radios, history, logs; with confirmation), and the storage status.

### A.10 i18n

- `prefs/*`: framework strings (`prefs.reset`, `prefs.resetGroup`, `prefs.resetAll`, `prefs.eraseAll`, `prefs.export`, `prefs.import.*`, `prefs.apply.live|life|reload`, `prefs.changed`, `prefs.storage.*`, `prefs.search`, `prefs.forDrone`).
- `set/*`: `set.<id>`, `set.<id>.help`, `set.<id>.opt.<value>`.
- `group/*`: `group.<id>`, `group.<id>.help`.

Existing `settings.*` keys are reused where the wording holds, then retired in v0.4.

### A.11 Tests

**Unit** (vitest, `packages/prefs/test`):

- Schema:
  - `defineSettings` throws on a duplicate id, a default outside its range and an enum default not in its options.
  - Control: the real SCHEMA passes.
- Layering:
  - session over drone entry over default; a `PresetRef` resolves per drone (Pavo20 Pro vCrash 4.0).
  - Changing `ctx.drone` returns the other drone's values (D-c regression).
  - Control: the same def made global leaks between drones, so the test can tell the two apart.
- Persistence:
  - set, then a new store on the same backend, gives the value back; reset gives the default; `resetGroup` touches only its group.
  - Control: `resetAll` clears the other group too.
  - A backend that silently drops writes is detected (`writable === false`).
- Explicit semantics: a changed default reaches a pilot with no entry but not one with an entry.
- Two tabs:
  - two stores on one shared backend: A sets x, B sets y, both survive.
  - Control: a whole-document overwrite loses x.
- Import and export:
  - A round trip is identical (canonical JSON). Merge rules hold. A newer version is refused. Out-of-range values are clamped and reported. Unknown ids are kept. Corrupt JSON is refused with a report.
  - Control: flipping one value in the file gives exactly one line in the preview.
- Migration:
  - A fixture of every legacy key, with real v0.2 shapes, migrates into the doc.
  - Running it twice is the same as once. Legacy keys are left untouched.
- Catalogue: see I.6.

**Browser** (`tools/bench/src/accept-v03-prefs.ts`, fresh Playwright contexts, never Andrii's profile):

- Item 20:
  - Set Crash threshold to 6.5. Change scene (a page reload before W3, in-page after). Reload. Open a new context on the same user-data dir ("days later"). The value is still 6.5.
  - Row reset gives 4.0 (the preset value). Reset all gives the defaults.
  - Control: the same run with storage blocked shows the banner and loses the value.
- Item 13: export, import into a fresh context, and `__gsfpv.prefs.explicitList()` plus the radio profile are identical.
- D-b: open and close Settings 5 times; the HUD state and quality do not change.
- D-h: changing FOV does not move the drone. Its position is continuous across the change, within 1 mm of the extrapolated path.
  - Control: the v0.2 Apply path jumps to the spawn.

### A.12 Risks

- localStorage quota: the document is estimated under 100 KB with 100 history entries and 5 radio profiles. Measure it in the test.
- Setting ids are forever; a rename must go through a migration.
- A 'life' change restarts the flight level and still at the same spot. The badge must say so.
- Firefox prompts for `persist()`, so it is only called on a click.

### A.13 Effort

- Package: L (about 900 LOC with tests).
- Settings UI and wiring: M (about 600 LOC).

---

## B. Flight modes (items 15, 23 default)

### B.1 Model (sim-core)

- **Mode on channel 5.** `ch[5]` carries the mode: -1 acro, 0 horizon, +1 angle.
  - `modeFromChannel(v)`: angle if v > 0.5, horizon if v > -0.5, else acro.
  - Because the mode is an input channel, it is already in the log and replays exactly. The HUD reads `sim.ch[5]`, as today.
- **Angle** follows Betaflight 4.5.1 `pidLevel()`, re-implemented from formulas (research-a (b)):
  - Target angle = `angleLimit * setpointRate(stick) / setpointRate(1)` per axis, so the rate curve shapes it.
  - Rate setpoint = (target - current) x `strength/10`.
  - Angle feed-forward is 0.5 x d(target)/dt through a PT3 (80 ms smoothing). The output goes through a PT3 at 50 Hz.
  - Rate-loop feed-forward is forced to 0 on levelled axes; ours is not today.
  - The angle limit changes from 55 to 60 deg.
  - Measured difference: at quarter stick ours tilts 13.8 deg and Betaflight 4.9 deg; at half stick 27.5 vs 16.6 (research-physics (c)). It matters because angle becomes everyone's default.
- **Horizon:**
  - strength s = max((135 - inclination)/135, 0) x max((0.75 - maxStick)/0.75, 0) x 0.75, with rises delayed by a PT1 of 500 ms;
  - setpoint = acro x (1 - s) + level x s.
- Earth-referenced yaw in angle mode (`angle_earth_ref`) is deferred to H, after blackbox data.
- **New state:** 15 doubles (2 x 3 PT3 output, 2 x 3 PT3 feed-forward, 1 horizon PT1, 2 previous targets).

```ts
// packages/sim-core/src/contracts.ts (lead, before wave 1)
export type FlightMode = 'acro' | 'angle' | 'horizon';
export const MODE_CHANNEL: Readonly<Record<FlightMode, number>> = { acro: -1, horizon: 0, angle: 1 };
export function modeFromChannel(v: number): FlightMode;
export interface LevelParams { limitDeg: number; gain: number; ffGain: number; ffSmoothMs: number; horizonStrength: number; horizonLimitSticks: number; horizonLimitDeg: number; horizonDelayMs: number }
// ParamOverrides gains: level?: Partial<LevelParams>
```

### B.2 App

- **`features/modes.ts`** owns the pilot's mode. It is prefs `flight.mode`: global, default angle, and persisted across scenes (Uncrashed keeps modes "across maps", research-a (c) [U5]).
  - `Controls.push` writes `ch[5] = MODE_CHANNEL[mode]` unless the radio profile has a mode switch.
- **Radio mode switch.**
  - `Profile` gains an optional `modeSwitch: { input: SwitchInput; modes: [FlightMode, FlightMode, FlightMode] }`, for switch low, mid and high. The profile stays version 1 and `parseProfile` tolerates the new field.
  - It is assigned on the wizard's check screen: "Mode switch: none / CH6 …".
  - With a switch assigned, the radio decides. The chip then shows the radio's mode, and its popover says the radio's switch sets the mode.
- **Keyboard and touch.**
  - Keyboard M cycles acro, angle, horizon; today it only toggles angle.
  - Touch sticks take the mode from prefs; today they are fixed to angle.
- **HUD mode chip** (`ui/mode-chip.ts`).
  - It is a separate `.interactive` button beside the top-left OSD line. That line is rebuilt with `innerHTML` every 100 ms inside `pointer-events: none` (research-a (d)), so it cannot hold a clickable element.
  - A click opens a popover with the three modes and the "M" key-cap.

### B.3 UI placement

- The HUD chip (top left).
- Settings → Flight.
- Key M.
- The summary panel header shows the current mode.

### B.4 i18n

- `mode/*`: `mode.acro|angle|horizon`, `mode.chip.title`, `mode.radioDecides`, `mode.help.*`.
- `set.flight.*`, `set.level.*`.

### B.5 Tests

**Unit** (sim-core, real `Sim`, no world):

- Steady tilt with stick 0.1 / 0.25 / 0.5 / 0.75 / 1.0 held for 2 s is 1.2 / 4.9 / 16.6 / 34.9 / 60 deg, within 0.3 deg.
  - Control: today's linear map (13.8 deg at 0.25) fails the table.
- Horizon:
  - From a 45 deg bank with centred sticks, the craft is within 3 deg of level after 1.5 s.
  - Full roll stick for 1 s rotates at least 90 % as far as acro.
  - Control: angle mode fails the rotation check, because it stops at 60 deg.
- Rate-loop feed-forward is exactly 0 on levelled axes and non-zero in acro.
- A mode change mid-air replays to the same hash.
- A mode change mid-air gives no motor-output step larger than 0.2 between ticks. Keep this check only if its control fires (a variant without the PT3 must show the step); otherwise drop it rather than ship a check that cannot fail.

**Browser:**

- Chip click then Horizon: the HUD shows HORIZON, prefs holds `flight.mode`, and after a reload it is still HORIZON. M cycles.
- Control: with a profile that has `modeSwitch`, a chip click leaves `ch[5]` at the radio's value.

### B.6 Risks and effort

- **Risks:**
  - Angle becomes softer around centre stick. That is Betaflight's feel, but pilots used to v0.2 will notice.
  - `Profile` additions must stay backward compatible.
- **Effort:**
  - sim-core: M (about 250 LOC plus tests).
  - App: M (about 250 LOC).

---

## C. Respawn system (items 16, 18, 23, 3)

### C.1 Pieces

| Piece | Where | Deterministic? |
|---|---|---|
| Platform (invisible one-way disc) | sim-core `sim.ts` + `platform.ts` | yes, part of the state |
| `RespawnOpts` (platform, keepArmed, soc) | sim-core `Sim.reset/respawn`, `Runner.respawn` | yes, logged |
| `crashOn` param | sim-core `params.ts` | yes, part of the config |
| `StateHistory` (rewind samples) | sim-core `history.ts` | yes |
| `RespawnDirector` (crash, delay, target, stuck, backoff) | sim-core `director.ts`, called by the runner after each step | yes |
| Lives, log format /2, header v2 | sim-core `runner.ts` | yes |
| Crash toast and panel, R/Y/Enter, pad ring, ArmGate pass-through | `apps/fly/src/features/respawn.ts`, `@gsfpv/input` ArmGate | UI only |

### C.2 Platform (item 16; item 23 respawns)

- **State:** `S.platOn, platX, platY, platZ, platR`, all hashed.
  - The top is at spawn y minus the lowest body point below the centre, minus 2 mm. For the Pavo20 that point is 0.030 m: the duct spheres sit at y = 0 with r = 30 mm.
  - Radius 0.4 m: the wheelbase is 94 mm, which leaves room to drift while spooling up.
- **Contact.** A `PlatformContact` wraps the scene's `ContactWorld` and adds a horizontal disc to `sweep` and `pushOut`.
  - Sitting, friction, bounce and "hard landing = crash" therefore use the same contact code as a real floor.
  - The disc is one-way: it stops a craft coming from above only. A craft respawned under an overhang is never trapped.
  - A craft resting on it produces no contact events: its approach speed is g x dt = 0.0098 m/s, below the 0.05 m/s event threshold (research-a (d)).
- **Retire rule** (from the state only): the platform turns off once the craft centre is 1.0 m above the top or 0.5 m outside the disc.
- **Opt-in only.** `measureTwr`, `dropTest`, `tunnelSelfTest` and the A-series harnesses never set it, because they rely on free fall.
- **Visible ring.** `respawn.showPad` draws a faint ring. It is off by default, because Andrii asked for an invisible platform.

### C.3 Arming without a button press (item 23)

- **In the sim.** With `RespawnOpts.keepArmed`, the craft respawns armed on the platform (armed = 1, armSw = 1, hold = 0) if the last applied arm channel is on (`ch[4] > 0.5`) at the respawn tick. If the switch is off, it respawns parked (hold), as today.
- **In `ArmGate`** (`@gsfpv/input`), a new option `keepArmedAfterCrash: boolean`:
  - While crashed, the gate outputs the raw switch level; `block` still reports `'crashed'` for the arm card. This is safe because the sim refuses to arm a crashed craft (sim.ts arming block).
  - When the `crashed` argument goes from true to false (that is the respawn) and the switch is on, the gate is armed at once, with no new off-to-on edge and no throttle-low requirement.
  - Today the gate masks the switch while crashed and then wants a fresh edge (calib.ts ArmGate). That is the button press item 23 wants gone.
- **Touch sticks** keep their arm state. Today `touch.setArmed(false)` runs after every respawn.
- **Throttle up at the respawn** lifts the craft off the platform at once, like a Liftoff reset.
- **Hidden tab.** It still disarms and still requires a new edge (v0.2 behaviour, a safety rule). It is not changed here.

### C.4 Respawn kinds

Every kind goes through `Runner.respawn`, which writes one log record.

| Kind | Trigger | Where it puts the craft | Options |
|---|---|---|---|
| `start` | R; summary "Back to start"; a crash when `respawn.target = start` | the spawn, with the scene transform applied | platform, keepArmed, fresh pack if `battery.refill` ≠ never |
| `rewind` | automatically after a crash (default); Y | history sample at or before the crash minus `rewindS`, plus backoff | platform, keepArmed, battery kept |
| `stuck` | director: flipped or wedged | as rewind | as rewind |
| `here` | a 'life' setting changed (A.7); a scale-down left the craft overlapping | current position, level and still | platform, keepArmed, battery kept |
| `scene` | auto scene switch or Next scene (E.5) | spawn of the new scene | platform, keepArmed, new session |

### C.5 StateHistory (replaces `trackSafePoint`, removes D-d)

- **Sampling.** One sample every 50 ticks (20 Hz), 60 s deep (1 200 samples): tick, x, y, z, yaw, safe.
- **Safe** means all of:
  - armed and not crashed;
  - no contact event in the last 300 ms;
  - `world.pushOut(x, y, z, boundRadius + 0.05)` is false. That is the same body test session.ts uses today, run per sample instead of per frame.
- **`pickBefore(crashTick, minAge)`** returns the newest safe sample at or before `crashTick - minAge`. If there is none it tries older ones; if there is still none it returns null, which means the spawn.

```ts
export interface HistorySample { tick: number; x: number; y: number; z: number; yawDeg: number; safe: boolean }
export class StateHistory {
    constructor(o?: { everyTicks?: number; capacity?: number; margin?: number; quietTicks?: number });
    onStep(sim: Sim): void;
    onEvent(e: SimEvent): void;
    pickBefore(tick: number, minAgeTicks: number): HistorySample | null;
    mapPositions(f: (x: number, y: number, z: number) => [number, number, number]): void;   // scene transform changed
    clear(): void;
}
```

### C.6 RespawnDirector (items 18, 23)

```ts
export type RespawnReason = 'crash' | 'stuck-flipped' | 'stuck-wedged' | 'manual-start' | 'manual-rewind' | 'settings' | 'scene' | 'world';
export interface RespawnOpts { platform?: boolean; platformR?: number; keepArmed?: boolean; soc?: number /* undefined = keep */ }
export interface RespawnPolicy {
    auto: boolean; delayTicks: number; rewindTicks: number; target: 'rewind' | 'start';
    onCrash: 'respawn' | 'next-scene';            // scenes.autoSwitch
    platform: boolean; keepArmed: boolean; unstuck: boolean;
    refill: 'start' | 'respawn' | 'never';
}
export interface RespawnRequest { x: number; y: number; z: number; yawDeg: number; opts: RespawnOpts; reason: RespawnReason }
export class RespawnDirector {
    constructor(policy: RespawnPolicy, spawn: () => [number, number, number, number], history: StateHistory, world: () => ContactWorld | null, boundRadius: number, hoverStick: number);
    policy: RespawnPolicy;
    onEvent(e: SimEvent): void;
    decide(sim: Sim): RespawnRequest | null;       // called by the runner after every step; applied at that tick
    request(kind: 'start' | 'rewind'): void;       // R / Y from the page; applied at the next tick
    onSceneIntent: ((tick: number) => void) | null;
}
```

**Rules:**

- **After a crash** at tick c with `auto` on: at c + delay the director returns a rewind (or start) request.
  - When `onCrash = next-scene`, it calls `onSceneIntent` instead, and the scene host loads the next scene (E.5).
- **Backoff.** A crash less than 3 s after the previous automatic respawn adds `rewindS` again: 5, then 10, then 15 s, up to the 60 s of history, then the start.
  - This breaks the loop where the rewind point itself leads straight into the wall.
- **Stuck, flipped** (Liftoff's rule: "laying still with the top part of the drone against something", research-a (c) [L5]): all of these for 1.5 s trigger a rewind:
  - not crashed;
  - the up-vector y (r11) is below 0.3, i.e. tilted more than 72 deg;
  - |v| < 0.2 m/s and |w| < 1 rad/s;
  - touching: `pushOut(boundRadius + 0.02)`.
- **Stuck, wedged:** all of these for 3 s trigger a rewind:
  - armed;
  - the throttle stick is at least hover + 0.15;
  - |v| < 0.1 m/s;
  - touching.
- **Never:** disarmed and upright (a landing), or while paused. The sim does not step while paused, so this holds by construction.
- **Cost.** The touch query runs every 10 ticks. The counters live in the director, not in the hashed state. Its decisions are logged, and it is deterministic, so the frame-split test covers it.
- **Auto off.** Nothing happens; the page shows the crash panel.

### C.7 Crash off (item 3)

- `crash.enabled`, default on, maps to `SimParams.crashOn`.
- When off, an impact above vCrash becomes a 'bounce' contact event (with its speed). The motors keep running, with bounce-regime restitution.
- This is a flag, not `vCrash = Infinity`: JSON turns Infinity into `null` in the config hash and in saved settings (research-a (d)).
- With crashes off, stuck detection is how a beginner gets out of a corner.

### C.8 Battery (D-i)

- `battery.refill`:
  - `start` (default): R, Restart and a new scene give a fresh pack.
  - `respawn`: every respawn gives a fresh pack.
  - `never`.
- It travels as `RespawnOpts.soc`, a float32 that is logged.

### C.9 Logs, replays and determinism

**Format `gsfpv-input-log/2`:**
- Each record is Int32 `tick*4 + kind` plus 8 Float32 values: the same 36 bytes as today.
- Kinds: 0 input, 1 respawn, 2 world.
- Ticks now reach 536 870 911 (6.2 days) instead of 35.8 min (D-e). Inputs for tick k+1 are written as 4k+4, events after tick k as 4k+1 and 4k+2, so records stay in time order.

**Record layouts:**
- Respawn: ch[0..3] = x, y, z, yaw; ch[4] = flags (1 platform, 2 keepArmed); ch[5] = platform radius; ch[6] = soc (-1 = keep); ch[7] = reason code. As today, the runner applies the same float32-rounded values it writes.
- World (E.7): ch[0] = s; ch[1..3] = t; ch[4] = floater minBlocks.

**Lives.**
- A new life starts at the first spawn, at every respawn, and at every change of a 'life' setting (new `Sim`, with the tick continuing).
- A life is self-contained:
  - `reset(position, opts)` puts every hashed slot back to its start value, except the battery.
  - Everything else is in its header: soc, the last applied channels, the params and the scene world.
- The session keeps the last 30 lives or 32 MB, whichever is reached first (D-f).
- The crash replay uses the current life. "Save log" writes the current life or the whole kept session.

**Header v2 (removes D-g):**
- It carries `presetSha256`, the full `overrides`, and a `configHash` over both plus simCore.
- The replay compiles its params **from the header**, not from the session.
- Saved files embed the preset JSON, so a log survives later preset edits.

**Trajectory.**
- There is no live trajectory array any more.
- CSV/JSON export recomputes the trajectory from the log. The D-phase check already showed that log-recomputed samples equal the live ones (README, `d-trajectory-export.json`); it is re-run.

**Version and existing checks.**
- `SIM_CORE_VERSION` becomes `sim-core/0.2.0`, one bump shared by B, C and H.
- The A6 reference hash is re-recorded with evidence, and the A4 checks are updated.
- v1 logs are refused with a clear message, as today.

**Frame-split invariance.** The director runs inside the runner's step loop, so a respawn lands on the same tick at 30, 60, 144 and 240 Hz frame splits.

```ts
export interface LifeHeader {
    format: 'gsfpv-input-log/2';
    simCore: string;
    preset: string; presetSha256: string; presetJson?: PresetJson;   // embedded in saved files
    overrides: ParamOverrides;             // JSON-safe; camera fields no longer here
    configHash: string;                    // sha256(canonical { presetSha256, overrides, simCore })
    collisionSha256: string | null;        // original bytes
    scene: { id: string; version: number; transform: [number, number, number, number]; floaterMinBlocks: number } | null;
    life: { index: number; startTick: number; at: [number, number, number, number]; opts: RespawnOpts; soc: number; ch: number[]; reason: RespawnReason | 'start' };
    seed: 0;
}
export interface Life { header: LifeHeader; bytes(): Uint8Array; endTick: number; traceHash?: string }
export interface WorldEvent { s: number; t: [number, number, number]; floaterMinBlocks: number }
export class Runner {
    constructor(sim: Sim, header: LifeHeader, o?: { traceHash?: boolean; maxLives?: number; maxBytes?: number });
    director: RespawnDirector | null;
    onStep: ((sim: Sim) => void) | null;
    onLife: ((life: Life) => void) | null;
    onWorld: ((ev: WorldEvent) => void) | null;
    respawn(x: number, y: number, z: number, yawDeg: number, opts?: RespawnOpts, reason?: RespawnReason): void;
    newLife(sim: Sim, header: LifeHeader): void;
    world(ev: WorldEvent): void;          // logs kind 2 at the tick boundary, then calls onWorld
    lives(): readonly Life[];
    current(): Life;
}
export function replayLife(life: Life, deps: { preset(sha: string): PresetJson | null; world(scene: LifeHeader['scene'], ev: WorldEvent | null): ContactWorld | null }, endTick?: number, onStep?: (sim: Sim) => void): { hash: string; sim: Sim };
```

### C.10 UI placement

- **Auto-respawn on: crash toast** at the bottom centre, e.g. "Crash 6.2 m/s · back 5 s in 1.4 s", with a countdown bar and key-caps:
  - Enter keeps the wreck and opens the panel;
  - R goes to the start; N loads the next scene; F loads the next favourite.
  - No click is needed. The crash camera (Rapier) plays during the delay, and its debris is cleared on the respawn event.
- **Auto-respawn off, or Enter: crash panel.**
  - It shows the life's stats (D) and the actions: Rewind 5 s (Y), Back to start (R), Next favourite (F), Next scene (N), Replay, Save log, Settings (O).
- **After a rewind** a small "-5 s" label shows for 1.5 s at the top centre. It does not flash colours, so it stays within the WCAG flash limit.
- **Settings → Crashes & respawn** holds the settings from the A.8 rows.

### C.11 i18n

- `respawn/*`: `respawn.toast`, `respawn.keep`, `respawn.minus`, `respawn.reason.*`, `respawn.pad`.
- The existing `crash.*` keys.
- `set.crash.*`, `set.respawn.*`, `set.battery.*`.

### C.12 Tests

**Unit** (sim-core, Node, real `Sim`, synthetic `ContactWorld`):

1. Platform holds:
   - Arm at idle: |dy| < 5 mm over 5 s.
   - Hover + 10 %: the craft lifts off, and the platform is off at +1 m.
   - Control: with the platform off, the craft falls at least 1 m in 0.5 s.
2. One-way: a craft moving up from below passes through.
   - Control: a two-way test variant blocks it.
3. keepArmed:
   - Switch on: armed at the respawn tick, and throttle reaches the motors on the next tick.
   - Switch off: parked.
   - Control: keepArmed false with the switch on stays disarmed (today's behaviour).
4. crashOn false: a 10 m/s wall hit gives 0 crash events and at least 1 bounce contact.
   - Control: crashOn true crashes.
5. History: a 60 s flight at 30/60/144/240 Hz splits, and also with ±2 ms jitter.
   - `pickBefore(c, 5000)` returns a sample aged 5.00–5.05 s in every run.
   - Control: today's per-frame `tick % 500` rule gets 0–22 samples a minute (research-a defect 3) and fails.
6. Director:
   - A crash at c respawns at exactly c + 2000 at every split.
   - Backoff goes 5, 10, 15 s.
   - Flipped respawns within 1.50–1.51 s; wedged within 3 s.
   - Control: an upright, disarmed landing gets no respawn in 30 s.
7. Determinism: a 120 s bot flight with 3 crashes and auto-respawns, a mode switch and one settings life.
   - The trace hash is equal at the 4 splits and when replaying all lives.
   - Control: a `Math.random` perturbation changes the hash.
   - Control: deleting one respawn record makes the replay diverge by more than 1 cm.
8. Lives:
   - Replaying life k alone equals the full run's per-tick states for that life.
   - Two simulated hours at 500 Hz input stay within 32 MB.
   - Control: unbounded mode grows past the limit.
9. Format /2: tick 3 000 000 (50 min) round-trips.
   - Control: format /1 wraps, as measured today (`.cache/v02/arch-int32.ts`).
10. Header v2: change a PID after recording, and the replay still reproduces the flight (params come from the header).
    - Control: replaying with the session's params diverges (D-g).

**Browser** (`tools/bench/src/accept-v03-respawn.ts`, SimRadio plus the bot):

- Item 16: arm at the spawn with idle throttle; y stays within 2 cm for 5 s.
  - Control: `?set.respawn.platform=0` falls.
- Item 23: the bot dashes into a wall while the fake radio keeps the switch on and the throttle at hover.
  - The craft flies again 2.0–2.3 s (wall time) after the crash, at a point on its recorded path 5.0–5.1 s before the crash.
  - HUD THR follows the stick with no switch flip.
  - Control: `?set.respawn.auto=0` shows the crash panel and the craft is still crashed after 10 s.
- Item 18: with crashes off, the bot flips onto its back on the floor, and the craft is reset within 2 s.
  - Control: an upright, disarmed landing is not reset within 20 s.
- R puts the craft at the spawn on the platform, armed if the switch is on.
- Legacy B12, B15 and B17 pass with `?set.respawn.auto=0`, after the format /2 update to `verifyLastLog`.

### C.13 Risks

- An instant lift-off after a respawn may surprise. It is Liftoff's behaviour; watch Andrii's reaction.
- A spawn close to the floor puts the platform inside the floor. That is harmless: the floor holds the craft.
- Stuck detection could fire falsely on a shelf. The thresholds are conservative, and there is a setting to turn it off.
- Format /2 breaks tools that read `.gsfpvlog`: B15 `verifyLastLog` and the trajectory export. They are updated in the same wave.
- Cutting from the crash camera back to FPV after only 2 s may feel abrupt. The toast counts down.

### C.14 Effort

- sim-core: L (about 700 LOC plus about 500 test LOC).
- App: M (about 400 LOC).

---

## D. Flight stats (item 7)

### D.1 What is tracked

The stats live in sim-core `stats.ts` and are computed per tick from the sim state. They are deterministic, so a replay reproduces them exactly.

| Stat | Betaflight OSD analogue (research-a (c)) |
|---|---|
| airtime (armed ticks) | ON TIME / TOTAL ARM |
| max speed | MAX SPEED |
| max altitude above spawn | MAX ALTITUDE |
| max distance from spawn | MAX DISTANCE |
| distance flown | FLIGHT DISTANCE |
| min / end voltage | MIN BATTERY / END BATTERY |
| max current, used mAh | MAX CURRENT / USED MAH |
| max G (10-tick window) | MAX G-FORCE |
| average throttle, full-throttle time and count | AVG THROTTLE / 100% THRT TIME / COUNT |
| crashes, max impact speed, bounces | (sim only) |
| respawns by reason, rewinds, longest clean life | (sim only) |
| scenes flown this session | (sim only) |

Stats are kept per life, per session, and as a lifetime total per drone. The lifetime totals (flights, airtime, distance, crashes) go into the prefs collection `stats`, like Betaflight's TOTAL FLIGHTS / TOTAL FLIGHT TIME / TOTAL DISTANCE.

```ts
export interface StatsBlock { airtimeS: number; maxSpeed: number; maxAlt: number; maxDist: number; distance: number; minVolt: number; endVolt: number; maxAmps: number; usedMah: number; maxG: number; avgThrottle: number; fullThrottleS: number; fullThrottleCount: number; crashes: number; maxImpact: number; bounces: number; respawns: Partial<Record<RespawnReason, number>>; longestCleanS: number }
export class FlightStats {
    constructor(spawn: [number, number, number], capacityMah: number);
    onStep(sim: Sim): void; onEvent(e: SimEvent): void; newLife(at: [number, number, number]): void;
    life(): StatsBlock; session(): StatsBlock;
}
```

### D.2 When it shows, and how it combines with the options panel

- **Disarm with the switch** (not a crash), after at least 3 s of airtime, with `stats.onDisarm` on:
  - A goggles-style OSD card appears over the view: "--- STATS ---" in monospace, 8 to 10 lines, as Betaflight does on disarm.
  - It closes on arm, throttle above 25 %, any key, or after 30 s. Enter or Esc opens the full panel.
  - (Betaflight shows it for 60 s and dismisses it early on throttle or pitch high, research-a (c).)
- **Esc / P opens the summary panel.** It replaces the pause menu:
  - The left column shows this life, the session, and the lifetime totals for the drone.
  - The right column lists every menu item (v0.2 items plus the new ones), each with its key-cap from the keymap.
  - This is item 7: "at the end of a flight show the statistics, together with the panel of all settings, and write each key next to its item".
- **Crash with auto-respawn off, or Enter:** the crash panel shows the life's stats and the crash actions.
- **Crash with auto-respawn on:** the toast shows two numbers (life time, max speed). No panel, no click.
- A "Copy stats" button copies them as text.

### D.3 i18n

- `stats/*`: `stats.title`, `stats.<field>`, `stats.life|session|lifetime`, `stats.copy`.
- `summary/*`.

### D.4 Tests

**Unit:**
- A scripted path at 1 m/s for 10 s gives distance 10.000 ± 0.001 m, plus the expected max speed and airtime. Crash counts are right.
- Stats from a 60 s bot flight equal the stats of its replay.
  - Control: a log with 1 LSB tampered gives different stats.

**Browser:**
- Fly, then disarm: the card is visible and its airtime is within 0.1 s of `__gsfpv.stats().life.airtimeS`.
- Esc: every KEYMAP action appears in the menu with its key-cap.
- With the panel closed, pressing each key triggers the same `data-action`; the test loops over KEYMAP.
  - Control: a deliberately wrong binding in a test build fails the loop.

### D.5 Risks and effort

- **Risks:**
  - The panel is crowded on phones: below 480 px the stats collapse to 4 lines.
  - Goggles terms need translating.
  - The cost per tick is a few additions, which is negligible.
- **Effort:** M (about 200 LOC in sim-core plus about 350 LOC of UI).

---

## E. Scenes (items 9, 10, 11; item 5 everywhere)

### E.1 SceneLibrary (`packages/scenes/src/library.ts`, pure)

- It holds history, favourites, the filter, known versions and load failures.
- It is persisted as the prefs collection `sceneLibrary`.
- `getHistory`, `recordOpen`, `recordFlight`, `getFavourites`, `toggleFavourite`, `getFilter` and `setFilter` become functions over the store. The picker keeps its API.

```ts
export interface LibraryEntry { id: string; version: number; title?: string; author?: string; license?: string; lastFlown: number; flights: number; airtimeS: number; hasCollision: boolean | null; failedAt?: number; failCode?: string }
export interface SceneLibraryData { v: 1; history: LibraryEntry[]; favourites: string[]; filter: SceneFilter; versions: Record<string, number> }
export function recordOpen(d: SceneLibraryData, e: Pick<LibraryEntry, 'id' | 'version' | 'title' | 'hasCollision'>, now: number): SceneLibraryData;
export function recordFlight(d: SceneLibraryData, id: string, airtimeS: number): SceneLibraryData;
export function toggleFavourite(d: SceneLibraryData, id: string): { data: SceneLibraryData; on: boolean };
export function recordFailure(d: SceneLibraryData, id: string, code: string, now: number): SceneLibraryData;
```

### E.2 Curated list (the admin's list: `apps/fly/public/showcase.json`, v2)

```jsonc
{ "format": "gsfpv-showcase", "version": 2, "updated": "2026-10-01",
  "scenes": [ { "id": "39e63ce9", "version": 1, "title": "Modlinek Villa — red room and bathroom", "author": "Andrii Shramko", "license": "CC BY 4.0",
                "kind": "interior", "collision": true, "voxelCm": 5, "sizeMb": 58,
                "scale": 1.0, "spawn": null, "quality": 5, "rotation": true, "defaultDrone": "pavo20pro-3s", "checked": "2026-10-01" } ] }
```

- **New fields:**
  - `scale`: the admin-verified size (item 10: "correct sizes"). It is the default for `scene.transform`.
  - `rotation`: whether the scene is in the default rotation.
  - `quality`: the admin's rating, 1 to 5.
  - `spawn`: an optional spawn override.
- **Admin tool `tools/showcase/add.ts <link|id>`.**
  - It resolves the version with the v0.2 resolver and probes the walls, voxel size and bytes on the CDN.
  - It prints an entry. The title, author and licence are left for the admin to copy from the scene page: no API crawl (D15).
  - `--check` re-resolves every entry. It needs the network, so it is run by hand before a release.

### E.3 Rotation (`packages/scenes/src/rotation.ts`)

```ts
export type RotationSource = 'curated' | 'favourites' | 'history' | 'superspl';
export interface RotationDeps { curated(): ShowcaseScene[]; library(): SceneLibraryData; superspl?: SuperSplatCatalog }
export class SceneRotation {
    constructor(deps: RotationDeps, rng?: () => number);
    next(source: RotationSource, current: string | null, order: 'random' | 'sequential'): Promise<string | null>;
    nextFavourite(current: string | null): string | null;
    random(current: string | null): Promise<string | null>;   // curated; SuperSplat top-liked only when E.6 phase 2 is on
}
```

- **Random order** uses a shuffle bag: no repeats until every scene has been flown, and never the current scene.
- **Skipped scenes:**
  - scenes without walls, unless `scenes.allowNoWalls` is on;
  - scenes that failed to load in the last 24 h;
  - taken-down ids.

### E.4 In-page scene switching

"Next scene" must not reload the page. A reload loses the radio (item 5) and today loses the settings (D-a).

- **The shell creates the renderer once.** `FlightSession.start(renderer, opts)` takes it.
- **`session.dispose()`** stops its update handler, unloads the splat and drops the collision and runner.
- **`app/scene-host.ts` `load(id, reason)`:**
  - pauses with reason 'scene' and shows a compact loading overlay with the v0.2 progress;
  - disposes the old session, starts the new one, and spawns on the platform with keepArmed;
  - resumes, keeps `?scene=` current with `history.replaceState`, and updates the library.
- **render-pc API**, added by the lead before wave 3: `unloadSplat(): void`, `setSceneTransform(s: number, t: [number, number, number]): void`, `setSplatVisible(on: boolean): void`, `renderOnce(): void`.
- **Memory acceptance:** after 10 switches between two scenes, the JS heap and `app.stats` VRAM are within +15 % of the first load.

### E.5 Crash panel and auto-switch (item 10)

- **Buttons and keys:** Next favourite (F); Next scene (N, from the rotation); Random scene (Shift+N).
- **Defaults:** `scenes.autoSwitch` off, `scenes.rotation` curated, `scenes.order` random.
- **With auto-switch on**, the director's `onCrash` becomes 'next-scene': after the delay the next scene loads and the pilot starts on its platform.
- **"Random highly rated SuperSplat scene."** SuperSplat has no ratings, only likes and views (research-b 1.2).
  - With the API (E.6 phase 2): a random pick among the top 200 walkable scenes by likes, all time.
  - Until then: a random pick from the curated list.

### E.6 SuperSplat tab (item 9)

**Phase 1** (buildable now, no permission needed):
- A picker tab, "SuperSplat", embeds `https://superspl.at/search?features=walkable&sort=likes` in an iframe.
  - It is their own UI with the same filters: walkable, downloadable, time, sort (trending / newest / oldest / most viewed / most liked / largest / smallest) and search.
  - Every request goes from the visitor's browser to superspl.at. Our server never contacts SuperSplat.
- **Three ways to pick a scene:**
  1. Drag a scene card from the frame onto our drop zone. A dragged link carries `text/uri-list`. **Not verified yet** (research-b 1.7 did not test it); it is the agent's first task.
  2. Ctrl+V anywhere on the picker. This uses the paste event, which needs no clipboard permission.
  3. "Open on SuperSplat" in a new tab, then copy the link and paste it.
- Every picked link goes through `parseSceneInput` and `resolveScene`, as today.
- CSP needs `frame-src https://superspl.at` in `deploy/nginx.conf`. That is a repo change; deploying it is the orchestrator's job.

**Phase 2** (only after PlayCanvas' written permission and a CORS allowlist for our origin):
- A native grid fetched by the visitor's browser from `https://playcanvas.com/api/splats/explore`.
  - The same parameters: sort, order, time, features, search, skip, and limit (32, then 16).
  - A token bucket under their 120 requests per 60 s limit, and a 10 min sessionStorage cache.
  - Thumbnails from the S3 `v<version>` path, and wall status from our CDN probe.
- It sits behind the build flag `superspl.catalog`, off by default.
- Why it waits: PlayCanvas' terms forbid automated access without authorisation, and the API's CORS allows only superspl.at and playcanvas.com (research-b 1.4, 1.5).

```ts
export interface ExploreQuery { sort: 'trending' | 'createdAt' | 'views' | 'starred' | 'size'; order: 1 | -1; time?: 'all' | 'year' | 'month' | 'week' | 'day'; features?: ('walkable' | 'downloadable')[]; search?: string; skip: number; limit: number }
export function supersplSearchUrl(q: Partial<ExploreQuery>): string;              // phase 1 iframe URL
export interface ExploreItem { id: string; version: number; title: string; author: string; license: string | null; likes: number; views: number; sizeBytes: number; thumb: string }
export class SuperSplatCatalog { constructor(o: { enabled: boolean; fetch?: typeof fetch }); explore(q: ExploreQuery): Promise<{ items: ExploreItem[]; total: number }> }
```

### E.7 Scene scale around the drone (item 11)

- **The transform.** `T(w) = s*w + t` is stored per scene id as `scene.transform = { s, t, v }`, where v is the scene version it was set on.
  - Rescaling by k around the drone at D gives s2 = k*s1 and t2 = D*(1 - k) + k*t1 (research-b 2.3).
- **Collision.** `transformCollision(base, s, t)` builds a new `VoxelCollision` over the same octree arrays, with `gridMin' = s*gridMin + t_file` and `res' = s*res`.
  - For format 1.0 the file space has x and y flipped, so t_file = (-tx, -ty, tz).
  - Measured against the original scene through the same transform: 20 000/20 000 identical hits, rays within 1e-12 m, and 3 000/3 000 sweeps (research-b 2.1).
  - Vendored code is untouched.
- **Rendering.** The splat entity gets position = t and localScale = s, keeping its rotation. The engine's LOD handles uniform scale (research-b 2.2).
- **Physics stays in metres.** The voxel size becomes s x 5 cm: the row shows it ("walls: 7.5 cm blocks") and warns above 10 cm.
- **Log.** A world record (kind 2) carries s and t. The replay rebuilds the transformed collision from the same base bytes. The life header carries the transform at the start of the life.
  - The spawn, history samples and altitude base are mapped through T2∘T1⁻¹.
- **When changes apply.**
  - In the summary panel the preview is live, and the change applies on resume.
  - In flight, [ and ] divide or multiply the size by 1.1 and apply on key release (debounced 300 ms). The velocity is kept: the drone is the pivot, so its state does not change.
  - If a scale-down leaves the drone overlapping a wall, `findSphereSpawn` pushes it out with a 'here' respawn.
- **Defaults and range.** The curated `scale` for curated scenes, 1 elsewhere. Range 0.25 to 4, on a log slider.
- **UI:** a summary panel row "Scene size x1.00 [-] slider [+] reset"; Settings → Scenes (for the current scene); keys [ and ].
- **i18n:** `scale/*`.
- **Tests:**
  - Unit: `transformCollision` equivalence by research-b's method (20 000 points, rays, 3 000 sweeps, formats 1.0 and 1.1). Control: s = 1 is the identity, and a deliberately wrong flip fails.
  - Unit: a world record replays to the same hash; a scale-down overlap is pushed out.
  - Browser: x2 around the drone keeps the drone's world position within 1 mm, doubles a ray from the drone to a wall within 1 voxel, sets the splat entity scale to 2, and survives a reload. Control: reset gives x1.

### E.8 UI placement

- Picker tabs: Showcase (curated), Recent, Favourites, SuperSplat. A "Continue: <last scene>" card comes first.
- The crash toast and panel carry the scene keys.
- Settings → Scenes.
- The size row sits in the summary panel.

### E.9 i18n

- `scenes/*`: existing keys plus `scenes.tab.superspl`, `scenes.continue`, `scenes.drop`.
- `superspl/*`, `rotation/*`, `scale/*`.
- `set.scenes.*`, `set.scene.*`.

### E.10 Tests (besides E.7)

- **Library:** the history cap of 100, favourites order and merge.
- **Rotation:**
  - The shuffle bag does not repeat until it is exhausted, never returns the current scene, and skips failed and wall-less scenes.
  - Control: with skipping disabled, they are returned.
- **In-page switching:**
  - 10 switches stay within the memory bound.
  - The fake radio stays connected and the throttle follows right after a switch.
  - Control: the old reload path shows the Controls screen again.
- **SuperSplat tab:**
  - The iframe loads.
  - A synthetic `text/uri-list` drop loads the scene; so does a paste.
  - Control: a non-SuperSplat URL is refused with the invalid-link message.

### E.11 Risks

- The engine may not release GPU memory on unload. Measure it. The fallback is a reload, and every setting is persisted anyway.
- Inside the iframe, a click on a card loads their full WebGPU viewer into our tab.
- Their list sometimes came up empty inside the frame, cause unknown (research-b 1.7).
- Licences of pasted scenes are unknown, so recording stays showcase-only (D34).

### E.12 Effort

- Library and rotation: M.
- Scene host: L.
- SuperSplat tab: phase 1 M, phase 2 M.
- Scale: M.

---

## F. Recording at 60 fps, auto-record to a folder (items 19, 14)

### F.1 Live recorder at 60 fps (`cinema.ts`)

- **Encoder settings:**
  - track `frameRate: 60`;
  - encoder `framerate: 60` at 1920x1080 or below. Chrome here offers hardware H.264 at a declared 60 fps only up to 1080p (research-b 3.2); above that, `framerate` is left out.
  - bitrate w x h x 60 x 0.1;
  - a key frame every 120 frames.
- **`FramePacer`.**
  - Slots sit on a fixed 1/60 s grid from the first frame. Each rendered frame fills every slot it reaches, stamped k/60 s, so the file has a constant frame rate for DaVinci.
  - Up to 2 missed slots are filled by re-encoding the previous frame. Larger gaps are counted as drops and shown after stop.
- **Target.**
  - Mediabunny `StreamTarget` into a `FileSystemWritableFileStream` (the chosen folder) or OPFS, with `fastStart: false`.
  - `BufferTarget` is only the last fallback, capped at 2 min: the whole file in RAM is what Mediabunny warns against.
  - Files split every `recording.splitMin` (default 10 min). Nothing reaches the disk before `close()` (research-b 3.4), so splitting bounds what a tab crash loses.

```ts
export class FramePacer { constructor(fps: 30 | 60); onRendered(nowMs: number): { slots: number[]; dropped: number } }
export interface RecordTarget { open(name: string): Promise<{ write(chunk: { data: Uint8Array; position: number }): Promise<void>; close(): Promise<void> }>; describe(): string }
export function folderTarget(dir: FileSystemDirectoryHandle): RecordTarget;
export function opfsTarget(): RecordTarget;
export function downloadTarget(capSeconds: number): RecordTarget;
export class CinemaRecorder {
    constructor(o: { width: number; height: number; fps: 30 | 60; credit: string; target: RecordTarget });
    start(name: string): Promise<string>;
    addFrame(src: HTMLCanvasElement, nowMs: number): void;
    stop(): Promise<RecorderInfo & { dropped: number; duplicated: number; file: string }>;
}
```

### F.2 Auto-record into the last folder (item 14)

- **Controls.** An **Auto** toggle sits right next to REC in the cinema bar, with a folder chip "Folder: GSFPV ▾" (pick, change, forget). The handle is stored in IndexedDB (`IdbKv('handles')`) and the folder name in `recording.folder`.
- **Permission.**
  - `queryPermission({ mode: 'readwrite' })` runs before every start.
  - If it returns 'prompt', `requestPermission` is called inside the next click or key press: the Fly button, Resume, the REC chip, or a one-line chip "Allow saving to GSFPV". Radio and gamepad input cannot grant it (research-b 3.4).
  - Chrome 122+ may offer "Allow on every visit".
- **When it records.**
  - Recording starts at arm and stops 3 s after a disarm that is not a crash.
  - With auto-respawn on, a crash does not stop it.
  - File names: `gsfpv-<scene>-<YYYYMMDD-HHMMSS>.mp4`.
- **Which scenes.** Showcase scenes only (D34). Elsewhere the toggle is disabled with the reason.
- **REC is offered in normal flight too**, at the quality as flown. Cinema mode only raises the quality.
- **Browsers without a picker** (Firefox, Safari): record to OPFS and offer the file after stop.

### F.3 Export from the flight log (the clean 60 fps)

- **"Save this flight as video (60 fps)"** in the summary panel.
  - It replays the current life, or a saved log, at exactly 1/60 s per frame.
  - Each frame is rendered on demand. The export waits for the engine's `frame:ready` with the scene fully loaded (ready, nothing loading), then encodes.
  - Sizes: 1080p, 1440p or 4K, with the credit. On this machine hardware H.264 without a declared frame rate encoded 1440p at 97 fps and 4K at 55 fps; software encoded them at 59 and 25 fps (research-b 3.2).
  - The live flight pauses meanwhile. There is a progress bar and a cancel button.
- **Needs:**
  - `renderer.renderOnce()`;
  - `CrashView` driven by an injected clock (it uses `performance.now()` today);
  - the scene version and transform in the life header (C.9).

### F.4 UI and i18n

- **UI:** the cinema bar has REC (F9), Auto and the folder chip; the summary panel has "Save as video"; Settings → Recording.
- **i18n:** `rec/*` (`rec.auto`, `rec.folder.*`, `rec.permission`, `rec.saved`, `rec.drops`, `rec.onlyShowcase`, `rec.export.*`).

### F.5 Tests

- **Unit:** `FramePacer` at 45, 60, 75, 144 and 240 Hz rendering stamps slots at exactly k/60 and counts duplicates and drops.
  - Control: with pacing off at 144 Hz, 2.4 frames land per slot and the test catches it.
- **Browser** (`accept-v03-rec.ts`): a 10 s recording at a 60 Hz render.
  - ffprobe reports `r_frame_rate 60/1`, 0 duplicate pts, and 600 ± 2 frames.
  - Control: the v0.2 30 fps-track path gives about 29 duplicates per second (research-b 3.1, measured).
- **Auto-record.**
  - The test passes an OPFS directory handle as "the folder". Playwright cannot drive the OS picker, and the write path is the same. The file appears after disarm.
  - The OS picker flow is a manual check by Andrii (J, W4-5 list).
- **Export from log:** a 5 s life gives 300 frames, and the first and last frame poses equal the replayed sim poses.

### F.6 Risks and effort

- **Risks:**
  - On 144 Hz displays, live recordings keep up to 6.9 ms of judder from picking frames onto the grid (research-b 3.3). Export from the log is the fix.
  - Chrome revokes folder access after long background time.
  - The disk can fill mid-write.
  - Large OPFS files count against the quota.
- **Effort:**
  - F.1 and F.2: M-L (about 500 LOC).
  - F.3: L (about 400 LOC plus renderer hooks).

---

## G. Voxel overlay (item 24)

### G.1 Modules

- **`packages/collision/src/mesh.ts`** (pure, safe in a worker): `buildChunkFaces(col, chunk, size = 32)`.
  - It walks the octree per 4x4x4 block using the block's 64-bit leaf mask, emits the exposed faces, and merges them into 1-D runs.
  - Single-voxel lookups are too slow for this: about 90 ns each, 4.9 s for 64 M (research-b 4.2).
- **`packages/collision/src/components.ts`:** 26-connected components of occupied blocks. It gives sizes and a component id per block, used by "colour floaters" and the W4 filter.
- **`packages/collision/src/rebuild.ts`** (wave 4): rebuilds the octree without components below N blocks, giving a new collision and a new hash.
- **`packages/render-pc/src/voxel-overlay.ts`: `VoxelOverlay`.**
  - A chunk cache around the drone: radius 5–40 m, nearest chunks first, at most 8 chunk uploads per frame, least-recently-used chunks dropped first.
  - One `MeshInstance` per chunk, so the engine culls it.
  - A `ShaderMaterial` (WGSL and GLSL) that carries the styles.
  - Drawn in a layer after the gsplat pass, blended, with depth writes on. Splats write no depth, so the overlay shows through the scan like an x-ray, which is what an alignment check needs (research-b 4.2).
- **`apps/fly/src/workers/voxel-mesh.worker.ts`:** builds chunks off the main thread. It gets one copy of the collision arrays per scene; SharedArrayBuffer is not available without cross-origin isolation. CSP needs `worker-src 'self'`.
- **`apps/fly/src/features/voxels.ts`:** the settings, key V, and the legend.

```ts
export interface ChunkMesh { positions: Float32Array; normals: Int8Array; indices: Uint32Array; faces: number; component?: Uint32Array }
export function buildChunkFaces(col: VoxelCollision, chunk: { x: number; y: number; z: number }, size?: number): ChunkMesh;
export function blockComponents(col: VoxelCollision): { blockIds: Int32Array; sizes: Uint32Array; count: number };
export type VoxelStyle = 'solid' | 'grid' | 'edges' | 'height' | 'floaters';
export class VoxelOverlay {
    constructor(r: SplatRenderer, worker: Worker);
    setCollision(col: VoxelCollision | null, transform: { s: number; t: [number, number, number] }): void;
    setOptions(o: { mode: 'off' | 'overlay' | 'only'; opacity: number; style: VoxelStyle; radiusM: number }): void;
    update(dronePos: [number, number, number]): void;
    stats(): { chunks: number; triangles: number; pending: number };
    dispose(): void;
}
```

### G.2 Behaviour

- **V cycles off, overlay, voxels only.** Voxels only hides the scan with `setSplatVisible(false)`. Collision is untouched, so flying on the voxels is just flying.
- **Defaults:** opacity 0.35, style grid, radius 15 m with a distance fade.
- **Fine voxel grids.** The radius is capped by a 1.5 M-triangle budget, which matters for 3.2 cm scenes: 2.7 M triangles in a 10 m cube (research-b 4.2).

### G.3 Phantom walls

- **What the overlay shows.** It shows where the voxelizer turned faint Gaussians into solid voxels. A voxel is solid at 10 % summed opacity at its nearest point, so haze, sky and floaters become blobs.
  - Measured: 57 to 20 299 disconnected pieces per scene, including a 2.2 M-voxel blob 420 m under our bake of 723068d7 (research-b 4.1).
- **Style "floaters"** paints components under 512 blocks red.
- **Wave 4 adds the per-scene fix `scene.dropFloaters`.** It drops components under N blocks; default 0 means off.
  - It changes the collision, so its value goes into the life header and the collision hash.

### G.4 UI placement

- Settings → Voxels.
- Key V.
- A legend chip at the top right while the overlay is on ("Voxels · grid · 35 % · V").
- A row in the summary panel.

### G.5 i18n

- `voxels/*`, `set.voxels.*`, `set.scene.dropFloaters`.

### G.6 Tests

- **Unit:**
  - The exposed-face count equals a brute-force count on 3 synthetic grids and on one 32³ chunk of 39e63ce9 (a CC BY fixture already in the repo).
  - Run merging keeps the total face area.
  - Components: a synthetic grid with 2 floaters gives 3 components.
    - Control: a diagonal-only neighbour is joined with 26-connectivity and not with 6.
- **Browser** (`accept-v03-voxels.ts`):
  - In "only" mode, the centre pixel differs from the background when a wall is ahead.
    - Control: with the overlay off it equals the background.
  - Triangles stay within the budget.
  - Frame p50 rises by at most 2 ms at a 15 m radius on 887f27aa and 7a475d38. This machine only: reported, not a gate on other GPUs.
  - `a1-api-check` still passes (public engine API only).

### G.7 Risks and effort

- **Risks:**
  - Shader code has to be maintained for two backends.
  - Memory on fine grids (handled by the triangle budget).
  - Chunk build time: the octree walk is required, not single lookups.
- **Effort:** L (about 900 LOC including shaders and the worker).

---

## H. Physics corrections (item 21)

Research finding: the skid comes from a **missing force**, not from wrong numbers. The model has no rotor or duct momentum drag. Yaw overshoot comes from the missing rotor-inertia reaction, not from feed-forward (research-physics TL;DR).

### H.1 Preset data

Sources are in research-physics (b).

| Field | Pavo20 Pro 3S: now → proposed | Pavo20 Pro II 3S: now → proposed | Source |
|---|---|---|---|
| battery_mass_g | 45 → 43.2 | 45 → 42 | manufacturer battery pages |
| auw_g | 153 → 151 | 161 → 158 | measured (Oscar Liang), manufacturer |
| motor_idle | 0.055 → 0.10 | 0.055 → 0.10 (F405) / 0.08 (AT32) | BetaFPV CLI |
| throttle | 50/0 → mid 65, expo 20 | 50/0 | BetaFPV CLI |
| pid roll/pitch/yaw | BF defaults → 54/111/44/0, 68/139/60/0, 54/111/0/0 | → 51/105/46/41, 64/133/63/51, 51/105/0/41 (F405 "O4 Pro" profile) | BetaFPV CLI profile 0 |
| rates | unchanged (BF 4.5 default ACTUAL 7/67/0 = 670 deg/s) | unchanged | the CLI keeps the defaults |
| rotor_drag_per_s (new) | 0.6 (estimate, band 0.3–0.9) | 0.6 | momentum theory 0.89 upper bound; Faessler 2018 measured 0.24–0.54 on an open-prop quad |
| rotor_inertia_kgm2 (new) | 2e-7 (estimate, 1–3e-7) | 2e-7 | prop and bell mass x radius of gyration |

The other four presets get the new fields as momentum-theory estimates, labelled `estimate`.

### H.2 Model changes

All ship in one `SIM_CORE_VERSION` bump, together with B and C.

1. **Rotor and duct momentum drag:** F = -k x m x (Σw/Σw_hover) x v_perp.
   - It is zero when the motors stop, so the disarmed terminal-velocity check is unchanged.
   - Predicted: coast from 10 to 2 m/s takes 2.3 s instead of 18 s, and sideslip above 30 deg after a 90 deg yaw lasts 1.5 s instead of 3.8 s. These are prototypes run outside the Sim (research-physics (c)).
   - The per-drone setting `physics.ductDrag` exists for A/B testing.
2. **Betaflight angle mapping** (B.1).
3. **Rotor-inertia yaw reaction:** tauY += Σ motorYaw_i x J_r x ω_max(V) x dw_i/dt.
   - Predicted: yaw t90 goes from 95 to 21 ms, overshoot from 34.5 % to 5.6 %, and bounce-back from 15.8 to 0.8 deg.
4. **I-term windup attenuation** above 85 % of the motor-mix range, from Betaflight's formula (pid.c:858-862 as read).
5. **Later, only with blackbox data:** axial-inflow thrust loss with a lower CdA; earth-referenced yaw in angle mode; ground effect near the platform.

### H.3 Betaflight import (`bfdiff.ts`)

- **Accept 2026.x** with 2025.12 semantics and a warning. BetaFPV ships 2026.6.1 for the Pro II AT32 board (dated 2026-09-20), and today it is refused. 5 of 6 official dumps parse today.
- **Import idle** (`dshot_idle_value`, `motor_idle`) into a new `ParamOverrides.idle`.
- **Persist imports.** Imported values go into the per-drone prefs (`tune.*`), so they survive visits.

### H.4 Blackbox calibration (`tools/blackbox/`, Node only, nothing shipped)

- **`decode.ts`:** our own .BBL decoder, written from the documented log format (header field definitions, predictors, encodings). No GPL code is copied. It is checked against a CSV exported by hand with Blackbox Explorer from the same log.
- **`fit.ts`:** least-squares fits of:
  - motor map and tau (eRPM against `motor[]`);
  - k_T and TWR (hover and punch-outs);
  - rotor drag and CdA (coast-downs; velocity integrated backwards from the stopped hover);
  - yaw: kappa x k_T/I, J_r/I and damping (flicks);
  - roll and pitch inertia.
- **`validate.ts`:** replays his logged setpoints and throttle through sim-core with the fitted preset. Pass means:
  - gyro RMS below 10 % of the setpoint;
  - coast from 10 to 2 m/s within 15 %;
  - hover throttle within 2 points.
  - Negative control: the unfitted preset must fail the same thresholds.
- **Output:** preset fields with `source: "measured:blackbox-YYYY-MM-DD"`. The site already shows each field's source.
- **Flight script and CLI** (research-physics, "Blackbox calibration plan"): `set debug_mode = ATTITUDE`, blackbox at 1/4; hover 10 s; 3 punch-outs; 3 forward and 3 sideways coast-downs in angle mode; yaw flicks and one steady spin; roll and pitch flicks.

### H.5 Tests

These go into the `tools/bench` a4 checks and sim-core unit tests.

- Coast from 10 to 2 m/s takes 1.8–3.0 s at k = 0.6.
  - Control: k = 0 takes 18 s and fails.
- Sideslip above 30 deg clears within 2 s.
  - Control: 3.8 s today.
- Yaw full-step overshoot is at most 10 %.
  - Control: J_r = 0 gives 34.5 %.
- Top speed for the Pro is 85–110 km/h (94 predicted), and the disarmed terminal velocity is unchanged within ±0.5 %.
- Hover throttle with 10 % idle is reported, not gated: there is no 3S reference figure.
- Moon hover and the PID step are re-baselined, and A6 gets a new reference hash.

### H.6 Risks and effort

- **Risks:**
  - 0.6 may "feel like syrup". The slider falls back to 0.45 or 0.3 until the fit.
  - The values are physics estimates, not measurements.
  - The Pro II board (F405 or AT32) is uncertain; his `diff all` decides.
- **Effort:**
  - H.1: S. H.2: M. H.3: S.
  - H.4: L (decoder M, fits M, validation S).

---

## I. Site and GitHub catalogue (item 12)

### I.1 Generator (`scripts/gen-catalog.ts`, run with tsx; `--check` mode for CI)

- **Inputs:**
  - `@gsfpv/prefs`: `SCHEMA`, `KEYMAP`, `buildCatalogue`;
  - `packages/sim-core/presets/*.json`: the drones, with the source of each field;
  - the flight modes and rate types;
  - the fly dictionaries in 4 languages.
- **Outputs:**
  - `apps/site/src/generated/features.json`: the site imports it the way it imports `numbers.json`. The site never imports simulator packages (architecture rule 3 stays).
  - `docs/settings.md`.
  - The README block between `<!-- catalog:start -->` and `<!-- catalog:end -->`.
  - One line in `llms.txt`.
- **What it includes:** only `status: 'shipped'` settings. It fails if a shipped setting lacks a label or help text in any locale.

### I.2 features.json

```jsonc
{ "generated": "2026-10-05", "schemaVersion": 1,
  "counts": { "settings": 53, "groups": 10, "drones": 6, "modes": 3, "keys": 18, "rateTypes": 4 },
  "locales": {
    "en": { "groups": [ { "id": "crash", "title": "Crashes & respawn",
                          "settings": [ { "id": "respawn.rewindS", "label": "Respawn how far back", "help": "…", "type": "number",
                                          "default": "5 s", "range": "1–30 s", "scope": "global", "apply": "live", "keys": [] } ] } ],
            "keys":   [ { "action": "respawn.rewind", "label": "Rewind 5 s", "keys": ["Y"] } ],
            "drones": [ { "id": "pavo20pro-3s", "name": "…", "fields": [ { "label": "Weight", "value": "151 g", "source": "measured:Oscar Liang" } ] } ] },
    "es": {}, "pl": {}, "ru": {} } }
```

### I.3 Site

- A new section `id="tune"`, "Everything you can tune", placed after "real":
  - the counts in the lead;
  - one `<details>` per group (static HTML, no JS);
  - the keys table;
  - the drones with the source of each field.
- Each row links to the simulator: `/{locale}/fly/?open=settings&focus=<id>`.
- Site dictionary keys `tune.*` in 4 languages, with entries added to the `i18n-check` ALLOW list only for technical terms.

### I.4 GitHub

- A README section "Everything you can tune": counts, group list, and links to `docs/settings.md` and the site anchor.
- Natural-language questions for SEO/GEO, per the vault rule for public repos: "Can I turn off crashes in a browser FPV simulator?", "Does it have angle / self-level mode?", "Can I export my simulator settings to another computer?", "Can I record 60 fps video of my flight?".

### I.5 CI

- `pnpm tsx scripts/gen-catalog.ts --check` runs in `ci.yml`.
- The site build reads the committed JSON, so there is no tsx in the site's prebuild.

### I.6 Tests

- vitest `packages/prefs/test/catalog.test.ts`:
  - every shipped def appears exactly once, and planned defs never do;
  - control: a shipped def without a translation throws.
- `--check` fails on a stale README.
  - Control: editing one label makes the check fail.
- The site build, a11y and i18n-check stay green.

### I.7 Risks and effort

- **Risks:** README churn (only the marker block changes); ES/PL translation quality.
- **Effort:** M (about 400 LOC plus the site component, about 150 LOC).

---

## J. Implementation waves

### J.0 Rules for every wave

- **Baseline.** Each wave starts from the previous wave's commit. At the end of every agent's work, `pnpm -r typecheck`, `pnpm vitest run` and `node scripts/check-architecture.mjs` are green.
- **File ownership.**
  - Each agent owns the files listed for it.
  - A file marked *(shared)* gets only small, targeted edits, re-read before each one.
  - New keys go only into the agent's own i18n namespace files, in 4 languages, and the parity test stays green.
- **Contracts first.** Before each wave the lead commits the interface files named below: types taken from this document, plus any tiny APIs the lead implements itself.
- **Checks.**
  - Local servers only on the agent's port: wave w, agent a gets `53wa` (5311 … 5345).
  - Browser checks go in `tools/bench/src/accept-v03-<name>.ts` and evidence in `evidence/<date>/v03-<name>.json`.
  - Every check has a negative control that must fire.
- **Git and the vault.** Agents make no git writes. The lead commits per agent, pushes after each wave, and copies the wave log into the vault: the build-log note plus backlog status for each item.

### Wave 0: v0.2 (in progress)

Items 1, 2, 4, 5, 6, 8, 17, 22 and 7 (pause shortcuts). v0.3 starts from its commit.

### Lead contract step before wave 1

- `packages/sim-core/src/contracts.ts`: `FlightMode`, `MODE_CHANNEL`, `modeFromChannel`, `RespawnOpts`, `RespawnReason`, `LifeHeader`, `WorldEvent`, `LevelParams`.
- `packages/prefs/` skeleton (package.json, tsconfig, empty index), the workspace entry, and `packages/prefs/src/keymap.ts` with the table from 1.2, including v0.2's `PAUSE_KEYS`.
- The empty namespaced i18n folders.

### Wave 1: foundations (5 agents, no visible change)

| Agent | Owns | Delivers | Acceptance |
|---|---|---|---|
| **W1-1 prefs** | `packages/prefs/**` except keymap.ts; `scripts/check-architecture.mjs` *(shared, rule 1.4 only)* | A.1–A.6: the store; defs for all groups (existing settings `shipped`, new ones `planned`); migrations with legacy fixtures; export/import; catalogue builder; `browser.ts` | At least 40 unit tests, covering every A.11 unit item and its control. The architecture rule passes, and fails on a planted `window.` in the core. Every legacy key shape from v0.2 is covered. |
| **W1-2 app shell** | `apps/fly/src/main.ts`; new `apps/fly/src/app/**`; `ui/flight.ts` split into `ui/hud.ts`, `ui/crash-overlay.ts`, `ui/pause.ts`, `ui/panels.ts`; `apps/fly/src/i18n.ts`; `packages/i18n/test/fly-parity.test.ts`; `tools/bench/src/accept-fly.ts` *(shared, only selectors that moved)* | 1.1 (context, feature registry, pause stack, Bus), 1.2 (KeyRouter over KEYMAP), 1.3; a pure refactor | `main.ts` is at most 80 lines. Every `data-action` and `data-testid` is unchanged. accept-fly B6–B17 run locally before and after give the same pass/fail and numbers within noise, both recorded. The parity test catches a planted missing `pl` key. |
| **W1-3 sim-core model** | `sim.ts`, `params.ts`, `rates.ts`, new `platform.ts`, `presets/*.json`, `test/model-*.test.ts`, `tools/bench/src/a4-physics.ts`, the A6 reference in `a6-run.ts`; `index.ts` *(shared: the `SIM_CORE_VERSION` line only)* | B.1, C.2, C.3 (sim side), C.7, C.8 (the `soc` option), H.1, H.2 items 1–4 | B.5 unit, C.12 items 1–4 and H.5, all with controls. A4 and A6 re-run with evidence. `sim-core/0.2.0`. |
| **W1-4 sim-core log and respawn** | `runner.ts`, new `history.ts`, `director.ts`, `stats.ts`, `index.ts` (exports), `test/log-*.test.ts`, `test/respawn-*.test.ts`, `test/stats.test.ts` | C.5, C.6, C.9, D.1 | C.12 items 5–10 and D.4 unit, with controls. The frame-split hash test at 4 splits. |
| **W1-5 collision** | `packages/collision/src/transform.ts`, `mesh.ts`, `components.ts` (new); `index.ts` *(shared, exports)*; `packages/collision/test/**` | E.7 collision part, G.1 mesh and components | research-b's equivalence reproduced as tests (20 000/20 000, 3 000/3 000), with controls s = 1 and a wrong flip. Face counts equal brute force. The components control. |

W1-3 and W1-4 share sim-core. W1-4 codes against `contracts.ts` and `Sim.respawn(x, y, z, yaw, opts)` as specified. The lead runs the whole sim-core suite once both have landed, and assigns any mismatch to W1-4.

### Lead contract step before wave 2

- `ctx.prefs` is wired: a store instance on `LocalStorageBackend`, migration running, and `__gsfpv.prefs`.
- `ArmGate.keepArmedAfterCrash` is added to `contracts`.
- Namespace files are created for `prefs`, `set`, `group`, `mode`, `respawn`, `stats` and `summary`.

### Wave 2: core features on screen (5 agents)

| Agent | Owns | Delivers | Acceptance |
|---|---|---|---|
| **W2-1 settings UI and persistence** | `apps/fly/src/features/settings/**`, `app/prefs.ts`, `ui/drone.ts`, `presets.ts`, `packages/prefs/src/defs/{camera,display,drone,tune}.ts` (status to shipped), i18n `prefs`, `set`, `group` | A.7–A.10: per-drone overrides, export/import UI, the Data section, `storage.persist`, the `?open=settings&focus=` deep link | The A.11 browser checks (items 20 and 13, D-b, D-h) with controls. Closing with x keeps changes. |
| **W2-2 respawn** | `apps/fly/src/session.ts`, split first into `session/{loader,flight,replay,selftest}.ts`; `features/respawn.ts`; `ui/crash-overlay.ts`; `crashview.ts`; `defs/crash.ts`; `tools/bench/src/accept-v03-respawn.ts`; `accept-fly.ts` *(shared: B12, B15, B17 switches)*; i18n `respawn` | C.4, C.10, platform spawn, R/Y/Enter, lives in the session, header v2 for save/verify, trajectory from the log, battery | The C.12 browser checks (items 16, 18, 23, R) with controls. B15 passes on format /2. B12 and B17 pass with auto-respawn off. |
| **W2-3 input and modes** | `apps/fly/src/controls.ts` (including radio-profile storage moved to the prefs collection), `packages/input/src/calib.ts` *(shared: ArmGate, `Profile.modeSwitch`, `mapFrame` ch5 only)*, `devices/keyboard.ts`, `devices/touch.ts`, `ui/radio.ts` *(shared: the mode-switch row on the check screen)*, `ui/mode-chip.ts`, `features/modes.ts`, `defs/{flight,input}.ts`, i18n `mode` | B.2–B.4, C.3 (page side) | The B.5 browser checks with controls. The input vitest suite stays green, with new modeSwitch and keepArmed tests (control: without the option the gate wants a new edge). Radio profiles survive the migration. |
| **W2-4 stats and summary** | `features/summary.ts`, `ui/summary.ts`, `ui/osd-stats.ts`, `ui/pause.ts` (replaced by the summary), `defs/stats.ts`, i18n `stats`, `summary` | D.2 | The D.4 browser checks with controls. |
| **W2-5 catalogue** | `scripts/gen-catalog.ts`, `apps/site/src/generated/features.json`, `apps/site/src/components/SettingsCatalog.tsx`, `apps/site/src/app/[locale]/page.tsx` *(shared: one Section)*, `packages/i18n/locales/site/*.json` *(shared: the `tune.*` block)*, `docs/settings.md`, `README.md` (marker block), `llms.txt`, `.github/workflows/ci.yml` | I.1–I.6 | `--check` is green, and fails on a stale label (control). Site build, a11y and i18n-check are green. |

### Lead contract step before wave 3

- The render-pc API: `unloadSplat`, `setSceneTransform`, `setSplatVisible`, `renderOnce`. The lead implements it (small) with a smoke check.
- The `WorldController` interface in `session/world.ts`.
- A `PickerTab` interface in `ui/scenes.ts`.
- Menu registrations for the size and voxel rows.
- Namespace files for `rotation`, `superspl`, `scale`, `voxels` and `rec`.

### Wave 3: scenes, scale, overlay, recording (5 agents)

| Agent | Owns | Delivers | Acceptance |
|---|---|---|---|
| **W3-1 scene host and rotation** | `packages/scenes/src/{library,rotation,curated}.ts` and tests; `packages/scenes/src/index.ts` *(shared: history functions delegate)*; `app/scene-host.ts`; `session/lifecycle.ts`; `features/scene-rotation.ts`; `ui/scenes.ts`; `public/showcase.json` (v2 with scale for the 3 scenes); `tools/showcase/**`; `defs/scenes.ts`; i18n `rotation` | E.1–E.5, E.8 | E.10 with controls. The memory bound over 10 switches. The radio stays connected (control: the reload path). |
| **W3-2 SuperSplat tab** | `ui/scenes-superspl.ts`, `packages/scenes/src/superspl.ts` and tests, `deploy/nginx.conf` *(shared: the CSP line)*, i18n `superspl` | E.6 phase 1; phase 2 code behind the flag, off | Drag-and-drop verified, or reported as not working with the paste fallback shipped. The paste flow works. The iframe is allowed by the repo CSP, checked in a local release smoke. |
| **W3-3 scene scale** | `session/world.ts`, `features/scene-scale.ts`, `defs/scene.ts`, i18n `scale` | E.7 | E.7 tests with controls. |
| **W3-4 voxel overlay** | `packages/render-pc/src/voxel-overlay.ts`, `apps/fly/src/workers/voxel-mesh.worker.ts`, `features/voxels.ts`, `defs/voxels.ts`, i18n `voxels` | G.1–G.4: overlay, styles, voxels only, floater colouring | G.6 with controls; `a1-api-check` passes. |
| **W3-5 recording** | `apps/fly/src/cinema.ts`, `features/recording.ts`, `defs/recording.ts`, `tools/bench/src/accept-v03-rec.ts`, i18n `rec` | F.1, F.2 | F.5 (ffprobe 60/1 with 0 duplicate pts; control: the v0.2 path). Auto-record into an OPFS folder works. |

### Wave 4: completion and calibration (up to 5 agents)

| Agent | Owns | Delivers | Acceptance |
|---|---|---|---|
| **W4-1 video from log** | `features/video-export.ts`, `crashview.ts` (clock injection) | F.3 | A 5 s life gives 300 frames, and the frame poses equal the replay's. |
| **W4-2 phantom-wall fix** | `packages/collision/src/rebuild.ts` and tests, `session/world.ts` *(shared: `setFilter`)*, `defs/scene.ts` (`dropFloaters` shipped) | G.3 fix | Exactly the small components are removed. The filtered hash is in the life header, and a replay refuses a mismatch (control). |
| **W4-3 Betaflight and blackbox** | `packages/sim-core/src/bfdiff.ts` and tests, `tools/blackbox/**` | H.3, H.4. The fit itself waits for Andrii's logs. | 6 of 6 BetaFPV dumps parse, including 2026.6.1 with its warning. Idle is imported. The decoder matches the hand-exported CSV on 1 log. |
| **W4-4 SuperSplat native grid** | `packages/scenes/src/superspl.ts`, `ui/scenes-superspl.ts` | E.6 phase 2, **only if PlayCanvas said yes** | Same filters as superspl.at, under their rate limit, never from the server. |
| **W4-5 release acceptance** | `tools/bench/src/accept-v03.ts`, evidence, README, docs, STATE, catalogue re-run, vault notes | Every item end to end, on a local release build, then on the live site after the orchestrator deploys | One pass line per item with its evidence file. A short list of real-radio re-tests for Andrii: auto-respawn without flipping the switch, mode chip, auto-record with the OS folder picker, feel A/B of duct drag. |

### J.1 Effort by wave

S is 2 h or less, M 2–5 h, L 5–10 h of agent time.

| Wave | Agents (effort) | Critical path |
|---|---|---|
| 1 | prefs L, shell M-L, model L, log/respawn L, collision M | model + log/respawn (sim-core bump, A6 re-baseline) |
| 2 | settings M-L, respawn L, input/modes M, summary M, catalogue M | respawn (session split + lives) |
| 3 | scene host L, SuperSplat tab M, scale M, voxels L, recording M-L | scene host (renderer unload, memory) |
| 4 | video export L, floater fix M, blackbox L (plus Andrii's data), native grid M (only with permission), release acceptance M | blackbox fit waits on hardware data |

---

## Open questions for Andrii

1. **PlayCanvas permission** (legal).
   - The native SuperSplat catalogue and "random highly rated scene" need their OK plus a CORS allowlist for our site. Their terms forbid automated access without authorisation.
   - May I draft the letter for you to send, or send it from your address?
   - Until then, the SuperSplat tab embeds superspl.at itself, and "random" draws from your curated list.
2. **Your quads** (hardware, item 21). For both Pavo20s:
   - `diff all`;
   - the weight with your usual battery;
   - the OSD throttle at a steady hover, on a full and a half pack;
   - one blackbox flight each, following the H.4 script (about 5 min per quad).
3. **Curated rotation.** Which scenes, beyond your three, go into the default rotation, and is each one's size right? The admin tool shows the voxel size and lets you set the scale.
4. **Battery in long sessions** (taste): real drain with a fresh pack at R and on a new scene (proposed), or no drain at all?
5. **Recording only on curated scenes** (licence, D34): still right now that recording can be automatic?

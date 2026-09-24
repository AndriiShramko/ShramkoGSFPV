# Vendored upstream code

| | |
|---|---|
| Project | [playcanvas/supersplat-viewer](https://github.com/playcanvas/supersplat-viewer) |
| Release | v1.35.0 |
| Commit | `e669b5d785a80571763bdf272849bcb8e50a5eb8` |
| License | MIT, Copyright (c) 2011-2026 PlayCanvas Ltd. (full text: [`LICENSE-supersplat-viewer`](LICENSE-supersplat-viewer)) |
| Files | `src/collision/collision.ts`, `src/collision/voxel-collision.ts`, `src/collision/find-spawn.ts` → `src/vendor/` |

The upstream package does not export its collision module (checked on 1.35.0), so the three
files are copied here. A small pull request that exports `./collision` from the upstream
package is drafted for the author to send; once it lands, this folder can become a dependency.

## Local changes (collision logic is untouched)

1. A four-line attribution comment at the top of each file.
2. `voxel-collision.ts`: the final export line also exports `FlippedVoxelCollision` and the
   `VoxelMetadata` type, so voxel data can be opened from bytes (see `src/open.ts`).

## Our code around it

| File | What |
|---|---|
| `src/open.ts` | open voxel data from bytes; explicit error on an unknown format version (upstream silently treats anything but 1.0 as 1.1) |
| `src/world.ts` | provably conservative swept test for the drone's compound body, our own sphere-overlap test (independent of `querySphere`), `forEachSolidVoxel(aabb)` for crash geometry |
| `src/synthetic.ts` | analytic voxel worlds for tests (thin wall, open volume, box room) that run the upstream code unchanged |
| `src/types-shim.d.ts` | restores upstream's `Response.json()` typing when compiled without the DOM lib |

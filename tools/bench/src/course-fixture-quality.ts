// Lane course3 F2 (review CR-1): writes apps/api/tests/fixtures/tracks/valid-generated-quality.json, a course laid by the
// generator over a quality map (generator version '2') on the synthetic street of packages/tracks/test/quality.test.ts.
// The API's own test (apps/api/tests/test_tracks.py, every valid-*.json must be accepted) and packages/tracks
// fixtures.test.ts then prove that such a course saves.
//   cd tools/bench && npx tsx src/course-fixture-quality.ts
import { writeFileSync } from 'node:fs';
import { analyticCollision } from '@gsfpv/collision';
import { freeSpace, generateCourse, qualityBounds, qualityMap } from '@gsfpv/tracks';
import type { SceneTransform, Vec3 } from '@gsfpv/tracks';

const LENGTH_M = 80;
const walls = analyticCollision([-0.4, -1, -8], [LENGTH_M + 0.4, 14, 8], 0.2, (x, y, z) => {
    if (y < 0) return true;
    if (x < 0 || x >= LENGTH_M) return true;
    if (z > -6 && z < 6) return false;
    return y < 4 || x % 4 < 0.4;
});
const T = [1, 0, 0, 0] as unknown as SceneTransform;
const spawn: Vec3 = [6, 2.5, 0];
const q = qualityMap(walls);
const free = freeSpace(walls, { spawn, bounds: qualityBounds(q, spawn) ?? undefined, kind: 'outdoor' });
const track = generateCourse(free, walls, { seed: 1, scene: { id: '0000bbbb', version: 1 }, transform: T, quality: q, created: '2026-11-15T00:00:00.000Z' });
const out = new URL('../../../apps/api/tests/fixtures/tracks/valid-generated-quality.json', import.meta.url);
writeFileSync(out, JSON.stringify(track, null, 1) + '\n');
console.log(`gates ${track.gates.length} version ${track.generator?.version} params ${Object.keys(track.generator?.params ?? {}).join(',')}`);

// Pull a SuperSplat scene's bootstrap (content url, collision url, settings, camera pose)
// the same way the official viewer page carries it, and cache it locally for the probes.
import { writeFileSync, mkdirSync } from 'node:fs';

const ids = process.argv.slice(2);
if (!ids.length) {
    console.error('usage: node probe/fetch-scene.mjs <sceneId> [sceneId...]');
    process.exit(1);
}

mkdirSync('probe/scenes', { recursive: true });

for (const id of ids) {
    const res = await fetch(`https://superspl.at/s?id=${id}`, {
        headers: { 'user-agent': 'Mozilla/5.0 ShramkoGSFPV-probe' }
    });
    if (!res.ok) { console.error(`${id}: HTTP ${res.status}`); continue; }
    const html = await res.text();

    const m = html.match(/<script[^>]*id="sse-bootstrap"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) { console.error(`${id}: no sse-bootstrap block`); continue; }

    let boot;
    try { boot = JSON.parse(m[1].trim()); } catch (e) { console.error(`${id}: bad JSON — ${e.message}`); continue; }

    // does this scene actually carry collision?
    let collision = null;
    if (boot.collisionUrl) {
        const r = await fetch(boot.collisionUrl);
        collision = r.ok ? await r.json() : { error: r.status };
    }

    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const cam = boot.settings?.cameras?.[0]?.initial;

    const out = { id, title: title.replace(/ - SuperSplat$/, ''), ...boot, collisionMeta: collision };
    writeFileSync(`probe/scenes/${id}.json`, JSON.stringify(out, null, 1));

    console.log(
        `${id}  ${collision && !collision.error ? `voxel=${collision.voxelResolution}m depth=${collision.treeDepth}` : 'NO COLLISION'}` +
        `  fov=${cam?.fov ?? '?'}  ${out.title.slice(0, 60)}`
    );
}

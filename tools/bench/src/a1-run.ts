// A1: engine directly vs the viewer's createViewer, measured on 4 criteria; writes evidence.
import { launch, visibility } from './browser';
import { writeEvidence } from './evidence';
import { checkApi } from './a1-api-check';

const BASE = process.env.FLY_BASE ?? 'http://localhost:5190/fly/lab/';

async function probe(page: string): Promise<Record<string, unknown>> {
    const { browser, page: p, console: log } = await launch();
    await p.goto(BASE + page);
    const t0 = Date.now();
    let r: Record<string, unknown> | null = null;
    while (Date.now() - t0 < 120000) {
        r = await p.evaluate(() => (window as unknown as { __a1?: Record<string, unknown> }).__a1 ?? null);
        if (r && r.status !== 'running') break;
        await p.waitForTimeout(500);
    }
    const vis = await visibility(p);
    await browser.close();
    return { ...(r ?? { status: 'timeout' }), visibilityAtEnd: vis, consoleErrors: log.filter((l) => l.startsWith('error') || l.startsWith('pageerror')).slice(0, 10) };
}

const engine = await probe('a1-engine.html');
const viewer = await probe('a1-viewer.html');
const api = checkApi();
const ec = (engine.criteria ?? {}) as Record<string, { pass: boolean | null }>;
if (ec.noPrivateApi) ec.noPrivateApi = { ...ec.noPrivateApi, pass: api.pass };
const vc = (viewer.criteria ?? {}) as Record<string, { pass: boolean | null }>;
const score = (c: Record<string, { pass: boolean | null }>) => Object.values(c).filter((x) => x.pass === true).length;
const decision = score(ec) > score(vc) ? 'engine' : 'createViewer';
const pass = engine.status === 'done' && viewer.status === 'done' && engine.renderer === 2;
const file = writeEvidence('a1-engine-vs-createviewer', {
    pass,
    decision,
    score: { engine: `${score(ec)}/4`, createViewer: `${score(vc)}/4` },
    engine,
    viewer,
    privateApiStaticCheck: api,
    note: 'Criteria from spec-arch: own camera not overwritten; render scale really changes canvas.width; collision downloaded once; no private API. If the quality governor had needed a workaround, it would move to phase D.'
});
console.log('A1', pass ? 'DONE' : 'FAIL', decision, JSON.stringify({ engine: ec, viewer: vc }), '->', file);

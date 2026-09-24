// A1 criterion 4: every PlayCanvas member our renderer/session uses is public in playcanvas.d.ts
// (not declared `private`, no @ignore / @private in its doc comment).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './evidence';

const DTS = join(REPO, 'apps', 'fly', 'node_modules', 'playcanvas', 'build', 'playcanvas.d.ts');

export const USED: Record<string, string[]> = {
    AppBase: ['init', 'setCanvasFillMode', 'setCanvasResolution', 'start', 'destroy', 'root', 'scene', 'systems', 'assets', 'graphicsDevice'],
    AppOptions: ['graphicsDevice', 'componentSystems', 'resourceHandlers'],
    Entity: ['addComponent', 'camera', 'render', 'gsplat'],
    GraphNode: ['setPosition', 'setRotation', 'setLocalPosition', 'setLocalEulerAngles', 'setLocalScale', 'setEulerAngles', 'addChild', 'getPosition', 'children', 'destroy'],
    Scene: ['gsplat', 'ambientLight', 'layers'],
    GSplatParams: ['lodUpdateAngle', 'lodBehindPenalty', 'lodMode', 'minContribution', 'alphaClip', 'radialSorting', 'splatBudget', 'colorUpdateAngle', 'renderer', 'currentRenderer'],
    GSplatComponent: ['lodRangeMin', 'lodRangeMax', 'resource', 'asset'],
    GSplatOctreeResource: ['octree'],
    GSplatOctree: ['lodLevels'],
    CameraComponent: ['fov', 'horizontalFov', 'nearClip', 'farClip', 'clearColor', 'toneMapping'],
    RenderComponent: ['material', 'type', 'layers'],
    StandardMaterial: ['useLighting', 'diffuse', 'emissive', 'useTonemap'],
    Material: ['depthTest', 'depthWrite', 'update'],
    LayerComposition: ['getLayerByName'],
    GraphicsDevice: ['isWebGPU', 'maxPixelRatio'],
    Quat: ['set', 'setFromEulerAngles', 'mul'],
    AssetRegistry: ['add', 'load']
};

function classBlock(src: string, cls: string): string | null {
    const re = new RegExp(`\\ndeclare class ${cls}(?:<[^>]*>)?(?: extends [^{]+)?\\s*\\{`);
    const m = re.exec(src);
    if (!m) return null;
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
    }
    return null;
}

export function checkApi(): { pass: boolean; checked: number; problems: string[]; notFound: string[] } {
    const src = readFileSync(DTS, 'utf8');
    const problems: string[] = [];
    const notFound: string[] = [];
    let checked = 0;
    for (const [cls, members] of Object.entries(USED)) {
        const block = classBlock(src, cls);
        if (!block) { notFound.push(`class ${cls}`); continue; }
        for (const m of members) {
            // declarations: "    get m(", "    set m(", "    m(", "    m:", "    m?:", "    readonly m"
            const decl = new RegExp(`\\n((?:    |\\t)(?:(?:private|protected|static|readonly)\\s+)*(?:get |set )?${m}\\??[(:<])`, 'g');
            let found = false;
            let publicDecl = false;
            let mm: RegExpExecArray | null;
            while ((mm = decl.exec(block))) {
                found = true;
                const line = mm[1];
                const before = block.slice(Math.max(0, mm.index - 1500), mm.index);
                const docStart = before.lastIndexOf('/**');
                const docEnd = before.lastIndexOf('*/');
                const doc = docStart >= 0 && docEnd > docStart && before.slice(docEnd).trim() === '*/' ? before.slice(docStart) : '';
                const isPrivate = /\bprivate\b/.test(line) || /@ignore|@private/.test(doc);
                if (!isPrivate) publicDecl = true;
            }
            checked++;
            if (!found) notFound.push(`${cls}.${m}`);
            else if (!publicDecl) problems.push(`${cls}.${m}`);
        }
    }
    return { pass: problems.length === 0 && notFound.length === 0, checked, problems, notFound };
}

if (process.argv[1]?.endsWith('a1-api-check.ts')) console.log(JSON.stringify(checkApi(), null, 1));

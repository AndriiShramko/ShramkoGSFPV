// The bug report's lines about the graphics (lane gpu-select, docs/wip/gpu-select.md): what the renderer really draws on,
// whether the GPU hint was due and what the browser remembers about it. The reading is the GPU hint's (builtin/gpu-hint.ts),
// which needs the page; the report (diagnostics.ts) is also loaded where there is no page (the unit tests of the input and
// the feedback code). So the report asks here, and the feature says here how to read: with no feature there is no block.
import type { SplatRenderer } from '@gsfpv/render-pc';

/** The adapter's name as the pilot sees it, its kind, the hint the reading calls for and the rule's reason, the browser's memory, WebGL's own words. */
export interface GraphicsReport {
    name: string;
    /** the name is a family the browser rounded the model to (Firefox's ", or similar") */
    approx: boolean;
    kind: string;
    hint: string | null;
    due: boolean;
    reason: string;
    memory: string | null;
    webgl: string;
}

let reader: ((renderer: SplatRenderer) => GraphicsReport) | null = null;

/** The GPU hint's feature module says how the graphics are read (once, when it loads). */
export function setGraphicsReader(read: (renderer: SplatRenderer) => GraphicsReport): void {
    reader = read;
}

/** The graphics of this renderer for the report, or null where the feature is not loaded. A reading that fails is no reading. */
export function graphicsReportOf(renderer: SplatRenderer): GraphicsReport | null {
    try {
        return reader ? reader(renderer) : null;
    } catch {
        return null;
    }
}

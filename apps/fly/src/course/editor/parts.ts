// The course editor's parts (design edit4, section 1.1): every file course/editor/parts/<name>.ts that exports
// install(seam) is a part; a new part is a new file, no list to edit. Each install returns its own undo (the editor closed).
import type { EditorSeam } from './seam';

export interface EditorPart {
    install(seam: EditorSeam): () => void;
}

const FOUND = import.meta.glob<EditorPart>('./parts/*.ts', { eager: true });

/** The parts by file name (sorted, so the order is the same on every page). */
export function editorParts(found: Record<string, unknown> = FOUND): { name: string; part: EditorPart }[] {
    return Object.keys(found)
        .sort()
        .map((path) => ({ name: path.replace(/^.*\/|\.ts$/g, ''), part: found[path] as Partial<EditorPart> }))
        .filter((x): x is { name: string; part: EditorPart } => typeof x.part.install === 'function');
}

/** Installs every part on the seam; the returned function removes them all (last installed first). */
export function installParts(seam: EditorSeam, found?: Record<string, unknown>): () => void {
    const undo = editorParts(found).map((p) => p.part.install(seam));
    return () => { for (const u of undo.reverse()) u(); };
}

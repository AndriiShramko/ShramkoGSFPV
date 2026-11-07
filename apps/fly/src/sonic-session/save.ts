// A recording on the pilot's disk (docs/wip/v12-plan.md section 4.3 step 3): the .zip of a session saved through the file picker
// where the browser has one (Chrome and Edge: the person chooses the folder and the name) and as a download everywhere else.
// Both need a click or a key press (the picker refuses without one), so this is called from a button of the panel.
//
// Saving never touches the copy in the browser's storage: that stays until the server has the recording (step 8) or the
// pilot or the helper deletes it.
import type { SessionManifest } from '@shramko/sonic-fpv';

export type SavedVia = 'picker' | 'download' | 'cancelled';

/** `fly-by-sound-20261107-103000-ab12cd34.zip`: the start of the recording in UTC and the first characters of its random id. */
export function packageFileName(manifest: Pick<SessionManifest, 'id' | 'created'>): string {
    const d = new Date(manifest.created);
    const stamp = Number.isFinite(d.getTime()) ? d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) : 'unknown-time';
    const id = manifest.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'session';
    return `fly-by-sound-${stamp}-${id}.zip`;
}

/** What saving needs of the browser, so a test can stand in for it. */
export interface SaveEnv {
    /** window.showSaveFilePicker, or null where the browser has none */
    picker: ((options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>) | null;
    /** hands the blob to the browser as a download */
    download(blob: Blob, name: string): void;
}

export function browserSaveEnv(): SaveEnv {
    const w = globalThis as unknown as { showSaveFilePicker?: SaveEnv['picker'] };
    return {
        picker: typeof w.showSaveFilePicker === 'function' ? w.showSaveFilePicker.bind(globalThis) : null,
        download(blob, name) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.rel = 'noopener';
            document.body.append(a);
            a.click();
            a.remove();
            // the browser reads the blob after the click returns: let go of it a little later
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
    };
}

/**
 * Saves the zip. The picker first (the person decides where it goes); when the person closes the picker nothing is saved and
 * nothing is downloaded behind their back ('cancelled'); when the picker cannot be used (no activation, a blocked frame, no
 * writable stream) the download is the fallback. Throws when the file could not be written.
 */
export async function saveToDisk(blob: Blob, name: string, env: SaveEnv = browserSaveEnv()): Promise<SavedVia> {
    if (env.picker !== null) {
        let handle: Awaited<ReturnType<NonNullable<SaveEnv['picker']>>>;
        try {
            handle = await env.picker({ suggestedName: name, types: [{ description: 'Fly by Sound recording', accept: { 'application/zip': ['.zip'] } }] });
        } catch (e) {
            if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
            // SecurityError, NotAllowedError: not inside a click, or the page is framed: the download does not need either
            env.download(blob, name);
            return 'download';
        }
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return 'picker';
    }
    env.download(blob, name);
    return 'download';
}

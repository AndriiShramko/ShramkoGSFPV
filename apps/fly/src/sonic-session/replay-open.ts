// Opening a recording to replay it (docs/wip/v12-plan.md section 4.3 step 5): a .zip the helper picked, or a session kept in this browser's
// storage. Either way the bytes go through the sound package's reader, which checks the zip's CRC-32s, the manifest against the format and
// the privacy rules, every listed file against its size and SHA-256, every line of the logs. A package that does not pass strictly is read
// again leniently (what is readable is kept and the problems are listed), so a file with a damaged tail still replays up to the damage and
// the helper is told; a file that is not a package at all is refused with the reason.
import { readPackage } from '@shramko/sonic-fpv';
import type { PackageProblem, SessionPackage } from '@shramko/sonic-fpv';
import type { SessionStores } from './recorder';
import { packageOf } from './registry';

/** The largest file the replay opens: an hour of flight with voice is about 30 MB; this stops a wrong file taking the tab down. */
export const MAX_OPEN_BYTES = 256 * 1024 * 1024;

export type Opened =
    | { readonly ok: true; readonly pkg: SessionPackage; /** read leniently: some of the file is damaged */ readonly lenient: boolean; readonly problems: readonly PackageProblem[] }
    | { readonly ok: false; readonly error: string };

export function openBytes(bytes: Uint8Array): Opened {
    if (bytes.length > MAX_OPEN_BYTES) return { ok: false, error: 'the file is too large' };
    try {
        return { ok: true, pkg: readPackage(bytes), lenient: false, problems: [] };
    } catch (strict) {
        try {
            const pkg = readPackage(bytes, { lenient: true });
            return { ok: true, pkg, lenient: true, problems: pkg.problems };
        } catch {
            return { ok: false, error: (strict instanceof Error ? strict.message : String(strict)).slice(0, 300) };
        }
    }
}

export async function openFile(file: Blob): Promise<Opened> {
    if (file.size > MAX_OPEN_BYTES) return { ok: false, error: 'the file is too large' };
    return openBytes(new Uint8Array(await file.arrayBuffer()));
}

/** A session in the browser's storage, packed and read through the same checks as a file. */
export async function openSession(stores: SessionStores, id: string): Promise<Opened> {
    try {
        return await openFile(await packageOf(stores, id));
    } catch (e) {
        return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
    }
}

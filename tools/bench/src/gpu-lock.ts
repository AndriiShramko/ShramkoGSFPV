// The benches' GPU lock (C:/dev/.gpu-lock): a run that draws holds it, so two runs never share the GPU (their frame and timing numbers
// would be each other's) and the owner's own renders are not disturbed. A directory made atomically; one older than 30 minutes is a
// run that died with it and is taken over. Shared by tools/bench/src/sonic-garden-pilot.ts (and the sonic page runs) and accept-fly.ts.
import { mkdirSync, rmdirSync, statSync } from 'node:fs';

export const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Waits for the lock and takes it. */
export async function lock(): Promise<void> {
    let waited = 0;
    for (;;) {
        try {
            mkdirSync(LOCK);
            return;
        } catch {
            try {
                if (Date.now() - statSync(LOCK).mtimeMs > 30 * 60 * 1000) {
                    rmdirSync(LOCK);
                    continue;
                }
            } catch {
                /* gone */
            }
            if (!waited++ || waited % 600 === 0) console.log('waiting for the GPU lock');
            await sleep(100);
        }
    }
}

/** Lets the lock go (nothing when it is not held). */
export const unlock = (): void => {
    try {
        rmdirSync(LOCK);
    } catch {
        /* not ours */
    }
};

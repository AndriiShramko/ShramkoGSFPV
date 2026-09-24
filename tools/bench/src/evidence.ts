// Evidence writer: every acceptance number lands in evidence/<date>/<name>.json with its context.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function today(): string {
    return new Date().toISOString().slice(0, 10);
}

export function gitSha(): string {
    try {
        return execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim();
    } catch {
        return 'unknown';
    }
}

export function context(): Record<string, unknown> {
    return {
        date: new Date().toISOString(),
        gitHead: gitSha(),
        gitDirty: (() => { try { return execSync('git status --porcelain', { cwd: REPO }).toString().trim().length > 0; } catch { return null; } })(),
        node: process.version,
        platform: `${os.platform()} ${os.release()}`,
        cpu: os.cpus()[0]?.model ?? 'unknown'
    };
}

export function writeEvidence(name: string, data: Record<string, unknown>, date = today()): string {
    const dir = join(REPO, 'evidence', date);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${name}.json`);
    writeFileSync(file, JSON.stringify({ name, context: context(), ...data }, null, 2) + '\n');
    return file;
}

/** Merge a summary entry into evidence/latest.json (numbers used by the landing page). */
export function updateLatest(key: string, value: Record<string, unknown>): void {
    const file = join(REPO, 'evidence', 'latest.json');
    const cur = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { updated: null, items: {} };
    cur.items[key] = value;
    cur.updated = new Date().toISOString();
    writeFileSync(file, JSON.stringify(cur, null, 2) + '\n');
}

// Evidence writer: every acceptance number lands in evidence/<date>/<name>.json with its context.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

// GSFPV_REPO: set by drivers for bundled workers (.cache/*.mjs), whose own path says nothing about the repo
export const REPO = process.env.GSFPV_REPO ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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

/**
 * JSON with every non-ASCII character as a unicode escape: the same data, but the repository keeps
 * no Cyrillic or Polish letters outside locales/ (recorded page text in RU/PL is data, not prose).
 */
export function asciiJson(json: string): string {
    const BS = String.fromCharCode(92);
    let out = '';
    for (let i = 0; i < json.length; i++) {
        const c = json.charCodeAt(i);
        out += c < 128 ? json[i] : BS + 'u' + c.toString(16).padStart(4, '0');
    }
    return out;
}

export function writeEvidence(name: string, data: Record<string, unknown>, date = today()): string {
    const dir = join(REPO, 'evidence', date);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${name}.json`);
    writeFileSync(file, asciiJson(JSON.stringify({ name, context: context(), ...data }, null, 2)) + String.fromCharCode(10));
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

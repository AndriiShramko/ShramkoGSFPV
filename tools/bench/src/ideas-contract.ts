// The admin ideas API as the kanban relies on it, one file for both sides:
// apps/api/tests/ideas-admin-contract.json. apps/api/tests/test_ideas_contract.py replays it against the
// real handler; this module replays it against anything that answers like /api/admin/ (the mock of
// src/ideas-mock.ts in tools/bench/test/ideas-contract.test.ts). Same rules as the Python replay: a step
// names a route and a body, the status, the reason, the answer's keys and the values at dotted paths it
// must get ('*' maps over a list); `save` keeps a value for a later `$name`; `world` changes the server's
// surroundings (Gmail set up or not, an unreadable store).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './evidence';

export interface ContractIdea { id: string; kind: string; text: string; contact: string; lang: string }
export interface ContractStep {
    say: string;
    get?: string;
    post?: string;
    body?: unknown;
    status?: number;
    keys?: string[];
    expect?: Record<string, unknown>;
    save?: Record<string, string>;
    world?: { mail?: boolean; store?: string };
}
export interface Contract { v: 1; about: string; ideas: Record<string, ContractIdea>; steps: ContractStep[] }

export const CONTRACT_FILE = join(REPO, 'apps', 'api', 'tests', 'ideas-admin-contract.json');

export function loadContract(): Contract {
    return JSON.parse(readFileSync(CONTRACT_FILE, 'utf8')) as Contract;
}

/** The value at a dotted path; '*' maps the rest over a list; '<missing>' when a step is not there (never equals null). */
export function pick(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    const go = (o: unknown, i: number): unknown => {
        if (i === parts.length) return o;
        const p = parts[i];
        if (p === '*') return Array.isArray(o) ? o.map((x) => go(x, i + 1)) : '<missing>';
        if (o && typeof o === 'object' && !Array.isArray(o) && p in o) return go((o as Record<string, unknown>)[p], i + 1);
        return '<missing>';
    };
    return go(obj, 0);
}

/** $name -> its value, inside strings (whole, or after a '/' in a route), lists and objects. */
export function subst(v: unknown, names: Record<string, unknown>): unknown {
    if (typeof v === 'string' && v.startsWith('$')) return v.slice(1) in names ? names[v.slice(1)] : v;
    if (typeof v === 'string' && v.includes('/$')) {
        const at = v.indexOf('/$');
        const name = v.slice(at + 2);
        return `${v.slice(0, at)}/${name in names ? String(names[name]) : `$${name}`}`;
    }
    if (Array.isArray(v)) return v.map((x) => subst(x, names));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subst(x, names)]));
    return v;
}

/** JSON with sorted keys: values compared by content. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** What a replay talks to: one request (route under /api/admin/), and the world steps. */
export interface ContractServer {
    call(method: 'GET' | 'POST', route: string, body: unknown): { status: number; json: unknown } | Promise<{ status: number; json: unknown }>;
    world(change: NonNullable<ContractStep['world']>): void;
}

/** Every step against `server`; what did not match (empty: it answers as the contract says). */
export async function replay(c: Contract, server: ContractServer): Promise<string[]> {
    const names: Record<string, unknown> = Object.fromEntries(Object.entries(c.ideas).map(([k, v]) => [k, v.id]));
    const bad: string[] = [];
    let n = 0;
    for (const s of c.steps) {
        n++;
        const where = `step ${n} (${s.say})`;
        if (s.world) { server.world(s.world); continue; }
        const method = s.get !== undefined ? 'GET' : 'POST';
        const route = String(subst(s.get ?? s.post, names));
        const { status, json } = await server.call(method, route, subst(s.body ?? null, names));
        if (s.status !== undefined && status !== s.status) { bad.push(`${where}: status ${status}, want ${s.status} (${JSON.stringify(json).slice(0, 200)})`); continue; }
        const doc = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
        if (s.keys && canon(Object.keys(doc).sort()) !== canon([...s.keys].sort())) bad.push(`${where}: keys ${Object.keys(doc).sort().join(',')}, want ${[...s.keys].sort().join(',')}`);
        for (const [path, w] of Object.entries(s.expect ?? {})) {
            const got = pick(doc, path);
            const want = subst(w, names);
            if (canon(got) !== canon(want)) bad.push(`${where}: ${path} = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
        }
        for (const [name, path] of Object.entries(s.save ?? {})) names[name] = pick(doc, path);
    }
    return bad;
}

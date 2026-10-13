// The kanban's mock of the admin ideas API (src/ideas-mock.ts) answers as the real server does: the same
// contract file (apps/api/tests/ideas-admin-contract.json) that apps/api/tests/test_ideas_contract.py
// replays against the real handler is replayed here against the mock. Controls: a mock that still takes
// the old send-done body {id} (no draft named) and a mock without the 503 of an unreadable store both fail.
import { describe, expect, it } from 'vitest';
import { loadContract, pick, replay, subst } from '../src/ideas-contract';
import type { Contract, ContractServer } from '../src/ideas-contract';
import { IdeasMock, MOCK_CSRF, mockRecord } from '../src/ideas-mock';

const contract = loadContract();

/** The mock with the contract's two ideas, driven like the admin page drives it (session's CSRF on POST). */
function mockServer(mock = new IdeasMock(Object.values(contract.ideas).map((i) => mockRecord({ ...i })))): ContractServer & { mock: IdeasMock } {
    return {
        mock,
        call: (method, route, body) => mock.handle(method, route, method === 'POST' ? { 'x-csrf': MOCK_CSRF } : {}, body as Record<string, unknown> | null),
        world: (w) => mock.world(w)
    };
}

describe('the ideas mock follows the contract the real server is held to', () => {
    it('every step of apps/api/tests/ideas-admin-contract.json', async () => {
        expect(contract.steps.length).toBeGreaterThanOrEqual(30);
        const s = mockServer();
        expect(await replay(contract, s)).toEqual([]);
        // the old {id} body is part of the file and refused
        expect(contract.steps.some((x) => x.post === 'ideas/send-done' && JSON.stringify(x.body) === '{"id":"$pilot"}' && x.status === 400)).toBe(true);
        expect(s.mock.mails('sent', 'sending')).toEqual([]);
    });

    it('a mock that still takes send-done {id} fails the replay (control)', async () => {
        class OldMock extends IdeasMock {
            override handle(method: string, path: string, headers: Record<string, string>, body: Record<string, unknown> | null) {
                if (path === 'ideas/send-done' && body && body.mail === undefined) {
                    const it = this.ideas.find((x) => x.id === body.id);
                    const draft = (it?.thread as { id: string; kind: string; state: string }[] | undefined)?.filter((m) => m.kind === 'done' && m.state === 'draft').at(-1);
                    return super.handle(method, path, headers, { ...body, mail: draft?.id ?? 'M-0' });
                }
                return super.handle(method, path, headers, body);
            }
        }
        const bad = await replay(contract, mockServer(new OldMock(Object.values(contract.ideas).map((i) => mockRecord({ ...i })))));
        expect(bad.some((b) => b.includes('Send without naming the draft'))).toBe(true);
    });

    it('a mock without the 503 of an unreadable store fails the replay (control)', async () => {
        const s = mockServer();
        const noStore: ContractServer = { call: s.call, world: (w) => s.mock.world({ ...w, store: undefined }) };
        const bad = await replay(contract, noStore);
        expect(bad.filter((b) => b.includes('ideas-store') || b.includes('want 503')).length).toBeGreaterThanOrEqual(4);
    });

    it('the replay compares what it says: a changed expectation is reported, paths and names resolve', async () => {
        const changed = structuredClone(contract) as Contract;
        const step = changed.steps.find((x) => x.say.startsWith('Send under the replaced draft'))!;
        step.expect = { reason: 'no-draft' };
        const bad = await replay(changed, mockServer());
        expect(bad).toHaveLength(1);
        expect(bad[0]).toContain('reason = "stale-draft", want "no-draft"');
        expect(pick({ a: [{ b: 1 }, { b: 2 }] }, 'a.*.b')).toEqual([1, 2]);
        expect(pick({ a: null }, 'a.b')).toBe('<missing>');
        expect(subst({ id: '$x', r: 'ideas/$x', l: ['$y'] }, { x: 'R-1', y: 2 })).toEqual({ id: 'R-1', r: 'ideas/R-1', l: [2] });
    });
});

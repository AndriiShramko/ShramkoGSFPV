// Train 1B integration: listRooms must not hand the panel a null list when the server answers 200 without a rooms
// array (local serve-csp has no rooms API; the rooms page threw "Cannot read properties of null (reading 'rooms')").
import { describe, expect, it } from 'vitest';
import { listRooms } from '../../../apps/fly/src/rooms/api';

const answer = (status: number, text: string): typeof fetch =>
    (async () => new Response(text, { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

describe('listRooms body', () => {
    it('a 200 with an empty body is an error, not a null value', async () => {
        const a = await listRooms('', answer(200, ''));
        expect(a.ok).toBe(false);
    });
    it('a 200 with HTML or a body without rooms is an error', async () => {
        expect((await listRooms('', answer(200, '{"v":1}'))).ok).toBe(false);
        expect((await listRooms('', answer(200, 'null'))).ok).toBe(false);
    });
    it('a real list passes through', async () => {
        const a = await listRooms('', answer(200, '{"v":1,"rooms":[]}'));
        expect(a.ok).toBe(true);
        if (a.ok) expect(a.value.rooms).toEqual([]);
    });
});

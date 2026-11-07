// The owner's Sessions tab (apps/fly/src/admin/sessions): how a row of the list is read, filtered and written. Node only (model.ts has no DOM and no
// words); the tab itself, the download and the clicks are tried in a browser against the real routes in tools/bench/src/sonicrec-admin.ts, and the
// routes in apps/api/tests/test_sessions_admin.py. Every claim has a control.
import { describe, expect, it } from 'vitest';
import { CHANNELS, confirmed, formatBytes, formatLength, formatMiB, matches, rowState, undelivered } from '../../../apps/fly/src/admin/sessions/model';
import type { SessionRow } from '../../../apps/fly/src/admin/sessions/model';
import { packagePath } from '../../../apps/fly/src/admin/sessions/api';

const ch = (status: string, attempts = 1, error = ''): { status: string; attempts: number; error: string; at: string | null } => ({ status, attempts, error, at: status === 'sent' ? '2026-11-07T10:00:00Z' : null });
const row = (telegram: string, email: string, over: Partial<SessionRow> = {}, lesson = 'walls-hall'): SessionRow => ({
    id: 'S-20261107-000000000001',
    storedAt: '2026-11-07T10:00:00Z',
    bytes: 2_204_024,
    sha256: 'f'.repeat(64),
    summary: { packageId: 'pkg0000000000001', lesson, path: 'fast', locale: 'pl', minor: false, guardianConfirmed: false, voice: true, complete: true, durationMs: 83_000, release: 'abc1234', sonic: '3959930', files: [] },
    channels: { telegram: ch(telegram), email: ch(email) },
    delivered: ['sent', 'link'].includes(telegram) && ['sent', 'link'].includes(email),
    ...over
});

describe('how a row reads', () => {
    it('delivered needs both channels confirmed AND the server saying so; a link counts as confirmed', () => {
        expect(rowState(row('sent', 'sent'))).toBe('delivered');
        expect(rowState(row('sent', 'link'))).toBe('delivered');
        expect(rowState(row('link', 'link'))).toBe('delivered');
        // control: one channel is not enough, whatever the other says
        for (const [a, b] of [['sent', 'queued'], ['sent', 'retrying'], ['sent', 'sending'], ['queued', 'sent']] as const) expect(rowState(row(a, b)), `${a}/${b}`).toBe('half');
        // and a server that says delivered while a channel is open is not believed either
        expect(rowState(row('sent', 'queued', { delivered: true }))).toBe('half');
        // the server's word without the channels is not enough
        expect(rowState(row('sent', 'sent', { delivered: false }))).toBe('half');
    });

    it('a channel that gave up wins over everything else; nothing confirmed is waiting', () => {
        expect(rowState(row('sent', 'failed'))).toBe('failed');
        expect(rowState(row('failed', 'sent'))).toBe('failed');
        expect(rowState(row('failed', 'failed'))).toBe('failed');
        expect(rowState(row('queued', 'queued'))).toBe('waiting');
        expect(rowState(row('retrying', 'sending'))).toBe('waiting');
        expect(rowState({ ...row('queued', 'queued'), channels: {} })).toBe('waiting'); // a server that reports no channel yet
    });

    it('confirmed: sent and link only', () => {
        expect(['sent', 'link', 'queued', 'sending', 'retrying', 'failed', 'unknown', undefined].map(confirmed)).toEqual([true, true, false, false, false, false, false, false]);
        expect(CHANNELS).toEqual(['telegram', 'email']);
    });
});

describe('the filter and the search', () => {
    const rows = [row('sent', 'sent', { id: 'S-20261107-000000000001' }, 'rings-first'), row('sent', 'retrying', { id: 'S-20261107-000000000002' }, 'walls-hall'), row('failed', 'sent', { id: 'S-20261107-000000000003' }, 'corridor-turns')];
    const ids = (f: 'all' | 'undelivered' | 'failed', q = ''): string[] => rows.filter((r) => matches(r, f, q)).map((r) => r.id.slice(-1));

    it('all shows every row, undelivered the two that wait, failed the one that gave up', () => {
        expect(ids('all')).toEqual(['1', '2', '3']);
        expect(ids('undelivered')).toEqual(['2', '3']);
        expect(ids('failed')).toEqual(['3']);
        expect(undelivered(rows).map((r) => r.id.slice(-1))).toEqual(['2', '3']);
    });

    it('the search looks at the id, the lesson, the language and the release, whatever the case; and it combines with the filter', () => {
        expect(ids('all', 'RINGS')).toEqual(['1']);
        expect(ids('all', '  walls ')).toEqual(['2']);
        expect(ids('all', 'S-20261107-000000000003')).toEqual(['3']);
        expect(ids('all', 'pl')).toEqual(['1', '2', '3']); // the language
        expect(ids('all', 'abc1234')).toEqual(['1', '2', '3']); // the release
        expect(ids('undelivered', 'rings')).toEqual([]); // control: it is delivered, so the filter hides it even though the search finds it
        expect(ids('all', 'nothing-like-this')).toEqual([]);
    });
});

describe('how numbers are written', () => {
    it('sizes in the decimal units of a mail attachment', () => {
        expect([0, 999, 1000, 512_000, 999_999, 1_000_000, 2_204_024, 9_999_999, 10_000_000, 25_000_000, null, undefined, Number.NaN].map((n) => formatBytes(n as number))).toEqual(['0 B', '999 B', '1 KB', '512 KB', '1000 KB', '1.0 MB', '2.2 MB', '10.0 MB', '10 MB', '25 MB', '—', '—', '—']);
    });

    it('a size limit in MiB, as the deployment names it', () => {
        expect([49 * 1048576, 15 * 1048576, 100 * 1048576, 1048576, null, undefined, Number.NaN].map((n) => formatMiB(n as number))).toEqual(['49 MiB', '15 MiB', '100 MiB', '1 MiB', '—', '—', '—']);
    });

    it('lengths as m:ss, and a dash when the package did not say', () => {
        expect([0, 999, 1000, 83_000, 600_000, 3_599_000, null, undefined, -5].map((n) => formatLength(n as number))).toEqual(['0:00', '0:01', '0:01', '1:23', '10:00', '59:59', '—', '—', '—']);
    });
});

describe('the download is a link, never a script', () => {
    it('the path carries only the id, encoded', () => {
        expect(packagePath('S-20261107-000000000001')).toBe('/api/admin/sessions/S-20261107-000000000001/package');
        expect(packagePath('a/b?c')).toBe('/api/admin/sessions/a%2Fb%3Fc/package');
    });
});

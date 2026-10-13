// The admin's Ideas kanban without a page (apps/fly/src/admin/ideas/api.ts + board.ts; owner's items 3,
// 7, 8; docs/wip/v07-c.md), against the mock of lane B's contract (tools/bench/src/ideas-mock.ts):
//  - a move sends exactly one ideas/update {id, status} with the session's CSRF token; a move to the same
//    column, or to a column that does not exist, sends nothing (control);
//  - every other change goes to its route with its body; e-mail: a reply is queued behind the undo window,
//    a thank-you is only a draft until send-done, Cancel stops what has not gone;
//  - the columns and their order, the filters and the search;
//  - a thank-you is due only for a pilot's idea with an e-mail that is done and not thanked yet;
//  - a record with an unknown status is counted, never guessed into a column.
// Every rule is shown with the input that breaks it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdeasMock, mockIdeas } from '../src/ideas-mock';

const { AdminClient } = await import('../../../apps/fly/src/admin/api');
const { IdeasClient, parseIdea, parseIdeas, IDEA_STATUSES } = await import('../../../apps/fly/src/admin/ideas/api');
const B = await import('../../../apps/fly/src/admin/ideas/board');
type Idea = import('../../../apps/fly/src/admin/ideas/api').Idea;
type IdeaFilter = import('../../../apps/fly/src/admin/ideas/board').IdeaFilter;

let mock: IdeasMock;
let client: InstanceType<typeof IdeasClient>;

beforeEach(async () => {
    mock = new IdeasMock();
    vi.stubGlobal('fetch', mock.fetch);
    const admin = new AdminClient();
    expect(await admin.resume()).toBe(true); // the session's CSRF token, as after a page reload
    client = new IdeasClient(admin);
});

const idea = (o: Partial<Idea> = {}): Idea => ({ ...parseIdea(mockIdeas()[0])!, ...o });
const P1 = 'R-20261006-0001';

describe('the client speaks lane B\'s contract', () => {
    it('reads the store: the record fields mapped, the setup, the record it cannot place counted, not guessed', async () => {
        const { ideas, unreadable, setup } = await client.list();
        expect(unreadable).toBe(1);
        expect(ideas.map((i) => i.id)).not.toContain('R-20261012-0006');
        expect(setup).toEqual({ mail: true, mailFrom: 'owner@example.com', bot: false, undoSeconds: 60 });
        const p = ideas.find((i) => i.id === P1)!;
        expect([p.ts, p.locale, p.email, p.urgency, p.fromPilot, p.public.visible]).toEqual(['2026-10-06T09:00:00Z', 'pl', 'pilot.one@example.com', null, true, true]);
        const f = ideas.find((i) => i.kind === 'feature')!;
        expect([f.fromPilot, f.done, f.order]).toEqual([false, '2026-09-24T00:00:00Z', 1]);
        // control: the same record with a status the board knows is placed
        expect(parseIdeas({ ideas: [{ ...mockIdeas()[7], status: 'new' }] })).toMatchObject({ unreadable: 0, ideas: [{ id: 'R-20261012-0006', status: 'new' }] });
    });

    it('a kanban move is one POST ideas/update {id, status} with the CSRF token; the card takes the server answer', async () => {
        const { ideas } = await client.list();
        const body = B.moveBody(ideas.find((i) => i.id === P1)!, 'accepted');
        expect(body).toEqual({ id: P1, status: 'accepted' });
        const moved = await client.setStatus(body!.id, body!.status);
        expect(mock.posts()).toEqual([{ method: 'POST', path: 'ideas/update', body: { id: P1, status: 'accepted' } }]);
        expect(moved.status).toBe('accepted');
    });

    it('a move to the same column or to an unknown column sends nothing (control)', () => {
        const card = idea({ status: 'accepted' });
        expect(B.moveBody(card, 'accepted')).toBeNull();
        expect(B.moveBody(card, 'archive')).toBeNull();
        expect(B.moveBody(card, 'done')).toEqual({ id: card.id, status: 'done' });
        expect(mock.posts()).toEqual([]);
    });

    it('without the CSRF token the server refuses (the token really travels: control)', async () => {
        const bare = new IdeasClient(new AdminClient()); // never resumed: no token
        await expect(bare.setStatus(P1, 'done')).rejects.toThrow(/csrf/);
        await expect(client.setStatus(P1, 'done')).resolves.toMatchObject({ status: 'done' });
    });

    it('urgency (and clearing it), comment, public title, note: each its own body', async () => {
        await client.setUrgency(P1, 'urgent');
        await client.setUrgency(P1, null);
        await client.comment(P1, 'do it next');
        const pub = await client.setPublic(P1, { en: 'Rates types', pl: 'Typy rates' }, false);
        const note = await client.addNote({ text: 'Wind from the north on the hill scan', contact: 'field.pilot@example.com', lang: 'pl', urgency: 'high' });
        expect(mock.posts().map((c) => [c.path, c.body])).toEqual([
            ['ideas/update', { id: P1, urgency: 'urgent' }],
            ['ideas/update', { id: P1, urgency: null }],
            ['ideas/update', { id: P1, comment: 'do it next' }],
            ['ideas/update', { id: P1, publicTitle: { en: 'Rates types', pl: 'Typy rates' }, visible: false }],
            ['ideas/note', { text: 'Wind from the north on the hill scan', contact: 'field.pilot@example.com', lang: 'pl', urgency: 'high', kind: 'note' }]
        ]);
        expect([pub.urgency, pub.comments.at(-1)?.text, pub.public.visible, pub.public.title.pl]).toEqual([null, 'do it next', false, 'Typy rates']);
        expect([note.kind, note.status, note.fromPilot, note.email]).toEqual(['note', 'new', true, 'field.pilot@example.com']);
    });

    it('a reply is queued behind the undo window and can be cancelled until it goes', async () => {
        const after = await client.reply(P1, 'Thanks, queued.');
        const m = after.mails.at(-1)!;
        expect([m.kind, m.state, m.to, !!m.notBefore]).toEqual(['reply', 'queued', 'pilot.one@example.com', true]);
        const cancelled = await client.cancelMail(m.id);
        expect(cancelled.mails.at(-1)?.state).toBe('cancelled');
        expect(mock.posts().map((c) => c.body)).toEqual([{ id: P1, text: 'Thanks, queued.' }, { id: m.id }]);
        // control: without Gmail the same reply waits, and only an explicit send queues it
        mock.mailConfigured = false;
        const waiting = (await client.reply(P1, 'Second answer')).mails.at(-1)!;
        expect(waiting.state).toBe('waiting_setup');
        mock.mailConfigured = true;
        expect((await client.sendMail(waiting.id)).mails.at(-1)?.state).toBe('queued');
    });

    it('done makes a thank-you DRAFT only; send-done is the one call that queues it', async () => {
        const id = 'R-20261012-0005';
        const r = await client.done(id, { pl: 'Kanaly CH5 i CH6 mozna teraz przypisac w Sterowaniu.' });
        expect([r.idea.status, r.draft?.state, r.draft?.kind, r.draft?.to]).toEqual(['done', 'draft', 'done', 'pilot.two@example.com']);
        expect(r.idea.summary.pl).toMatch(/CH5/);
        expect(mock.mails('queued', 'sending', 'sent')).toEqual([]); // control: nothing on its way after done
        expect(B.thanksDue(r.idea) && B.thanksDraft(r.idea)?.id === r.draft?.id).toBe(true);
        const sent = await client.sendDone(id);
        expect(sent.mails.find((m) => m.kind === 'done')?.state).toBe('queued');
        expect(B.thanksDue(sent)).toBe(false);
        // no e-mail: done still works, no draft
        const bug = await client.done('R-20261008-0003', { en: 'Fixed in the next release.' });
        expect([bug.idea.status, bug.draft]).toEqual(['done', null]);
    });
});

describe('the board model', () => {
    const all = (): Idea[] => parseIdeas({ ideas: mockIdeas() }).ideas;

    it('puts every card in its column; the queue is most urgent first (not set last), New newest first, Done latest first', () => {
        const extra = [
            idea({ id: 'q-low', status: 'accepted', urgency: 'low', ts: '2026-01-01T00:00:00Z' }),
            idea({ id: 'q-none', status: 'accepted', urgency: null, ts: '2025-01-01T00:00:00Z' }),
            idea({ id: 'q-urgent', status: 'accepted', urgency: 'urgent', ts: '2026-10-12T00:00:00Z' }),
            idea({ id: 'd-new', status: 'done', done: '2026-10-13T10:00:00Z' })
        ];
        const c = B.columns([...all(), ...extra], B.ALL_IDEAS);
        expect(IDEA_STATUSES.map((s) => c[s].length)).toEqual([2, 4, 2, 2, 1]);
        expect(c.accepted.map((i) => i.id)).toEqual(['q-urgent', 'R-20261006-0002', 'q-low', 'q-none']);
        expect(c.new.map((i) => i.id)).toEqual(['R-20261008-0003', P1]);
        expect(c.done.map((i) => i.id)).toEqual(['d-new', 'F-edgetx-radio-over-usb-webhid-in-chrome']);
    });

    it('filters by kind, lowest urgency, contact and landing; every search word must be found', () => {
        const ids = (f: Partial<IdeaFilter>) => IDEA_STATUSES.flatMap((s) => B.columns(all(), { ...B.ALL_IDEAS, ...f })[s].map((i) => i.id)).sort();
        expect(ids({ kinds: new Set(['bug']) })).toEqual(['R-20261008-0003']);
        expect(ids({ minUrgency: 'high' })).toEqual(['R-20261006-0002', 'R-20261008-0003']);
        expect(ids({ minUrgency: 'low' })).not.toContain(P1); // not set is below every level
        expect(ids({ contact: 'no' })).toEqual(['F-edgetx-radio-over-usb-webhid-in-chrome', 'N-20261010-0001', 'R-20261008-0003']);
        expect(ids({ landing: 'yes' })).toEqual(['F-edgetx-radio-over-usb-webhid-in-chrome', 'N-20261010-0001', 'R-20261006-0002', 'R-20261012-0005']);
        expect(ids({ search: 'crosshair centre' })).toEqual(['R-20261006-0002']);
        expect(ids({ search: 'telegram hud' })).toEqual(['R-20261006-0002']); // contact + the owner's comment
        expect(ids({ search: 'crosshair motor' })).toEqual([]); // control: one word missing
        expect(ids({ search: 'PILOT.TWO@' })).toEqual(['R-20261012-0005']);
    });

    it('the landing follows lane B\'s rules: English title, a shown status, visible, not spam', () => {
        const on = idea({ status: 'done', public: { title: { en: 'X' }, text: {}, visible: true } });
        expect(B.onLanding(on)).toBe(true);
        expect(B.onLanding({ ...on, public: { ...on.public, visible: false } })).toBe(false);
        expect(B.onLanding({ ...on, status: 'new' })).toBe(false);
        expect(B.onLanding({ ...on, suspect: true })).toBe(false);
        expect(B.onLanding({ ...on, public: { title: { pl: 'tylko' }, text: {}, visible: true } })).toBe(false);
        expect(B.landingBlocker({ pl: 'tylko' }, 'done')).toBe('title');
        expect(B.landingBlocker({ en: 'X' }, 'rejected')).toBe('status');
        expect(B.landingBlocker({ en: 'X' }, 'accepted')).toBeNull();
        expect(B.missingLangs({ en: 'X', es: ' ' })).toEqual(['es', 'pl', 'ru']);
    });

    it('the keyboard move goes to the next column and stops at the edges', () => {
        expect(B.neighbour('new', 1)).toBe('accepted');
        expect(B.neighbour('done', -1)).toBe('in_progress');
        expect(B.neighbour('new', -1)).toBeNull();
        expect(B.neighbour('rejected', 1)).toBeNull();
    });

    it('a thank-you is due for a pilot\'s idea with an e-mail in Done, until it is on its way', () => {
        const due = idea({ status: 'done', email: 'pilot.one@example.com' });
        expect(B.thanksDue(due)).toBe(true);
        const mail = (state: Idea['mails'][number]['state']) => ({ id: 'M-1', kind: 'done' as const, to: 'pilot.one@example.com', lang: 'pl', subject: '', plain: '', state, created: '', notBefore: null, sentAt: null, error: '' });
        // controls: each condition alone stops it
        expect(B.thanksDue({ ...due, status: 'in_progress' })).toBe(false);
        expect(B.thanksDue({ ...due, email: '' })).toBe(false);
        expect(B.thanksDue({ ...due, kind: 'feature', fromPilot: false })).toBe(false);
        expect(B.thanksDue({ ...due, notified: '2026-10-13T12:00:00Z' })).toBe(false);
        expect(B.thanksDue({ ...due, mails: [mail('queued')] })).toBe(false);
        expect(B.thanksDue({ ...due, mails: [mail('sent')] })).toBe(false);
        // a draft, a cancelled or a failed one still leaves it due
        expect(B.thanksDue({ ...due, mails: [mail('draft')] })).toBe(true);
        expect(B.thanksDue({ ...due, mails: [mail('cancelled')] })).toBe(true);
        expect(B.thanksDraft({ ...due, mails: [mail('cancelled'), mail('draft')] })?.state).toBe('draft');
    });
});

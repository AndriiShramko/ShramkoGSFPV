// The admin's Ideas kanban without a page (apps/fly/src/admin/ideas/api.ts + board.ts; owner's item 3,
// docs/wip/v07-c.md), against the mock of lane B's contract (tools/bench/src/ideas-mock.ts):
//  - a move sends exactly one status call with the right body and the session's CSRF token; a move to the
//    same column, or to a column that does not exist, sends nothing (control);
//  - the columns and their order, the filters and the search;
//  - a thank-you is due only for a pilot's idea with an e-mail that reaches Done and was not thanked yet;
//  - a record with an unknown status is counted, never guessed into a column;
//  - the landing's groups are the same in the admin, the site dictionaries and the roadmap seed.
// Every rule is shown with the input that breaks it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IdeasMock, mockIdeas } from '../src/ideas-mock';

const { AdminClient } = await import('../../../apps/fly/src/admin/api');
const { IdeasClient, parseIdea, parseIdeas, IDEA_STATUSES } = await import('../../../apps/fly/src/admin/ideas/api');
const B = await import('../../../apps/fly/src/admin/ideas/board');
type Idea = import('../../../apps/fly/src/admin/ideas/api').Idea;

const REPO = join(__dirname, '..', '..', '..');
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

describe('the client speaks the contract', () => {
    it('lists the store, counting the record it cannot place instead of guessing a column', async () => {
        const { ideas, unreadable } = await client.list();
        expect(unreadable).toBe(1);
        expect(ideas.map((i) => i.id)).not.toContain('X-unknown-status');
        expect(ideas.length).toBe(mockIdeas().length - 1);
        // control: the same record with a status the board knows is placed
        expect(parseIdeas({ ideas: [{ ...mockIdeas()[7], status: 'new' }] })).toMatchObject({ unreadable: 0, ideas: [{ id: 'X-unknown-status', status: 'new' }] });
    });

    it('a kanban move is one POST ideas/status {id, status} with the CSRF token; the card takes the server answer', async () => {
        const { ideas } = await client.list();
        const card = ideas.find((i) => i.id === 'R-20261006-0001')!;
        const body = B.moveBody(card, 'accepted');
        expect(body).toEqual({ id: 'R-20261006-0001', status: 'accepted' });
        const moved = await client.setStatus(body!.id, body!.status);
        expect(mock.posts()).toEqual([{ method: 'POST', path: 'ideas/status', body: { id: 'R-20261006-0001', status: 'accepted' } }]);
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
        await expect(bare.setStatus('R-20261006-0001', 'done')).rejects.toThrow(/csrf/);
        await expect(client.setStatus('R-20261006-0001', 'done')).resolves.toMatchObject({ status: 'done' });
        expect(mock.calls.filter((c) => c.path === 'ideas/status').length).toBe(2);
    });

    it('urgency, comment, public title, reply and thank-you go to their own routes with their bodies', async () => {
        await client.setUrgency('R-20261006-0001', 'urgent');
        await client.comment('R-20261006-0001', 'do it next');
        await client.setPublic('R-20261006-0001', { title: { en: 'Rates types', pl: 'Typy rates' }, roadmap: true, group: 'drone' });
        await client.reply('R-20261006-0001', 'Thanks, queued.');
        const draft = await client.thanksDraft('R-20261006-0001');
        const after = await client.sendThanks('R-20261006-0001', draft.subject, draft.body);
        expect(mock.posts().map((c) => [c.path, c.body])).toEqual([
            ['ideas/urgency', { id: 'R-20261006-0001', urgency: 'urgent' }],
            ['ideas/comment', { id: 'R-20261006-0001', text: 'do it next' }],
            ['ideas/public', { id: 'R-20261006-0001', title: { en: 'Rates types', pl: 'Typy rates' }, roadmap: true, group: 'drone' }],
            ['ideas/reply', { id: 'R-20261006-0001', text: 'Thanks, queued.' }],
            ['ideas/thanks/draft', { id: 'R-20261006-0001' }],
            ['ideas/thanks/send', { id: 'R-20261006-0001', subject: 'Your idea is in the simulator', body: draft.body }]
        ]);
        expect(draft.to).toBe('pilot.one@example.com');
        expect(after.mails.map((m) => m.kind)).toEqual(['reply', 'thanks']);
        expect(after.comments.at(-1)?.text).toBe('do it next');
    });

    it('a draft sends nothing: only thanks/send records a mail (control)', async () => {
        await client.thanksDraft('R-20261006-0001');
        expect(mock.ideas.find((i) => i.id === 'R-20261006-0001')!.mails).toEqual([]);
    });
});

describe('the board model', () => {
    const all = (): Idea[] => parseIdeas({ ideas: mockIdeas() }).ideas;

    it('puts every card in its column; the queue is most urgent first, New newest first, Done latest first', () => {
        const extra = [
            idea({ id: 'q-low', status: 'accepted', urgency: 'low', ts: '2026-01-01T00:00:00Z' }),
            idea({ id: 'q-urgent', status: 'accepted', urgency: 'urgent', ts: '2026-10-12T00:00:00Z' }),
            idea({ id: 'd-new', status: 'done', done: '2026-10-13T10:00:00Z' })
        ];
        const c = B.columns([...all(), ...extra], B.ALL_IDEAS);
        expect(IDEA_STATUSES.map((s) => c[s].length)).toEqual([2, 3, 2, 2, 1]);
        expect(c.accepted.map((i) => i.id)).toEqual(['q-urgent', 'R-20261006-0002', 'q-low']);
        expect(c.new.map((i) => i.id)).toEqual(['R-20261008-0003', 'R-20261006-0001']);
        expect(c.done.map((i) => i.id)).toEqual(['d-new', 'F-edgetx-radio-over-usb-webhid-in-chrome']);
    });

    it('filters by kind, lowest urgency, contact and landing; every search word must be found', () => {
        const ids = (f: Partial<import('../../../apps/fly/src/admin/ideas/board').IdeaFilter>) =>
            IDEA_STATUSES.flatMap((s) => B.columns(all(), { ...B.ALL_IDEAS, ...f })[s].map((i) => i.id)).sort();
        expect(ids({ kinds: new Set(['bug']) })).toEqual(['R-20261008-0003']);
        expect(ids({ minUrgency: 'high' })).toEqual(['R-20261006-0002', 'R-20261008-0003']);
        expect(ids({ contact: 'no' })).toEqual(['F-edgetx-radio-over-usb-webhid-in-chrome', 'N-20261010-0001', 'R-20261008-0003']);
        expect(ids({ landing: 'yes' })).toEqual(['F-edgetx-radio-over-usb-webhid-in-chrome', 'N-20261010-0001', 'R-20261006-0002', 'R-20261012-0005']);
        expect(ids({ search: 'crosshair centre' })).toEqual(['R-20261006-0002']);
        expect(ids({ search: 'telegram hud' })).toEqual(['R-20261006-0002']); // contact + the owner's comment
        expect(ids({ search: 'crosshair motor' })).toEqual([]); // control: one word missing
        expect(ids({ search: 'PILOT.TWO@' })).toEqual(['R-20261012-0005']);
    });

    it('the keyboard move goes to the next column and stops at the edges', () => {
        expect(B.neighbour('new', 1)).toBe('accepted');
        expect(B.neighbour('done', -1)).toBe('in_progress');
        expect(B.neighbour('new', -1)).toBeNull();
        expect(B.neighbour('rejected', 1)).toBeNull();
    });

    it('a thank-you is due for a pilot idea with an e-mail in Done, once', () => {
        const due = idea({ status: 'done', contact: 'Pilot <pilot.one@example.com>' });
        expect(B.thanksDue(due)).toBe(true);
        expect(B.emailOf(due.contact)).toBe('pilot.one@example.com');
        // controls: each condition alone stops it
        expect(B.thanksDue({ ...due, status: 'in_progress' })).toBe(false);
        expect(B.thanksDue({ ...due, contact: '@pilotone on Telegram' })).toBe(false);
        expect(B.thanksDue({ ...due, fromPilot: false })).toBe(false);
        expect(B.thanksDue({ ...due, kind: 'feature' })).toBe(false);
        expect(B.thanksDue({ ...due, mails: [{ ts: '', kind: 'thanks', to: 'pilot.one@example.com', ok: true }] })).toBe(false);
        expect(B.thanksDue({ ...due, mails: [{ ts: '', kind: 'thanks', to: 'pilot.one@example.com', ok: false }] })).toBe(true);
    });

    it('the landing needs an English title and a status it shows; missing languages are named', () => {
        expect(B.landingBlocker({ title: { pl: 'tylko' }, roadmap: true, group: null }, 'done')).toBe('title');
        expect(B.landingBlocker({ title: { en: 'X' }, roadmap: true, group: null }, 'new')).toBe('status');
        expect(B.landingBlocker({ title: { en: 'X' }, roadmap: true, group: null }, 'accepted')).toBeNull();
        expect(B.missingLangs({ en: 'X', es: ' ' })).toEqual(['es', 'pl', 'ru']);
        expect(B.onLanding(idea({ status: 'done', public: { title: { en: 'X' }, roadmap: false, group: null } }))).toBe(false);
    });
});

/** Everything that disagrees between the admin's groups, the site dictionaries and the seed. */
function groupProblems(admin: readonly string[], adminDict: Record<string, string>, site: Record<string, Record<string, string>>, seedGroups: Set<string>): string[] {
    const out: string[] = [];
    const want = [...admin].join(',');
    for (const [l, groups] of Object.entries(site)) if (Object.keys(groups).join(',') !== want) out.push(`site ${l}: ${Object.keys(groups).join(',')}`);
    for (const g of admin) if (!adminDict[`admin.ideas.group.${g}`]) out.push(`admin dictionary: ${g}`);
    for (const g of seedGroups) if (!admin.includes(g)) out.push(`seed: ${g}`);
    return out;
}

describe('the landing groups are one list', () => {
    const site = Object.fromEntries(['en', 'es', 'pl', 'ru'].map((l) => [l, (JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'site', `${l}.json`), 'utf8')) as { features: { groups: Record<string, string> } }).features.groups]));
    const adminDict = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'admin', 'ideas', 'en.json'), 'utf8')) as Record<string, string>;
    const seed = new Set((JSON.parse(readFileSync(join(REPO, 'apps', 'api', 'locales', 'roadmap-seed.json'), 'utf8')) as { items: { group?: string }[] }).items.map((i) => i.group ?? ''));

    it('in the admin, the site dictionaries and the seed', () => {
        expect(groupProblems(B.LANDING_GROUPS, adminDict, site, seed)).toEqual([]);
    });

    it('a group added in one place only is caught (control)', () => {
        expect(groupProblems([...B.LANDING_GROUPS, 'wind'], adminDict, site, seed)).toEqual(['site en: radio,controls,drone,crash,camera,scenes,walls,settings', 'site es: radio,controls,drone,crash,camera,scenes,walls,settings', 'site pl: radio,controls,drone,crash,camera,scenes,walls,settings', 'site ru: radio,controls,drone,crash,camera,scenes,walls,settings', 'admin dictionary: wind']);
        expect(groupProblems(B.LANDING_GROUPS, adminDict, site, new Set([...seed, 'wind']))).toEqual(['seed: wind']);
    });
});

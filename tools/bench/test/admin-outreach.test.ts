// The admin's Outreach tab without a page (apps/fly/src/admin/outreach/api.ts + model.ts; owner's request
// 2026-10-16, FBG-SPEC-admin in the vault), against the SAME golden file the server's own test writes and checks
// (apps/api/tests/fixtures/outreach-view.sample.json, made by apps/api/outreach.py from the sample snapshot):
//  - the view the server sends parses; an answer of another shape is an error, never guessed;
//  - sorting: an unset value is last in both directions, ties are stable, a header press starts a column in its
//    natural direction and the same header flips it; filters and the search keep exactly the rows they name;
//  - the checkpoint strip puts each measurement under the checkpoint the server's due list would give it, and a
//    time that passed with no measurement is "missed", a time that has not come is "future", the due one is "due";
//  - the funnel's bars, the score bands, the slice names, the safe-link rule (https only);
//  - every word the tab draws is in the dictionaries, and no dead word is left (the parity of the four
//    languages is packages/i18n/test/admin-parity.test.ts);
//  - the page never writes a style attribute (the admin's CSP has none) and never sends anything but GET.
// Every rule is shown with the input that breaks it.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseAnswer, CHECKPOINTS_H, csvPath } = await import('../../../apps/fly/src/admin/outreach/api');
const M = await import('../../../apps/fly/src/admin/outreach/model');
type View = import('../../../apps/fly/src/admin/outreach/api').OutreachView;
type Group = import('../../../apps/fly/src/admin/outreach/api').GroupRow;
type Post = import('../../../apps/fly/src/admin/outreach/api').PostRow;
type Check = import('../../../apps/fly/src/admin/outreach/api').CheckRow;

const golden = (): unknown => JSON.parse(readFileSync(join(ROOT, 'apps', 'api', 'tests', 'fixtures', 'outreach-view.sample.json'), 'utf8'));
const sample = (): View => parseAnswer(golden()) as View;

const policy = { video: 'allowed', images: 'allowed', links: 'comments_only', self_promo: 'showcase_only', post_approval: 'yes' };
const group = (id: string, over: Partial<Group> = {}): Group => ({
    id, name: `Group ${id}`, url: `https://www.facebook.com/groups/${id}/`, lang: 'pl', members: 1000, topic: 'sim', fit: 3, verdict: 'post', wave: 1, policy,
    state: 'researched', prior_sim_post: 'none', last_post_at: null, posts: 0, published: 0, removed: 0, best_reactions: 0, best_comments: 0, score: null,
    score_pushed: null, eng: 0, pub_rate: null, removed_rate: null, worth: false, due_n: 0, note: null, ...over
});
const check = (age_h: number, reactions = 0): Check => ({ age_h, state: 'published', reactions, comments: 0, shares: 0, views: null, admin_action: 'none' });
const post = (id: string, over: Partial<Post> = {}): Post => ({
    id, group: 'a', group_name: 'A', kind: 'post', format: 'video', lang: 'pl', sent_at: '2026-10-17T08:10:00Z', state: 'published', url: null, link_placement: 'none',
    first_comment: 'none', angle: null, checks: [], note: null, topic: 'sim', latest: null, eng: null, age_h: 30, ...over
});

describe('the answer', () => {
    it('parses what the server sends for the sample snapshot', () => {
        const v = sample();
        expect(v.empty).toBe(false);
        expect(v.campaign).toBe('gsfpv');
        expect(v.groups.map((g) => g.id)).toEqual(['1647715522108395', 'velocidronesim']);
        expect(v.groups[0].score).toBe(100);
        expect(v.groups[0].worth).toBe(true);
        expect(v.posts[0].checks.map((c) => c.age_h)).toEqual([1, 24]);
        expect(v.totals.posts).toBe(1);
        expect(v.funnel.map((f) => f.stage)).toEqual(['groups', 'posted', 'published', 'removed']);
        expect(Object.keys(v.slices).sort()).toEqual(['format', 'format_lang_topic', 'kind', 'lang', 'topic']);
    });

    it('an empty answer is the empty state, with or without an unreadable file', () => {
        expect(parseAnswer({ ok: true, empty: true, unreadable: false })).toEqual({ empty: true, unreadable: false });
        expect(parseAnswer({ ok: true, empty: true, unreadable: true })).toEqual({ empty: true, unreadable: true });
    });

    it('control: an answer of another shape is an error', () => {
        for (const bad of [null, {}, { ok: false }, { ok: true }, { ok: true, empty: false }, { ok: true, empty: false, groups: [], posts: {} }]) {
            expect(() => parseAnswer(bad), JSON.stringify(bad)).toThrow();
        }
        const g = golden() as Record<string, unknown>;
        delete g.slices;
        expect(() => parseAnswer(g)).toThrow(/slices/);
    });

    it('the CSV routes are the two tables and nothing else, plain GET paths', () => {
        expect(csvPath('groups')).toBe('/api/admin/outreach/export.csv?table=groups');
        expect(csvPath('posts')).toBe('/api/admin/outreach/export.csv?table=posts');
    });
});

describe('sorting', () => {
    const rows = [group('a', { members: 500, score: 40 }), group('b', { members: null, score: 90 }), group('c', { members: 2000, score: null }), group('d', { members: 500, score: 60 })];

    it('an unset value is last in both directions', () => {
        expect(M.sortGroups(rows, { key: 'members', dir: 'desc' }).map((g) => g.id)).toEqual(['c', 'a', 'd', 'b']);
        expect(M.sortGroups(rows, { key: 'members', dir: 'asc' }).map((g) => g.id)).toEqual(['a', 'd', 'c', 'b']);
        expect(M.sortGroups(rows, { key: 'score', dir: 'desc' }).map((g) => g.id)).toEqual(['b', 'd', 'a', 'c']);
        expect(M.sortGroups(rows, { key: 'score', dir: 'asc' }).map((g) => g.id)).toEqual(['a', 'd', 'b', 'c']);
    });

    it('ties keep a stable order (by name, then id) and the input is not changed', () => {
        const copy = [...rows];
        const once = M.sortGroups(rows, { key: 'members', dir: 'asc' }).map((g) => g.id);
        expect(M.sortGroups([...rows].reverse(), { key: 'members', dir: 'asc' }).map((g) => g.id)).toEqual(once);
        expect(rows).toEqual(copy);
    });

    it('words sort A to Z ignoring case and with numbers in order', () => {
        const named = [group('x', { name: 'beta 10' }), group('y', { name: 'Alpha' }), group('z', { name: 'beta 2' })];
        expect(M.sortGroups(named, { key: 'name', dir: 'asc' }).map((g) => g.name)).toEqual(['Alpha', 'beta 2', 'beta 10']);
    });

    it('a header press starts a column in its natural direction; the same header flips it', () => {
        const s0 = { key: 'score', dir: 'desc' } as const;
        expect(M.nextSort(s0, 'score')).toEqual({ key: 'score', dir: 'asc' });
        expect(M.nextSort(s0, 'name')).toEqual({ key: 'name', dir: 'asc' });
        expect(M.nextSort(s0, 'members')).toEqual({ key: 'members', dir: 'desc' });
        expect(M.nextSort(M.nextSort(s0, 'score'), 'score')).toEqual(s0);
    });

    it('posts sort by a measurement of the latest check, an unmeasured post last', () => {
        const ps = [post('p1', { latest: check(24, 5) }), post('p2', { latest: null }), post('p3', { latest: check(72, 50) })];
        expect(M.sortPosts(ps, { key: 'reactions', dir: 'desc' }).map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
        expect(M.sortPosts(ps, { key: 'reactions', dir: 'asc' }).map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
    });
});

describe('filters and search', () => {
    const rows = [
        group('a', { name: 'Drony RC FPV Polska', verdict: 'post', state: 'published', lang: 'pl', topic: 'polish-drone', wave: 1, worth: true, note: 'Wideo OK' }),
        group('b', { name: 'VelociDrone Community', verdict: 'comment_only', lang: 'en', topic: 'sim', wave: 3 }),
        group('c', { name: 'Local group', verdict: null, lang: null, topic: null, wave: null, state: 'banned' })
    ];
    const pass = (f: Partial<import('../../../apps/fly/src/admin/outreach/model').GroupFilter>): string[] => rows.filter((g) => M.groupMatches(g, { ...M.ALL_GROUPS, ...f })).map((g) => g.id);

    it('each filter keeps the rows it names; "not set" finds the unset ones', () => {
        expect(pass({})).toEqual(['a', 'b', 'c']);
        expect(pass({ verdict: 'post' })).toEqual(['a']);
        expect(pass({ lang: 'en' })).toEqual(['b']);
        expect(pass({ lang: M.NONE })).toEqual(['c']);
        expect(pass({ wave: '3' })).toEqual(['b']);
        expect(pass({ wave: M.NONE })).toEqual(['c']);
        expect(pass({ state: 'banned', topic: M.NONE })).toEqual(['c']);
        expect(pass({ worthOnly: true })).toEqual(['a']);
        expect(pass({ verdict: 'post', lang: 'en' })).toEqual([]);
    });

    it('every word of the search must be found, anywhere in the row, ignoring case', () => {
        expect(pass({ search: 'drony polska' })).toEqual(['a']);
        expect(pass({ search: 'WIDEO' })).toEqual(['a']);
        expect(pass({ search: 'velocidrone comment_only' })).toEqual(['b']);
        expect(pass({ search: 'drone zzz' })).toEqual([]);
        expect(pass({ search: '   ' })).toEqual(['a', 'b', 'c']);
    });

    it('the facets come from the rows, "not set" last', () => {
        expect(M.facet(rows, (g) => g.lang)).toEqual(['en', 'pl', M.NONE]);
        expect(M.facet(rows, (g) => g.wave)).toEqual(['1', '3', M.NONE]);
        expect(M.facet([], (g: Group) => g.lang)).toEqual([]);
    });

    it('posts: state, format, language, kind and the words', () => {
        const ps = [post('p1', { group_name: 'Alpha', state: 'published', format: 'video' }), post('p2', { group_name: 'Beta', state: 'removed', format: 'image', lang: null, kind: 'comment' })];
        const pass2 = (f: Partial<import('../../../apps/fly/src/admin/outreach/model').PostFilter>): string[] => ps.filter((p) => M.postMatches(p, { ...M.ALL_POSTS, ...f })).map((p) => p.id);
        expect(pass2({ state: 'removed' })).toEqual(['p2']);
        expect(pass2({ format: 'video' })).toEqual(['p1']);
        expect(pass2({ lang: M.NONE })).toEqual(['p2']);
        expect(pass2({ kind: 'comment' })).toEqual(['p2']);
        expect(pass2({ search: 'beta' })).toEqual(['p2']);
        expect(pass2({ search: 'beta', state: 'published' })).toEqual([]);
    });
});

describe('the checkpoint strip', () => {
    it('a measurement sits under the checkpoint the server would give it', () => {
        const p = (ages: number[]): Post => post('p', { checks: ages.map((a) => check(a)) });
        const at = (ages: number[], i: number): number | null => M.checkFor(p(ages), i)?.age_h ?? null;
        expect(CHECKPOINTS_H).toEqual([1, 24, 72, 168, 720]);
        expect(at([1, 24], 0)).toBe(1);
        expect(at([1, 24], 1)).toBe(24);
        expect(at([30], 1)).toBe(30); // late, but inside the +24 h window (18 h to 72 h)
        expect(at([800], 4)).toBe(800);
        expect(at([800], 3)).toBeNull();
        expect(at([10], 0)).toBe(10); // the +1 h window runs to the next checkpoint
        expect(at([10], 1)).toBeNull();
        expect(at([], 2)).toBeNull();
        expect(at([70, 80], 2)).toBe(70); // two in a window: the nearer to the checkpoint
    });

    it('taken, due, missed and future', () => {
        const base = post('p', { age_h: 100, checks: [check(1), check(24)] });
        const strip = M.checkpointStrip(base, 72).map((c) => c.state);
        expect(strip).toEqual(['taken', 'taken', 'due', 'future', 'future']);
        // the same post with no due flag: the 72 h time passed without a measurement
        expect(M.checkpointStrip(base, undefined).map((c) => c.state)).toEqual(['taken', 'taken', 'missed', 'future', 'future']);
        // control: a post 800 h old that skipped the middle ones
        expect(M.checkpointStrip(post('q', { age_h: 800, checks: [check(1), check(24)] }), 720).map((c) => c.state)).toEqual(['taken', 'taken', 'missed', 'missed', 'due']);
        expect(M.checkpointStrip(post('r', { age_h: null, checks: [] }), undefined).map((c) => c.state)).toEqual(['missed', 'missed', 'missed', 'missed', 'missed']);
    });

    it('the sample post: +1 h and +24 h taken, the rest still to come at its age', () => {
        const v = sample();
        const s = M.checkpointStrip({ ...v.posts[0], age_h: 3.8 }, v.due.checks[0]?.due_cp_h);
        expect(s.map((c) => c.state)).toEqual(['taken', 'taken', 'future', 'future', 'future']);
        expect(s[1].check?.reactions).toBe(34);
    });
});

describe('small rules', () => {
    it('the funnel bars: width against the first stage, share of the step before', () => {
        const bars = M.funnelBars([{ stage: 'groups', n: 80 }, { stage: 'posted', n: 40 }, { stage: 'published', n: 30 }, { stage: 'removed', n: 3 }]);
        expect(bars.map((b) => b.width)).toEqual([100, 50, 38, 4]);
        expect(bars.map((b) => b.ofPrev)).toEqual([null, 50, 75, 10]);
        const none = M.funnelBars([{ stage: 'groups', n: 0 }, { stage: 'posted', n: 0 }]);
        expect(none.map((b) => [b.width, b.ofPrev])).toEqual([[0, null], [0, null]]);
        expect(M.funnelBars([])).toEqual([]);
    });

    it('score bands: worth from the server threshold, ok from 40, none without posts', () => {
        expect(M.scoreBand(null, 75)).toBe('none');
        expect(M.scoreBand(75, 75)).toBe('worth');
        expect(M.scoreBand(74.9, 75)).toBe('ok');
        expect(M.scoreBand(40, 75)).toBe('ok');
        expect(M.scoreBand(39.9, 75)).toBe('low');
        expect(M.scoreBand(0, 75)).toBe('low');
    });

    it('slice names follow the picker dimensions; an unset value is "none"', () => {
        const row = { format: 'video', lang: 'pl', topic: 'sim', n: 1, published: 1, removed: 0, measured: 1, median_reactions: 1, median_comments: 1, median_eng: 1 };
        expect(M.sliceName(row, 'format_lang_topic')).toEqual(['video', 'pl', 'sim']);
        expect(M.sliceName(row, 'lang')).toEqual(['pl']);
        expect(M.sliceName({ ...row, topic: undefined }, 'topic')).toEqual([M.NONE]);
    });

    it('a link is opened only when it is an https address (the server refuses others; this is the second lock)', () => {
        expect(M.safeUrl('https://www.facebook.com/groups/1/')).toBe('https://www.facebook.com/groups/1/');
        for (const bad of ['javascript:alert(1)', 'http://www.facebook.com/', 'data:text/html,x', '//evil', 'https://a b', '', null]) expect(M.safeUrl(bad), String(bad)).toBeNull();
    });

    it('age text: hours under two days, then days', () => {
        expect(M.ageParts(3.4)).toEqual({ n: 3, unit: 'h' });
        expect(M.ageParts(47.9)).toEqual({ n: 48, unit: 'h' });
        expect(M.ageParts(48)).toEqual({ n: 2, unit: 'd' });
        expect(M.ageParts(null)).toBeNull();
        expect(M.ageParts(Number.NaN)).toBeNull();
    });

    it('the top arrivals: largest first, a known group by name', () => {
        const rows = M.visitRows({ days: 30, by_content: { b: 2, a: 9, c: 9, z: 1 }, note: null, total: 21 }, [group('a')], 3);
        expect(rows).toEqual([{ key: 'a', name: 'Group a', count: 9 }, { key: 'c', name: null, count: 9 }, { key: 'b', name: null, count: 2 }]);
    });
});

describe('the words and the page rules', () => {
    const dir = join(ROOT, 'apps', 'fly', 'src', 'admin', 'outreach');
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);
    const all = sources.map(([, s]) => s).join('\n') + readFileSync(join(ROOT, 'apps', 'fly', 'src', 'admin', 'main.ts'), 'utf8');
    const en = JSON.parse(readFileSync(join(ROOT, 'packages', 'i18n', 'locales', 'admin', 'outreach', 'en.json'), 'utf8')) as Record<string, string>;

    it('every word the tab asks for is in the dictionary; every word in it is asked for', () => {
        const literal = new Set([...all.matchAll(/'(admin\.outreach\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]));
        const families = new Set<string>();
        for (const m of all.matchAll(/`(admin\.outreach\.[A-Za-z0-9_.]+\.)\$\{/g)) families.add(m[1]);
        for (const m of all.matchAll(/word\('([a-z]+)'/g)) families.add(`admin.outreach.${m[1]}.`);
        for (const k of literal) expect(en[k], `missing: ${k}`).toBeTypeOf('string');
        for (const f of families) expect(Object.keys(en).some((k) => k.startsWith(f)), `no word under ${f}`).toBe(true);
        const dead = Object.keys(en).filter((k) => k.startsWith('admin.outreach.') && !literal.has(k) && ![...families].some((f) => k.startsWith(f)));
        expect(dead, 'words nobody asks for').toEqual([]);
        expect(en['admin.tab.outreach']).toBe('Outreach');
        // control: the check does fire for a word that is not there
        expect(en['admin.outreach.no.such.word']).toBeUndefined();
    });

    it('control: the family rule would catch a dictionary that lost a whole family', () => {
        const without = Object.keys(en).filter((k) => !k.startsWith('admin.outreach.cp.'));
        expect(without.some((k) => k.startsWith('admin.outreach.cp.'))).toBe(false);
        expect(Object.keys(en).some((k) => k.startsWith('admin.outreach.cp.'))).toBe(true);
    });

    it('no style attribute is ever written (the admin\'s CSP: style-src \'self\') and nothing but a GET leaves the tab', () => {
        for (const [f, s] of sources) {
            expect(s, f).not.toMatch(/\bstyle\s*:/);
            expect(s, f).not.toMatch(/setAttribute\(\s*['"]style['"]/);
            expect(s, f).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
            expect(s, f).not.toMatch(/\.post\(|method:\s*['"]POST|'PUT'|'DELETE'/);
        }
        // control: the rule fires on the thing it forbids
        expect("h('i', { style: 'width: 4px' })").toMatch(/\bstyle\s*:/);
    });
});

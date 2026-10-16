// The admin's Outreach tab (owner's request 2026-10-16): how the simulator's posts in Facebook groups are
// doing, so that the owner and the agents can see which groups and which kinds of post are worth more work.
// It is a read-only window on the vault's records: an agent pushes one snapshot to the server
// (outreach_cli.py push -), the server works out the score, the totals, the funnel, the medians and the
// measurements that are due, and this tab draws them: the groups and the posts as tables (sort, filter,
// search, CSV), the funnel, the ranking, the slices by format / language / topic, and what to do next. Nothing
// here is edited and nothing is sent back; Refresh reads again. Empty until the first push.
import { h, clear } from '../../ui/dom';
import { t } from '../i18n';
import type { AdminClient } from '../api';
import { OutreachClient, csvPath } from './api';
import type { OutreachAnswer } from './api';
import { dateTime, age } from './fmt';
import { emptyCard, funnelCard, nextCard, rankingCard, summaryCards, SlicesCard, visitsCard } from './sections';
import { GroupsSection, PostsSection } from './tables';

export class OutreachTab {
    readonly root: HTMLElement;
    private readonly client: OutreachClient;
    private readonly head = h('section', { class: 'card o-head', 'data-testid': 'o-head' });
    private readonly content = h('div', { class: 'o-content' });
    private readonly groups = new GroupsSection();
    private readonly posts = new PostsSection();
    private readonly slices = new SlicesCard();
    private busy = false;

    constructor(api: AdminClient, private readonly say: (msg: string, bad?: boolean) => void) {
        this.client = new OutreachClient(api);
        this.root = h('div', { class: 'tab-body outreach', 'data-testid': 'outreach' }, this.head, this.content);
    }

    /** Nothing waits to be saved here: the tab never writes. */
    async flush(): Promise<void> {}

    async load(): Promise<void> {
        this.render(await this.client.view());
    }

    private async reload(button: HTMLButtonElement): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        button.disabled = true;
        this.say('');
        try {
            await this.load();
        } catch (e) {
            this.say(t('admin.outreach.error', { why: e instanceof Error ? e.message : String(e) }), true);
        } finally {
            this.busy = false;
            button.disabled = false;
        }
    }

    private render(a: OutreachAnswer): void {
        clear(this.head);
        clear(this.content);
        const refresh = h('button', { type: 'button', class: 'btn small', 'data-action': 'refresh' }, t('admin.outreach.refresh')) as HTMLButtonElement;
        refresh.addEventListener('click', () => void this.reload(refresh));
        const title = h('h2', {}, t('admin.outreach.title'));
        if (a.empty) {
            this.head.append(title, h('p', { class: 'muted' }, t('admin.outreach.help')), h('div', { class: 'bar' }, refresh));
            this.content.append(emptyCard(a.unreadable));
            return;
        }
        const csv = (table: 'groups' | 'posts') => h('a', { class: 'btn small', href: csvPath(table), download: `outreach-${a.campaign}-${table}.csv`, 'data-action': `csv-${table}` }, t(`admin.outreach.csv.${table}`));
        this.head.append(
            h('div', { class: 'o-head-text' }, title, h('p', { class: 'muted', 'data-testid': 'o-stamp' },
                t('admin.outreach.stamp', { campaign: a.campaign, generated: dateTime(a.generated), received: dateTime(a.received), age: age(a.age_h) })),
            a.stale ? h('p', { class: 'warn', 'data-testid': 'o-stale', role: 'status' }, t('admin.outreach.stale')) : null),
            h('div', { class: 'bar' }, csv('groups'), csv('posts'), refresh));
        this.groups.update(a);
        this.posts.update(a);
        this.slices.update(a);
        this.content.append(summaryCards(a), h('div', { class: 'o-grid' }, funnelCard(a), rankingCard(a)), nextCard(a), this.groups.root, this.posts.root, this.slices.root, visitsCard(a));
    }
}

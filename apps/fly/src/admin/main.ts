// The owner's admin page, /admin/ (static; every byte of data comes from /api/admin/*, behind his
// password, see apps/api/admin.py). Sign in, then two tabs: Scenes (the picker's catalogue: order,
// Featured, hidden, collections, publish and undo) and Reports (pilots' bugs and ideas).
import { h, clear } from '../ui/dom';
import { t } from './i18n';
import { AdminClient } from './api';
import { ScenesTab } from './scenes-tab';
import { ReportsTab } from './reports-tab';

const root = document.getElementById('admin')!;
const api = new AdminClient();
const note = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
let current: ScenesTab | ReportsTab | null = null;
document.title = t('admin.title');

function say(msg: string, bad = false): void {
    note.textContent = msg;
    note.className = `note${bad ? ' bad' : ''}`;
}

function login(message = '', disabled = false): void {
    current = null;
    clear(root);
    const pw = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, 'data-testid': 'password', disabled }) as HTMLInputElement;
    const go = h('button', { type: 'submit', class: 'btn primary', disabled }, t('admin.login.go'));
    const err = h('p', { class: 'bad', role: 'alert' }, message);
    const form = h('form', { class: 'login card' }, h('h1', {}, t('admin.title')), h('label', { class: 'field' }, h('span', {}, t('admin.login.password')), pw), go, err);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        go.disabled = true;
        const r = await api.login(pw.value);
        pw.value = '';
        go.disabled = false;
        if (r.ok) return shell();
        err.textContent = r.why === 'locked' ? t('admin.login.locked', { min: Math.max(1, Math.ceil((r.retryAfter ?? 60) / 60)) })
            : r.why === 'disabled' ? t('admin.login.disabled') : r.why === 'password' ? t('admin.login.wrong') : t('admin.error.network');
        pw.focus();
    });
    root.append(form);
    pw.focus();
}

function shell(): void {
    clear(root);
    const body = h('div', {});
    const tabs = h('nav', { class: 'tabs', role: 'tablist' });
    const open = async (which: 'scenes' | 'reports'): Promise<void> => {
        for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tab === which));
        await current?.flush();
        const tab = which === 'scenes' ? new ScenesTab(api, say) : new ReportsTab(api, say);
        current = tab;
        clear(body);
        body.append(tab.root);
        say('');
        try {
            await tab.load();
        } catch (e) {
            say(e instanceof Error ? e.message : String(e), true);
        }
    };
    for (const k of ['scenes', 'reports'] as const) {
        tabs.append(h('button', { type: 'button', role: 'tab', class: 'tab', 'data-tab': k, onclick: () => void open(k) }, t(`admin.tab.${k}`)));
    }
    const out = h('button', { type: 'button', class: 'btn', 'data-action': 'logout', onclick: async () => { await current?.flush(); await api.logout().catch(() => undefined); login(); } }, t('admin.logout'));
    root.append(h('header', { class: 'top' }, h('h1', {}, t('admin.title')), tabs, out), note, body);
    void open('scenes');
}

api.onLoggedOut = () => login(t('admin.error.session'));
void api.resume().then((s) => (s === true ? shell() : login(s === 'disabled' ? t('admin.login.disabled') : '', s === 'disabled')));

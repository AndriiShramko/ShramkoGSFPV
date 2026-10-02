// Feedback from the flight (W5): a bug, an idea or cooperation, from the top bar's Feedback button,
// the pause menu and B. A bug or an idea goes to POST /api/report (the owner gets a Telegram note with
// the report's id); a bug carries the technical details of app/diagnostics.ts only when the pilot ticks
// the box that lists them. Cooperation is the landing's contact form (apps/site LeadForm): the same
// fields, the same words (the site dictionary's contact.form) and the same POST /api/lead.
import { contact as enContact } from '@gsfpv/i18n/site/en.json';
import { contact as esContact } from '@gsfpv/i18n/site/es.json';
import { contact as plContact } from '@gsfpv/i18n/site/pl.json';
import { contact as ruContact } from '@gsfpv/i18n/site/ru.json';
import { dialogOpen } from '../../devices/keyboard';
import { h, clear, panel } from '../../ui/dom';
import { t, locale } from '../../i18n';
import { DIAG_ITEMS, collectDiagnostics, releaseId } from '../diagnostics';
import type { Feature, FlightContext } from '../context';
import './feedback.css';

export type FeedbackKind = 'bug' | 'idea' | 'coop';
const KINDS: readonly FeedbackKind[] = ['bug', 'idea', 'coop'];
/** the API's time-to-submit (apps/api/server.py, as for /api/lead): a send sooner waits, it never fails */
const MIN_MS = 3000;
const MESSAGE_MAX = 2000;
const CONTACT_MAX = 200;
/** the landing's LeadForm: its roles (takedown is the scene credit's own link) and its message limit */
const LEAD_ROLES = ['pilot', 'vendor', 'studio', 'investor', 'developer'] as const;
const LEAD_MESSAGE_MAX = 500;
const LEAD = { en: enContact, es: esContact, pl: plContact, ru: ruContact }[locale].form;

const emailOk = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** JSON to the API; a big body (a bug with its flight log) gzipped where the browser can (the API takes both). */
async function post(url: string, body: object): Promise<Response> {
    const text = JSON.stringify(body);
    if (text.length > 8192 && typeof CompressionStream !== 'undefined') {
        const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
        return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: gz });
    }
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
}

function check(id: string, label: string, extra: Record<string, string | boolean> = {}): { row: HTMLLabelElement; box: HTMLInputElement } {
    const box = h('input', { type: 'checkbox', id, 'data-testid': id, ...extra }) as HTMLInputElement;
    return { row: h('label', { class: 'fb-check', for: id }, box, h('span', {}, label)), box };
}

export function openFeedback(ctx: FlightContext, first: FeedbackKind = 'bug'): void {
    if (document.querySelector('.panel.feedback')) return;
    ctx.pause('panel');
    const openedAt = performance.now();
    const wait = async (): Promise<number> => {
        for (let left = MIN_MS - (performance.now() - openedAt); left > 0; left = MIN_MS - (performance.now() - openedAt)) await sleep(Math.ceil(left) + 1);
        return Math.round(performance.now() - openedAt);
    };
    const p = panel(t('fb.title'), () => { p.close(); ctx.resume('panel'); });
    p.root.classList.add('feedback');
    p.root.dataset.testid = 'feedback';
    // the honeypot: people never see or fill it
    const hp = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' }) as HTMLInputElement;
    // what the pilot wrote stays when they switch between Bug and Idea
    const draft = { message: '', contact: '' };
    const body = h('div', { class: 'fb-body' });
    const tabs = h('div', { class: 'fb-kinds', role: 'radiogroup', 'aria-label': t('fb.kind.label') });
    const status = (): HTMLParagraphElement => h('p', { class: 'fb-status', role: 'status', 'aria-live': 'polite', 'data-testid': 'fb-status' });

    const done = (title: string, text: string, id?: string): void => {
        clear(body);
        tabs.hidden = true;
        const back = h('button', { type: 'button', class: 'btn primary', 'data-action': 'feedback-close', onclick: () => { p.close(); ctx.resume('panel'); } }, t('fb.done.close'));
        body.append(h('div', { class: 'fb-done', role: 'status', 'data-testid': 'fb-done' }, h('p', { class: 'fb-done-title' }, title),
            h('p', {}, text), id ? h('p', { class: 'fb-id' }, h('code', { 'data-testid': 'fb-done-id' }, id)) : null), back);
        back.focus();
    };

    const reportForm = (kind: 'bug' | 'idea'): HTMLElement => {
        const msg = h('textarea', { id: 'fb-message', class: 'fb-text', rows: 5, maxlength: MESSAGE_MAX, placeholder: t(`fb.${kind}.placeholder`), 'data-testid': 'fb-message' }) as HTMLTextAreaElement;
        msg.value = draft.message;
        msg.addEventListener('input', () => { draft.message = msg.value; });
        const contact = h('input', { id: 'fb-contact', type: 'text', class: 'fb-field', maxlength: CONTACT_MAX, autocomplete: 'email', placeholder: t('fb.contact.placeholder'), 'data-testid': 'fb-contact' }) as HTMLInputElement;
        contact.value = draft.contact;
        contact.addEventListener('input', () => { draft.contact = contact.value; });
        const form = h('form', { class: 'fb-form', novalidate: true },
            h('label', { class: 'fb-label', for: 'fb-message' }, t(`fb.${kind}.message`)), msg,
            h('label', { class: 'fb-label', for: 'fb-contact' }, t('fb.contact.label')), contact);
        let consent: HTMLInputElement | null = null;
        let picture: HTMLInputElement | null = null;
        if (kind === 'bug') {
            const c = check('fb-consent', t('fb.diag.consent'), { 'aria-describedby': 'fb-diag-what' });
            const pic = check('fb-picture', t('fb.diag.picture'), { disabled: true });
            consent = c.box;
            picture = pic.box;
            c.box.addEventListener('change', () => {
                pic.box.disabled = !c.box.checked;
                if (!c.box.checked) pic.box.checked = false;
            });
            form.append(c.row, h('div', { class: 'fb-diag', id: 'fb-diag-what' },
                h('p', {}, t('fb.diag.what')),
                h('ul', { 'data-testid': 'fb-diag-list' }, ...DIAG_ITEMS.map((i) => h('li', {}, t(`fb.diag.${i}`)))),
                pic.row,
                h('p', { class: 'muted small' }, t('fb.diag.none'))));
        }
        const out = status();
        const send = h('button', { type: 'submit', class: 'btn primary', 'data-action': 'feedback-send' }, t('fb.send'));
        form.append(send, out);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            void (async () => {
                if (!draft.message.trim()) { out.textContent = t('fb.missing'); msg.focus(); return; }
                send.disabled = true;
                send.textContent = t('fb.sending');
                out.textContent = '';
                const withDiag = consent?.checked === true;
                let diagnostics: Record<string, unknown> | undefined;
                if (withDiag) {
                    try { diagnostics = await collectDiagnostics(ctx, picture?.checked === true); } catch (err) { diagnostics = { failed: String(err) }; }
                }
                const ms = await wait();
                try {
                    const r = await post('/api/report', {
                        kind, message: draft.message.trim().slice(0, MESSAGE_MAX), contact: draft.contact.trim().slice(0, CONTACT_MAX),
                        locale, page: 'fly', scene: ctx.scene.id, release: await releaseId(), t: ms, hp: hp.value,
                        diagnosticsConsent: withDiag, ...(diagnostics ? { diagnostics } : {})
                    });
                    const j = (await r.json()) as { ok?: boolean; id?: string };
                    if (!r.ok || !j.ok || !j.id) throw new Error(`report ${r.status}`);
                    draft.message = '';
                    done(t('fb.done.title'), t('fb.done.id', { id: j.id }), j.id);
                } catch {
                    out.textContent = t('fb.error');
                    send.disabled = false;
                    send.textContent = t('fb.send');
                }
            })();
        });
        return form;
    };

    // the landing's contact form, field for field (apps/site/src/components/LeadForm.tsx)
    const coopForm = (): HTMLElement => {
        const f = LEAD;
        let role = '';
        const chips = h('div', { class: 'fb-roles' }, ...LEAD_ROLES.map((r) => {
            const radio = h('input', { type: 'radio', name: 'fb-role', value: r, id: `fb-role-${r}`, class: 'fb-radio', onchange: () => { role = r; ready(); } });
            return h('label', { class: 'fb-chip', for: `fb-role-${r}` }, radio, h('span', {}, f.role[r]));
        }));
        const msg = h('textarea', { id: 'fb-lead-message', class: 'fb-text', rows: 3, maxlength: LEAD_MESSAGE_MAX, placeholder: f.message.placeholder }) as HTMLTextAreaElement;
        const email = h('input', { id: 'fb-lead-email', type: 'email', class: 'fb-field', inputmode: 'email', autocomplete: 'email', required: true, placeholder: f.email.placeholder }) as HTMLInputElement;
        const c = check('fb-lead-consent', '');
        c.row.lastElementChild?.append(f.consent.text, ' ', h('a', { href: `/${locale}/privacy/`, target: '_blank', rel: 'noopener' }, f.consent.link), '.');
        const out = status();
        const send = h('button', { type: 'submit', class: 'btn primary', 'data-action': 'feedback-lead-send' }, f.submit);
        const list = new Intl.ListFormat(locale, { type: 'conjunction' });
        const missing = (): string[] => [...(role ? [] : [f.missing.role]), ...(emailOk(email.value) ? [] : [f.missing.email]), ...(c.box.checked ? [] : [f.missing.consent])];
        const ready = (): void => {
            const m = missing();
            send.disabled = m.length > 0;
            out.textContent = m.length ? `${f.missing.prefix} ${list.format(m)}.` : f.ready;
        };
        email.addEventListener('input', ready);
        c.box.addEventListener('change', ready);
        const form = h('form', { class: 'fb-form', novalidate: true },
            h('p', { class: 'fb-label' }, f.role.label), chips,
            h('label', { class: 'fb-label', for: 'fb-lead-message' }, f.message.label, ' ', h('span', { class: 'muted' }, f.message.optional)), msg,
            h('label', { class: 'fb-label', for: 'fb-lead-email' }, f.email.label), email, c.row, send, out);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (missing().length) return;
            void (async () => {
                send.disabled = true;
                send.textContent = f.sending;
                const ms = await wait();
                try {
                    const r = await post('/api/lead', { role, message: msg.value.trim().slice(0, LEAD_MESSAGE_MAX), email: email.value.trim(), locale, consent: true, t: ms, hp: hp.value, scene: ctx.scene.id });
                    if (!r.ok) throw new Error(`lead ${r.status}`);
                    done(f.done.title, f.done.text);
                } catch {
                    out.textContent = f.error;
                    send.disabled = false;
                    send.textContent = f.submit;
                }
            })();
        });
        ready();
        return form;
    };

    const tabButtons = KINDS.map((k) => h('button', { type: 'button', role: 'radio', class: 'fb-kind', 'data-kind': k, 'data-testid': `fb-kind-${k}`, onclick: () => show(k) }, t(`fb.kind.${k}`)));
    const show = (k: FeedbackKind): void => {
        tabButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === k)));
        clear(body);
        body.append(k === 'coop' ? coopForm() : reportForm(k));
    };
    tabs.append(...tabButtons);
    // arrows move between the three choices, like a radio group
    tabs.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const at = tabButtons.indexOf(document.activeElement as HTMLButtonElement);
        const next = tabButtons[(Math.max(0, at) + (e.key === 'ArrowRight' ? 1 : KINDS.length - 1)) % KINDS.length];
        next.focus();
        next.click();
        e.preventDefault();
    });
    p.body.append(h('p', { class: 'muted' }, t('fb.lead')), tabs, body, h('div', { class: 'fb-hp', 'aria-hidden': 'true' }, h('label', {}, 'Website', hp)));
    ctx.ui.append(p.root);
    show(first);
    tabButtons[KINDS.indexOf(first)].focus();
}

export const feedback: Feature = {
    id: 'feedback',
    install(ctx) {
        ctx.menu.add({ id: 'pause.feedback', action: 'feedback.open', labelKey: 'fb.menu', order: 110, section: 'tools', run: () => openFeedback(ctx) });
        // B over the flight; with the pause menu up the menu's item takes it (app/menu.ts)
        ctx.keys.on('feedback.open', () => { if (!dialogOpen()) openFeedback(ctx); });
    }
};

// Feedback from the flight (W5): a bug, an idea or cooperation, from the top bar's Feedback button,
// the pause menu and B. A bug or an idea goes to POST /api/report (the whole report reaches the owner's
// Telegram; he answers the e-mail left here from his Gmail, apps/api/ownerbot.py); a bug carries the
// technical details of app/diagnostics.ts only when the pilot ticks the box that lists them.
// Cooperation is the landing's contact form (apps/site LeadForm): the same
// fields, the same words (the site dictionary's contact.form) and the same POST /api/lead.
// Drone physics (v0.8, docs/wip/v08-d.md): a pilot who flies one of the presets for real tells what
// feels different and sends what fits the drone to the real one: the Betaflight `diff all` as text, a
// link to a blackbox log, and (ticked by default, counted on the box) their simulator settings for that
// drone with the flight mode and the input; or asks for a drone that is missing. POST /api/report kind
// 'drone' (apps/api/server.py parse_drone_tune); the body and the form's line that says what is sent come
// from drone-report.ts. Ways in: the drone picker's buttons, the settings screen's row under Drone, this
// dialog's tab, and the landing's links /{lang}/fly/?drone=<id>&open=tune.
import { contact as enContact } from '@gsfpv/i18n/site/en.json';
import { contact as esContact } from '@gsfpv/i18n/site/es.json';
import { contact as plContact } from '@gsfpv/i18n/site/pl.json';
import { contact as ruContact } from '@gsfpv/i18n/site/ru.json';
import { dialogOpen } from '../../devices/keyboard';
import { h, clear, panel } from '../../ui/dom';
import { t, locale } from '../../i18n';
import { PRESETS } from '../../presets';
import { q } from '../env';
import { DIAG_ITEMS, collectDiagnostics, releaseId } from '../diagnostics';
import { BETAFLIGHT_MAX, DRONE_NEW, DRONE_REPORT_ITEMS, LOG_URL_MAX, LOG_URL_RE, droneReportBody } from './drone-report';
import type { DroneSettings } from './drone-report';
import type { Feature, FlightContext } from '../context';
import './feedback.css';

export type FeedbackKind = 'bug' | 'idea' | 'drone' | 'coop';
const KINDS: readonly FeedbackKind[] = ['bug', 'idea', 'drone', 'coop'];
/** the API's time-to-submit (apps/api/server.py, as for /api/lead): a send sooner waits, it never fails */
const MIN_MS = 3000;
const MESSAGE_MAX = 2000;
const CONTACT_MAX = 200;
/** What a drone-physics report carries of the simulator: the pilot's settings for that drone, the flight mode and the input. */
function droneSettings(ctx: FlightContext, drone: string): DroneSettings {
    const changed: Record<string, unknown> = {};
    for (const e of ctx.prefs.explicitList({ drone })) if (e.scope === 'drone') changed[e.id] = e.value;
    return { changed, flightMode: ctx.prefs.get('flight.mode'), input: ctx.controls.source };
}

/** How many settings the pilot changed for `drone` (the count on the settings box). */
function changedCount(ctx: FlightContext, drone: string): number {
    return ctx.prefs.explicitList({ drone }).filter((e) => e.scope === 'drone').length;
}
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

/**
 * The feedback dialog over the paused flight, open on `first`. `o.drone`: the drone the Drone physics
 * kind starts on (a preset id or DRONE_NEW; default the drone flown). `o.onClose`: called once the dialog
 * is gone (the deep link's caller cleans the address bar).
 */
export function openFeedback(ctx: FlightContext, first: FeedbackKind = 'bug', o: { drone?: string; onClose?: () => void } = {}): void {
    if (document.querySelector('.panel.feedback')) return;
    ctx.pause('panel');
    const openedAt = performance.now();
    const wait = async (): Promise<number> => {
        for (let left = MIN_MS - (performance.now() - openedAt); left > 0; left = MIN_MS - (performance.now() - openedAt)) await sleep(Math.ceil(left) + 1);
        return Math.round(performance.now() - openedAt);
    };
    const leave = (): void => { p.close(); ctx.resume('panel'); o.onClose?.(); };
    const p = panel(t('fb.title'), leave);
    p.root.classList.add('feedback');
    p.root.dataset.testid = 'feedback';
    // the honeypot: people never see or fill it
    const hp = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' }) as HTMLInputElement;
    // what the pilot wrote stays when they switch between the kinds
    const startDrone = o.drone === DRONE_NEW || (o.drone && Object.hasOwn(PRESETS, o.drone)) ? o.drone : ctx.session.presetId;
    const draft = { message: '', contact: '', drone: startDrone, betaflight: '', logUrl: '', settings: true };
    const body = h('div', { class: 'fb-body' });
    const tabs = h('div', { class: 'fb-kinds', role: 'radiogroup', 'aria-label': t('fb.kind.label') });
    const status = (): HTMLParagraphElement => h('p', { class: 'fb-status', role: 'status', 'aria-live': 'polite', 'data-testid': 'fb-status' });

    const done = (title: string, text: string, id?: string): void => {
        clear(body);
        tabs.hidden = true;
        const back = h('button', { type: 'button', class: 'btn primary', 'data-action': 'feedback-close', onclick: leave }, t('fb.done.close'));
        body.append(h('div', { class: 'fb-done', role: 'status', 'data-testid': 'fb-done' }, h('p', { class: 'fb-done-title' }, title),
            h('p', {}, text), id ? h('p', { class: 'fb-id' }, h('code', { 'data-testid': 'fb-done-id' }, id)) : null), back);
        back.focus();
    };

    const reportForm = (kind: 'bug' | 'idea'): HTMLElement => {
        const msg = h('textarea', { id: 'fb-message', class: 'fb-text', rows: 5, maxlength: MESSAGE_MAX, placeholder: t(`fb.${kind}.placeholder`), 'data-testid': 'fb-message' }) as HTMLTextAreaElement;
        msg.value = draft.message;
        msg.addEventListener('input', () => { draft.message = msg.value; });
        // the owner answers from his Gmail (v0.7): an e-mail here is what makes an answer possible
        const contact = h('input', { id: 'fb-contact', type: 'text', class: 'fb-field', maxlength: CONTACT_MAX, autocomplete: 'email', inputmode: 'email',
            placeholder: t('fb.contact.placeholder'), 'aria-describedby': 'fb-contact-hint', 'data-testid': 'fb-contact' }) as HTMLInputElement;
        contact.value = draft.contact;
        contact.addEventListener('input', () => { draft.contact = contact.value; });
        const form = h('form', { class: 'fb-form', novalidate: true },
            h('label', { class: 'fb-label', for: 'fb-message' }, t(`fb.${kind}.message`)), msg,
            h('label', { class: 'fb-label', for: 'fb-contact' }, t('fb.contact.label')), contact,
            h('p', { class: 'fb-hint', id: 'fb-contact-hint', 'data-testid': 'fb-contact-hint' }, t('fb.contact.hint')));
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

    // Drone physics: which drone, what feels different (or which drone to add), the Betaflight text, the log's link
    const droneForm = (): HTMLElement => {
        const sel = h('select', { id: 'fb-drone', class: 'fb-field', 'data-testid': 'fb-drone' },
            ...Object.entries(PRESETS).map(([id, pr]) => h('option', { value: id }, pr.name)),
            h('option', { value: DRONE_NEW }, t('fb.drone.new'))) as HTMLSelectElement;
        sel.value = draft.drone;
        const msg = h('textarea', { id: 'fb-message', class: 'fb-text', rows: 4, maxlength: MESSAGE_MAX, placeholder: t('fb.drone.placeholder'), 'data-testid': 'fb-message' }) as HTMLTextAreaElement;
        msg.value = draft.message;
        msg.addEventListener('input', () => { draft.message = msg.value; });
        const diff = h('textarea', { id: 'fb-betaflight', class: 'fb-text fb-code', rows: 4, maxlength: BETAFLIGHT_MAX, spellcheck: false, autocomplete: 'off',
            placeholder: '# diff all', 'aria-describedby': 'fb-betaflight-hint', 'data-testid': 'fb-betaflight' }) as HTMLTextAreaElement;
        diff.value = draft.betaflight;
        diff.addEventListener('input', () => { draft.betaflight = diff.value; });
        const log = h('input', { id: 'fb-log', type: 'url', class: 'fb-field', maxlength: LOG_URL_MAX, inputmode: 'url', autocomplete: 'off', placeholder: 'https://',
            'aria-describedby': 'fb-log-hint', 'data-testid': 'fb-log' }) as HTMLInputElement;
        log.value = draft.logUrl;
        log.addEventListener('input', () => { draft.logUrl = log.value; });
        const contact = h('input', { id: 'fb-contact', type: 'text', class: 'fb-field', maxlength: CONTACT_MAX, autocomplete: 'email', inputmode: 'email',
            placeholder: t('fb.contact.placeholder'), 'aria-describedby': 'fb-contact-hint', 'data-testid': 'fb-contact' }) as HTMLInputElement;
        contact.value = draft.contact;
        contact.addEventListener('input', () => { draft.contact = contact.value; });
        // the pilot's settings for the chosen drone: ticked by default, the count says how many they changed
        const set = check('fb-settings', '');
        set.box.checked = draft.settings;
        const setText = set.row.lastElementChild as HTMLElement;
        const syncDrone = (): void => {
            draft.drone = sel.value;
            const isNew = sel.value === DRONE_NEW;
            set.box.disabled = isNew;
            setText.textContent = t('fb.drone.settings', { n: isNew ? 0 : changedCount(ctx, sel.value) });
        };
        sel.addEventListener('change', syncDrone);
        set.box.addEventListener('change', () => { draft.settings = set.box.checked; });
        syncDrone();
        const out = status();
        const send = h('button', { type: 'submit', class: 'btn primary', 'data-action': 'feedback-send' }, t('fb.send'));
        const list = new Intl.ListFormat(locale, { type: 'conjunction' });
        const sends = (withBox: boolean): string => list.format(DRONE_REPORT_ITEMS.filter((i) => i.withBox === withBox).map((i) => t(`fb.drone.sends.${i.item}`)));
        const form = h('form', { class: 'fb-form', novalidate: true, 'data-testid': 'fb-drone-form' },
            h('p', { class: 'fb-hint' }, t('fb.drone.lead')),
            h('label', { class: 'fb-label', for: 'fb-drone' }, t('fb.drone.which')), sel,
            h('label', { class: 'fb-label', for: 'fb-message' }, t('fb.drone.message')), msg,
            h('label', { class: 'fb-label', for: 'fb-betaflight' }, t('fb.drone.diff')), diff,
            h('p', { class: 'fb-hint', id: 'fb-betaflight-hint' }, t('fb.drone.diff.hint')),
            h('label', { class: 'fb-label', for: 'fb-log' }, t('fb.drone.log')), log,
            h('p', { class: 'fb-hint', id: 'fb-log-hint' }, t('fb.drone.log.hint')),
            set.row,
            h('label', { class: 'fb-label', for: 'fb-contact' }, t('fb.contact.label')), contact,
            h('p', { class: 'fb-hint', id: 'fb-contact-hint' }, t('fb.contact.hint')),
            // what is sent, built from the fields the body carries (drone-report.ts: a field without a phrase fails its test)
            h('p', { class: 'muted small', 'data-testid': 'fb-drone-sent' }, t('fb.drone.sent', { list: sends(false) }), ' ', t('fb.drone.sentBox', { list: sends(true) })),
            send, out);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            void (async () => {
                if (!draft.message.trim()) { out.textContent = t('fb.missing'); msg.focus(); return; }
                const url = draft.logUrl.trim();
                if (url && !LOG_URL_RE.test(url)) { out.textContent = t('fb.drone.log.bad'); log.focus(); return; }
                send.disabled = true;
                send.textContent = t('fb.sending');
                out.textContent = '';
                const drone = sel.value;
                const ms = await wait();
                try {
                    const r = await post('/api/report', droneReportBody({
                        message: draft.message.trim().slice(0, MESSAGE_MAX), contact: draft.contact.trim().slice(0, CONTACT_MAX),
                        locale, scene: ctx.scene.id, release: await releaseId(), t: ms, hp: hp.value,
                        drone, logUrl: url, betaflight: draft.betaflight.trim().slice(0, BETAFLIGHT_MAX),
                        settings: draft.settings && drone !== DRONE_NEW ? droneSettings(ctx, drone) : undefined
                    }));
                    const j = (await r.json()) as { ok?: boolean; id?: string };
                    if (!r.ok || !j.ok || !j.id) throw new Error(`report ${r.status}`);
                    draft.message = '';
                    draft.betaflight = '';
                    draft.logUrl = '';
                    done(t('fb.done.title'), t('fb.drone.done', { id: j.id }), j.id);
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
        body.append(k === 'coop' ? coopForm() : k === 'drone' ? droneForm() : reportForm(k));
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
        // the landing's "Help tune it" (/{lang}/fly/?drone=<id>&open=tune): the Drone physics form, once
        if (q.get('open') === 'tune') openFeedback(ctx, 'drone', { drone: q.get('drone') ?? undefined, onClose: forgetTuneLink });
    }
};

/** The deep link opens the form once: closing it takes ?open=tune out of the address bar (a reload flies on). */
function forgetTuneLink(): void {
    try {
        const u = new URL(location.href);
        if (u.searchParams.get('open') !== 'tune') return;
        u.searchParams.delete('open');
        history.replaceState(history.state, '', u);
    } catch {
        /* no history */
    }
}

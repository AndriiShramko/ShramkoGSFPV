// Train 1, lane rooms: the panel "Fly with others" (pause menu, Shift+L; rooms-plan.md 2.3, 2.7): the pilot's name, create a
// room on the scan flown (name, listed or not), the room's link with Copy, the pilots in the room, Leave, and the open rooms
// as a real table with a Join button per row, refreshed every 10 s while the panel is open. Plain buttons, fields and a
// table: reachable with Tab and read by a screen reader.
import { h, panel } from '../ui/dom';
import { t } from '../i18n';
import type { RoomInfo } from './api';

/** The open rooms list is fetched again this often while the panel is open (rooms-plan.md 2.3). */
export const LIST_REFRESH_MS = 10_000;

export interface PanelModel {
    nick: string;
    /** the room flown now; null outside a room */
    room: { name: string; link: string; cap: number; members: readonly { slot: number; nick: string; you: boolean }[] } | null;
    saveNick(v: string): string | null;
    /** creates and joins; the reason text when it did not happen */
    create(name: string, listed: boolean): Promise<string | null>;
    join(id: string): void;
    leave(): void;
    list(): Promise<RoomInfo[] | null>;
}

export function roomsPanel(parent: HTMLElement, m: PanelModel, onClose: () => void): { close: () => void } {
    let timer: ReturnType<typeof setInterval> | null = null;
    const close = (): void => {
        if (timer !== null) clearInterval(timer);
        timer = null;
        p.close();
        onClose();
    };
    const p = panel(t('rooms.title'), close);
    p.root.setAttribute('data-testid', 'rooms-panel');

    // the name, asked once and kept
    const nickIn = h('input', { type: 'text', id: 'rooms-nick', value: m.nick, maxlength: 20, autocomplete: 'nickname', 'data-testid': 'rooms-nick' });
    const nickNote = h('p', { class: 'muted small', role: 'status' }, t('rooms.nick.help'));
    const nickSave = h('button', { type: 'button', class: 'btn', 'data-action': 'rooms-nick-save', onclick: () => {
        const ok = m.saveNick(nickIn.value);
        nickNote.textContent = ok === null ? t('rooms.nick.bad') : t('rooms.nick.saved', { nick: ok });
        if (ok !== null) nickIn.value = ok;
    } }, t('rooms.nick.save'));
    p.body.append(h('div', { class: 'rooms-nick' }, h('label', { for: 'rooms-nick' }, t('rooms.nick.label')), ' ', nickIn, ' ', nickSave), nickNote);

    if (m.room) {
        const r = m.room;
        const link = h('input', { type: 'text', readonly: true, value: r.link, id: 'rooms-link', 'data-testid': 'rooms-link' });
        const copied = h('span', { class: 'muted small', role: 'status' });
        const copy = h('button', { type: 'button', class: 'btn primary', 'data-action': 'rooms-copy', onclick: async () => {
            try {
                await navigator.clipboard.writeText(r.link);
                copied.textContent = t('rooms.link.copied');
            } catch {
                // the browser refused: the field is selected to copy by hand
                link.focus();
                link.select();
            }
        } }, t('rooms.link.copy'));
        const ul = h('ul', { class: 'rooms-members', 'data-testid': 'rooms-members' });
        for (const x of r.members) ul.append(h('li', {}, x.you ? t('rooms.members.you', { nick: x.nick }) : x.nick));
        p.body.append(
            h('h3', {}, r.name),
            h('label', { for: 'rooms-link' }, t('rooms.link.label')), ' ', link, ' ', copy, ' ', copied,
            h('h3', {}, t('rooms.members.title', { n: r.members.length, cap: r.cap })), ul,
            h('button', { type: 'button', class: 'btn', 'data-action': 'rooms-leave', onclick: () => { close(); m.leave(); } }, t('rooms.leave'))
        );
    } else {
        const nameIn = h('input', { type: 'text', id: 'rooms-name', maxlength: 40, 'data-testid': 'rooms-name', placeholder: t('rooms.create.namePlaceholder', { nick: m.nick }) });
        const listedIn = h('input', { type: 'checkbox', id: 'rooms-listed', checked: true });
        const why = h('p', { class: 'muted small', role: 'status' });
        const create = h('button', { type: 'button', class: 'btn primary', 'data-action': 'rooms-create', onclick: async () => {
            create.disabled = true;
            const name = nameIn.value.trim() || t('rooms.create.namePlaceholder', { nick: m.nick });
            const err = await m.create(name, listedIn.checked);
            create.disabled = false;
            if (err === null) close();
            else why.textContent = t('rooms.create.failed', { why: err });
        } }, t('rooms.create.button'));
        p.body.append(
            h('h3', {}, t('rooms.create.title')),
            h('div', {}, h('label', { for: 'rooms-name' }, t('rooms.create.name')), ' ', nameIn),
            h('div', {}, listedIn, ' ', h('label', { for: 'rooms-listed' }, t('rooms.create.listed'))),
            create, why
        );
    }

    // the open rooms
    const table = h('table', { class: 'rooms-list', 'data-testid': 'rooms-list' });
    const status = h('p', { class: 'muted small', role: 'status' });
    const fill = async (): Promise<void> => {
        const rooms = await m.list();
        if (!p.root.isConnected) return;
        table.textContent = '';
        if (rooms === null) {
            status.textContent = t('rooms.list.failed');
            return;
        }
        status.textContent = rooms.length === 0 ? t('rooms.list.empty') : '';
        table.append(h('caption', { class: 'visually-hidden' }, t('rooms.list.caption')),
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('rooms.list.name')), h('th', { scope: 'col' }, t('rooms.list.scan')),
                h('th', { scope: 'col' }, t('rooms.list.pilots')), h('th', { scope: 'col' }, t('rooms.list.join')))));
        const body = h('tbody', {});
        for (const r of rooms) {
            const full = r.members >= r.cap;
            body.append(h('tr', {}, h('th', { scope: 'row' }, r.name), h('td', {}, r.scene.id), h('td', {}, `${r.members} / ${r.cap}`),
                h('td', {}, h('button', { type: 'button', class: 'btn', 'data-action': 'rooms-join', 'data-room': r.id, disabled: full,
                    'aria-label': t('rooms.list.joinRow', { name: r.name }), onclick: () => { close(); m.join(r.id); } }, t('rooms.list.join')))));
        }
        table.append(body);
    };
    p.body.append(h('h3', {}, t('rooms.list.title')), table, status);
    void fill();
    timer = setInterval(() => void fill(), LIST_REFRESH_MS);
    parent.append(p.root);
    nickIn.focus();
    return { close };
}

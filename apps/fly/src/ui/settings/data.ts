// Settings -> Data (docs/architecture-v03.md A.4, A.5, A.9; owner's items 13 and 20): export the
// settings to a file, import one (a preview of what changes first, then replace or merge), reset
// every setting, erase everything (with a second press), and the storage's state: saved or not,
// kept or not when the disk fills up, with navigator.storage.persist() only on the pilot's click.
import { exportFileName } from '@gsfpv/prefs';
import type { ImportMode, PrefsStore } from '@gsfpv/prefs';
import { askPersistence, eraseEverything, forgetAllLinks, readPersisted, storageStatus } from '../../app/prefs';
import { h } from '../dom';
import { t } from '../../i18n';
import { importSummary } from './model';

export interface DataHost {
    store: PrefsStore;
    /** a short line in the screen's status (read out by screen readers) */
    say(s: string): void;
    /** after Erase everything: the page starts again */
    reload(): void;
}

/** The setting names of an import preview, by id (the screen's texts are not needed for the counts). */
function list(ids: readonly string[]): string {
    return ids.slice(0, 8).join(', ') + (ids.length > 8 ? ` +${ids.length - 8}` : '');
}

export function dataSection(host: DataHost): { el: HTMLElement; refresh(): void } {
    const store = host.store;
    const status = h('div', { class: 'data-status', 'data-testid': 'storage-status' });
    const persistBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'storage-persist' }, t('prefs.storage.persist')) as HTMLButtonElement;
    persistBtn.addEventListener('click', () => { void askPersistence(store).then(() => drawStatus()); });

    const drawStatus = (): void => {
        const s = storageStatus(store);
        const lines: HTMLElement[] = [h('p', { class: s.writable ? 'ok' : 'warn', 'data-writable': String(s.writable) }, t(s.writable ? 'prefs.storage.ok' : 'prefs.storage.blocked'))];
        if (s.writable) {
            lines.push(h('p', { class: 'muted small' }, t('prefs.storage.size', { kb: (s.bytes / 1024).toFixed(1) })));
            lines.push(h('p', { class: 'muted small', 'data-persisted': s.persisted }, t(`prefs.storage.persisted.${s.persisted}`)));
        }
        persistBtn.hidden = !s.writable || s.persisted === 'yes';
        status.replaceChildren(...lines, persistBtn);
    };

    // ---------------------------------------------------------------- export
    const exportBtn = h('button', { type: 'button', class: 'btn primary', 'data-action': 'settings-export' }, t('prefs.export'));
    exportBtn.addEventListener('click', () => {
        store.flush();
        const name = exportFileName(Date.now());
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(store.exportFile(), null, 2)], { type: 'application/json' }));
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        host.say(t('prefs.exported', { file: name }));
    });

    // ---------------------------------------------------------------- import: file, preview, apply
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', tabindex: -1, 'aria-hidden': 'true', 'data-testid': 'settings-import-file' }) as HTMLInputElement;
    const importBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'settings-import', onclick: () => fileInput.click() }, t('prefs.import'));
    const preview = h('div', { class: 'data-preview', hidden: true });
    let pending: { json: unknown; name: string } | null = null;

    const closePreview = (): void => {
        pending = null;
        preview.hidden = true;
        preview.replaceChildren();
        importBtn.focus();
    };

    const showPreview = (mode: ImportMode): void => {
        if (!pending) return;
        const r = store.previewImport(pending.json, mode);
        const s = importSummary(r);
        const title = h('h4', { id: 'data-preview-title', tabindex: -1 }, t('prefs.import.title', { file: pending.name }));
        const body: (HTMLElement | null)[] = [];
        if (!s.ok) body.push(h('p', { class: 'warn', 'data-testid': 'import-error' }, t(`prefs.import.error.${s.error ?? 'corrupt'}`)));
        else if (s.empty) body.push(h('p', {}, t('prefs.import.nothing')));
        else {
            body.push(h('ul', { class: 'data-counts' },
                h('li', { 'data-testid': 'import-settings' }, t('prefs.import.settings', { n: String(s.settings) })),
                h('li', {}, t('prefs.import.radios', { added: String(s.radios.added), changed: String(s.radios.changed) })),
                h('li', {}, t('prefs.import.scenes', { added: String(s.scenes.added), changed: String(s.scenes.changed) })),
                s.other ? h('li', {}, t('prefs.import.other', { n: String(s.other) })) : null));
            if (r.changes.length) {
                body.push(h('ul', { class: 'data-changes', 'data-testid': 'import-changes' }, ...r.changes.slice(0, 40).map((c) => h('li', {},
                    h('code', {}, c.key ? `${c.id} · ${c.key}` : c.id), `: ${fmt(c.from)} → ${fmt(c.to)}`))));
            }
            if (s.clamped.length) body.push(h('p', { class: 'small' }, t('prefs.import.clamped', { list: list(s.clamped) })));
            if (s.dropped.length) body.push(h('p', { class: 'small warn' }, t('prefs.import.dropped', { list: list(s.dropped) })));
            if (s.unknown.length) body.push(h('p', { class: 'small muted' }, t('prefs.import.unknown', { list: list(s.unknown) })));
        }
        const modes = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('prefs.import.mode') },
            ...(['replace', 'merge'] as const).flatMap((m) => {
                const id = `data-mode-${m}`;
                const r2 = h('input', { type: 'radio', name: 'data-mode', id, value: m }) as HTMLInputElement;
                r2.checked = m === mode;
                r2.addEventListener('change', () => { if (r2.checked) showPreview(m); });
                return [r2, h('label', { for: id }, t(`prefs.import.${m}`))];
            }));
        const apply = h('button', { type: 'button', class: 'btn primary', 'data-action': 'settings-import-apply', disabled: !s.ok || s.empty, onclick: () => {
            if (!pending) return;
            const done = store.importFile(pending.json, mode);
            closePreview();
            drawStatus();
            host.say(done.ok ? t('prefs.import.done', { n: String(done.changes.length) }) : t(`prefs.import.error.${done.error ?? 'corrupt'}`));
        } }, t('prefs.import.apply'));
        const cancel = h('button', { type: 'button', class: 'btn', 'data-action': 'settings-import-cancel', onclick: closePreview }, t('common.cancel'));
        const parts: HTMLElement[] = [title, ...body.filter((x): x is HTMLElement => x !== null)];
        if (s.ok && !s.empty) parts.push(modes, h('p', { class: 'muted small' }, t('prefs.import.modeHint')));
        parts.push(h('div', { class: 'data-actions' }, apply, cancel));
        preview.replaceChildren(...parts);
        preview.hidden = false;
        title.focus();
    };

    fileInput.addEventListener('change', () => {
        const f = fileInput.files?.[0];
        fileInput.value = '';
        if (!f) return;
        void f.text().then((text) => {
            let json: unknown;
            try {
                json = JSON.parse(text);
            } catch {
                // not JSON at all: the store's preview would say "corrupt" too, without the file
                pending = null;
                preview.replaceChildren(h('p', { class: 'warn', 'data-testid': 'import-error' }, t('prefs.import.error.corrupt')), h('div', { class: 'data-actions' }, h('button', { type: 'button', class: 'btn', onclick: closePreview }, t('common.close'))));
                preview.hidden = false;
                return;
            }
            pending = { json, name: f.name };
            showPreview('replace');
        });
    });

    // ---------------------------------------------------------------- reset all, erase everything
    const twoStep = (action: string, label: string, question: string, yesLabel: string, run: () => void): HTMLElement => {
        const box = h('div', { class: 'data-row' });
        const draw = (): void => {
            box.replaceChildren(h('button', { type: 'button', class: 'btn', 'data-action': action, onclick: ask }, label));
        };
        const ask = (): void => {
            const yes = h('button', { type: 'button', class: 'btn danger', 'data-action': `${action}-yes`, onclick: () => { run(); draw(); } }, yesLabel);
            box.replaceChildren(h('p', { class: 'small' }, question), yes, h('button', { type: 'button', class: 'btn', onclick: draw }, t('common.cancel')));
            yes.focus();
        };
        draw();
        return box;
    };
    const resetAll = twoStep('settings-reset-all', t('prefs.resetAll'), t('prefs.resetAll.confirm'), t('prefs.confirm.reset'), () => {
        forgetAllLinks(store);
        store.resetAll({ settings: true });
        host.say(t('prefs.resetAll.done'));
    });
    const erase = twoStep('settings-erase', t('prefs.eraseAll'), t('prefs.eraseAll.confirm'), t('prefs.eraseAll'), () => {
        host.say(t('prefs.erased'));
        void eraseEverything(store).then(() => host.reload());
    });

    const el = h('div', { class: 'data', 'data-testid': 'settings-data' },
        h('p', { class: 'muted small' }, t('prefs.data.help')),
        status,
        h('div', { class: 'data-row' }, exportBtn, importBtn, fileInput),
        preview,
        resetAll,
        erase);
    drawStatus();
    void readPersisted(store).then(() => drawStatus());
    return { el, refresh: drawStatus };
}

function fmt(v: unknown): string {
    if (v === undefined || v === null) return '—';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

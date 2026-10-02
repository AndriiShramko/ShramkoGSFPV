// The settings screen (docs/architecture-v03.md A.7-A.9; owner's items 12, 13, 20; defects D-b, D-h),
// generated from the prefs schema: every shipped setting of every group, a group rail (an accordion
// below 600 px), a search over names, help texts and ids, and Data (export, import with a preview,
// reset all, erase everything, the storage's state).
//
// There is no Apply button: every control writes the store at once (pilotSet), so closing with x or
// Esc never loses a change, and the store's onChange puts 'live' settings on screen at once (the
// flight's host does that). 'life' settings wait in the store until the screen closes; the host then
// builds one new flight model. A value is always read back from the store: what the row shows is
// what the app uses.
import { actionsOf, boundsOf, helpKey, isCuratedRef, labelKey } from '@gsfpv/prefs';
import type { ActionId, Ctx, EnumDef, GroupId, KeyHint, NumDef, PrefChange, PrefsStore, SettingDef } from '@gsfpv/prefs';
import { PRESETS } from '../../presets';
import { droneOf, linkSettings, pilotReset, pilotSet, presetResolver } from '../../app/prefs';
import { h } from '../dom';
import { toggletip } from '../toggletip';
import { t } from '../../i18n';
import { jsonEditor } from './editors';
import type { Editor } from './editors';
import { dataSection } from './data';
import { focusTarget, formatNumber, fromSlider, matches, shownDefs, shownGroups, snap, toSlider, unitSymbol } from './model';
import type { DefTexts, RailId } from './model';
import './settings.css';

export interface SettingsHost {
    store: PrefsStore;
    /** the scan flown, for per-scan rows; null at the scene picker */
    scene: { id: string; title?: string } | null;
    /** key-caps of an action (the flight's key router); none at the scene picker */
    caps?(action: ActionId): KeyHint[];
    /** "Import from Betaflight" on the rates row, while a flight is up */
    importBetaflight?(): void;
    /** a 'reload' setting changed (the language) */
    reload(id: string): void;
    /** the screen is gone (x, Esc, O); the host applies what waits for it */
    onClose(): void;
}

/** v0.2's name of a setting whose owner has not written `set.<id>` yet (A.10: reused where the wording holds). */
const LEGACY_LABEL: Readonly<Record<string, string>> = { 'physics.vCrash': 'settings.crash' };

/** t() gives the key back for a text it does not have. */
const has = (k: string): boolean => t(k) !== k;

export const texts: DefTexts = {
    label(def) {
        const k = labelKey(def);
        if (has(k)) return t(k);
        const legacy = LEGACY_LABEL[def.id];
        return legacy && has(legacy) ? t(legacy) : def.id;
    },
    help(def) {
        const k = helpKey(def);
        return has(k) ? t(k) : '';
    },
    option(def, o) {
        const k = `set.${def.id}.opt.${o}`;
        if (has(k)) return t(k);
        // names that are the same in every language: drone presets; the language list's endonyms
        if (def.id === 'drone.current' && PRESETS[o]) return PRESETS[o].name;
        if (def.id === 'ui.language' && has(`lang.${o}`)) return t(`lang.${o}`);
        return o;
    }
};

const groupTitle = (g: RailId): string => (g === 'data' ? t('prefs.data') : has(`group.${g}`) ? t(`group.${g}`) : g);

interface Row {
    def: SettingDef;
    el: HTMLElement;
    focus(): void;
    refresh(): void;
}

let seq = 0;
/** Drone preset fields for the per-drone bounds of a number row. */
const RESOLVER = presetResolver(PRESETS, []);

export class SettingsScreen {
    readonly root: HTMLDivElement;
    private readonly host: SettingsHost;
    private readonly store: PrefsStore;
    private readonly rows: Row[] = [];
    private readonly sections = new Map<RailId, HTMLElement>();
    private readonly railButtons = new Map<RailId, HTMLButtonElement>();
    private readonly droneSelects: HTMLSelectElement[] = [];
    private readonly search: HTMLInputElement;
    private readonly pane: HTMLElement;
    private readonly note: HTMLElement;
    private readonly empty: HTMLElement;
    private readonly refreshers: (() => void)[] = [];
    private selected: RailId | null;
    private query = '';
    /** the drone whose per-drone values the rows show and change (the drone flown, unless switched) */
    private editDrone: string;
    private readonly off: () => void;
    private closed = false;

    constructor(parent: HTMLElement, host: SettingsHost, o: { focus?: string | null } = {}) {
        this.host = host;
        this.store = host.store;
        this.editDrone = droneOf(this.store);
        const groups: RailId[] = [...shownGroups(this.store.schema), 'data'];
        this.selected = groups[0];

        const x = h('button', { type: 'button', class: 'panel-x', 'data-action': 'settings-close', 'aria-label': t('common.close'), 'aria-keyshortcuts': 'Escape', title: `${t('common.close')} (Esc)`, onclick: () => this.close() }, '×');
        const caps = host.caps?.('settings.open') ?? [];
        const title = h('h2', { id: 'set-title' }, t('settings.title'), ...caps.map((c) => h('kbd', { class: 'set-cap', 'aria-hidden': 'true' }, c.cap)));
        this.search = h('input', { type: 'search', class: 'set-search', 'aria-label': t('prefs.search'), placeholder: t('prefs.search.placeholder'), 'data-testid': 'settings-search', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
        this.search.addEventListener('input', () => { this.query = this.search.value; this.render(); });
        this.note = h('p', { class: 'set-note', role: 'status', 'aria-live': 'polite', 'data-testid': 'settings-note', hidden: true });
        this.empty = h('p', { class: 'set-empty muted', hidden: true });

        const rail = h('nav', { class: 'set-rail', 'aria-label': t('prefs.groups') });
        const pane = h('div', { class: 'set-pane' }, this.empty);
        this.pane = pane;
        for (const g of groups) {
            const b = h('button', { type: 'button', class: 'set-rail-btn', 'data-group': g, onclick: () => this.railPick(g) }, groupTitle(g)) as HTMLButtonElement;
            this.railButtons.set(g, b);
            rail.append(b);
            const sec = g === 'data' ? this.dataGroup() : this.group(g);
            this.sections.set(g, sec);
            pane.append(sec);
        }

        this.root = h('div', { class: 'panel interactive settings', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'set-title', 'data-testid': 'settings' },
            h('div', { class: 'panel-head' }, title, x),
            h('div', { class: 'set-tools' }, this.search, this.note),
            h('div', { class: 'set-main' }, rail, pane));
        parent.append(this.root);
        // every change, from here or anywhere (a key, the drone picker, another tab): the rows read the store again
        this.off = this.store.onChange((c) => this.changed(c));
        this.render();

        const f = o.focus ? focusTarget(this.store.schema, o.focus) : null;
        if (f && f.kind === 'row') this.focusRow(f.id);
        else {
            if (f) this.say(t(f.kind === 'planned' ? 'prefs.focus.planned' : 'prefs.focus.unknown', { id: f.id }));
            (this.railButtons.get(this.selected ?? 'data') ?? x).focus({ preventScroll: true });
        }
    }

    /** Close: the store already has every change; the host applies what waits for the close. */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.off();
        this.root.remove();
        this.host.onClose();
    }

    get isOpen(): boolean {
        return !this.closed;
    }

    /** Opens the row's group, scrolls to it and puts the focus on its control (the deep link's ?focus=). */
    focusRow(id: string): boolean {
        const r = this.rows.find((x) => x.def.id === id);
        if (!r) return false;
        if (this.query) { this.search.value = ''; this.query = ''; }
        this.select(r.def.group, false);
        r.el.classList.add('focused');
        r.el.scrollIntoView({ block: 'center' });
        r.focus();
        return true;
    }

    // ------------------------------------------------------------------ groups and rows

    private group(g: GroupId): HTMLElement {
        const defs = shownDefs(this.store.schema).filter((d) => d.group === g);
        const body = h('div', { class: 'sg-body', id: `sg-${g}` });
        if (has(`group.${g}.help`)) body.append(h('p', { class: 'muted small sg-help' }, t(`group.${g}.help`)));
        if (defs.some((d) => d.scope === 'drone')) body.append(this.droneBar());
        for (const d of defs) {
            const r = this.row(d);
            this.rows.push(r);
            body.append(r.el);
        }
        body.append(this.groupReset(g));
        return this.section(g, body);
    }

    private section(g: RailId, body: HTMLElement): HTMLElement {
        // the accordion's header on a phone; on a wide screen the rail picks the group, so the title is only a title
        // (a button there would do nothing when pressed)
        const toggle = h('button', { type: 'button', class: 'sg-toggle', 'aria-controls': body.id, onclick: () => this.select(this.selected === g ? null : g, false) }, groupTitle(g));
        return h('section', { class: 'set-group', 'data-group': g, 'aria-label': groupTitle(g) }, h('h3', { class: 'sg-title' }, h('span', { class: 'sg-name' }, groupTitle(g)), toggle), body);
    }

    private dataGroup(): HTMLElement {
        const body = h('div', { class: 'sg-body', id: 'sg-data' });
        const d = dataSection({ store: this.store, say: (s) => this.say(s), reload: () => this.host.reload('data') });
        this.refreshers.push(d.refresh);
        body.append(d.el);
        return this.section('data', body);
    }

    /** "Values for [drone]": which drone's per-drone values the rows show; every group's bar is the same switch. */
    private droneBar(): HTMLElement {
        const sel = h('select', { class: 'set-drone', 'data-testid': 'settings-drone' }) as HTMLSelectElement;
        const id = `set-drone-${++seq}`;
        sel.id = id;
        sel.addEventListener('change', () => {
            this.editDrone = sel.value;
            this.refreshAll();
        });
        this.droneSelects.push(sel);
        this.fillDrones(sel);
        return h('div', { class: 'sg-drone' }, h('label', { for: id }, t('prefs.droneSwitch')), sel);
    }

    private fillDrones(sel: HTMLSelectElement): void {
        const flown = droneOf(this.store);
        sel.replaceChildren(...Object.entries(PRESETS).map(([id, p]) => h('option', { value: id }, id === flown ? t('prefs.droneFlown', { drone: p.name }) : p.name)));
        sel.value = this.editDrone;
    }

    private ctxOf(def: SettingDef): Ctx | undefined | null {
        if (def.scope === 'drone') return { drone: this.editDrone };
        if (def.scope === 'scene') return this.host.scene ? { scene: this.host.scene.id } : null;
        // one value for every scan whose default is the admin's per scan (the walls): read for this scan
        if (isCuratedRef(def.default) && this.host.scene) return { scene: this.host.scene.id };
        return undefined;
    }

    private row(def: SettingDef): Row {
        const uid = `set-${def.id.replace('.', '-')}-${++seq}`;
        const label = texts.label(def);
        const help = texts.help(def);
        const ctxOf = () => this.ctxOf(def);
        const enabled = ctxOf() !== null;
        const get = (): unknown => {
            const c = ctxOf();
            return c === null ? null : this.store.get(def.id, c);
        };
        const set = (v: unknown): void => {
            const c = ctxOf();
            if (c === null) return;
            if (def.id === 'drone.current') {
                // the rows follow the drone picked here, unless they showed another drone on purpose
                if (this.editDrone === droneOf(this.store)) this.editDrone = String(v);
            }
            pilotSet(this.store, def.id, v, c);
            if (def.apply === 'reload') this.host.reload(def.id);
        };

        const control = this.control(def, uid, label, get, set, enabled);
        const badge = h('span', { class: 'sr-badge', 'data-apply': def.apply }, t(`prefs.apply.${def.apply}`));
        const scope = h('span', { class: 'sr-scope' });
        const keyCaps = actionsOf(def).flatMap((a) => this.host.caps?.(a) ?? []);
        const caps = keyCaps.length ? h('span', { class: 'sr-keys', 'aria-hidden': 'true' }, ...keyCaps.map((k) => h('kbd', {}, k.cap))) : null;
        const fromLink = h('span', { class: 'sr-link', hidden: true }, t('prefs.fromLink'));
        const dot = h('span', { class: 'sr-dot', title: t('prefs.changed'), 'aria-hidden': 'true' });
        const reset = h('button', { type: 'button', class: 'sr-reset', 'data-action': 'reset-setting', hidden: true, onclick: () => { const c = ctxOf(); if (c === null) return; pilotReset(this.store, def.id, c); if (def.apply === 'reload') this.host.reload(def.id); } }, t('prefs.reset')) as HTMLButtonElement; // a reset of the language reloads like a change (the page's address names the language)
        // the description: shown on hover and keyboard focus, pinned by a click or tap (ui/toggletip.ts)
        const tip = help ? toggletip(t('prefs.help', { name: label }), help, `${uid}-help`) : null;
        const labelEl = control.labelFor ? h('label', { class: 'sr-name', for: control.labelFor }, label) : h('span', { class: 'sr-name' }, label);
        const el = h('div', { class: 'sr', 'data-id': def.id, 'data-scope': def.scope, 'data-type': def.type, 'data-testid': `setting-${def.id}` },
            h('div', { class: 'sr-head' }, labelEl, caps, tip?.button, tip?.bubble),
            h('div', { class: 'sr-meta' }, badge, scope, fromLink),
            h('div', { class: 'sr-control' }, control.el),
            h('div', { class: 'sr-side' }, dot, reset));
        if (!enabled) el.classList.add('disabled');

        const refresh = (): void => {
            const c = ctxOf();
            const explicit = c !== null && this.store.isExplicit(def.id, c);
            el.classList.toggle('changed', explicit);
            dot.hidden = !explicit;
            reset.hidden = !explicit;
            if (explicit) {
                const dv = this.store.defaultOf(def.id, c ?? undefined);
                reset.setAttribute('aria-label', t('prefs.reset.aria', { name: label, value: this.show(def, dv) }));
                reset.title = reset.getAttribute('aria-label') ?? '';
            }
            fromLink.hidden = explicit || !linkSettings().has(def.id);
            if (def.scope === 'drone') scope.textContent = t('prefs.forDrone', { drone: PRESETS[this.editDrone]?.name ?? this.editDrone });
            else if (def.scope === 'scene') scope.textContent = this.host.scene ? t('prefs.forScene', { scene: this.host.scene.title ?? this.host.scene.id }) : t('prefs.sceneNeeded');
            else scope.textContent = '';
            scope.hidden = def.scope === 'global';
            control.refresh();
        };
        refresh();
        return { def, el, focus: () => control.focus(), refresh };
    }

    /** A value as a short text (the reset button says what it goes back to). */
    private show(def: SettingDef, v: unknown): string {
        if (v === null || v === undefined) return t('prefs.fromPreset');
        if (def.type === 'bool') return t(v ? 'prefs.on' : 'prefs.off');
        if (def.type === 'enum') return texts.option(def, String(v));
        if (def.type === 'number') return `${formatNumber(v as number, def.step)}${unitSymbol(def.unit) ? ` ${unitSymbol(def.unit)}` : ''}`;
        if (def.type === 'json' && def.kind === 'transform') return `x${((v as { s: number }).s).toFixed(2)}`;
        return t('prefs.fromPreset');
    }

    private control(def: SettingDef, uid: string, label: string, get: () => unknown, set: (v: unknown) => void, enabled: boolean): Editor {
        switch (def.type) {
            case 'bool': return this.switchControl(uid, label, get, set, enabled);
            case 'number': return this.numberControl(def, uid, label, get, set, enabled);
            // a segmented control while its options fit on one line (A.9: four or fewer, short), else a select
            case 'enum': return def.options.length <= 4 && def.options.reduce((n, o) => n + texts.option(def, o).length, 0) <= 40 ? this.segmented(def, uid, label, get, set, enabled) : this.selectControl(def, uid, label, get, set, enabled);
            case 'json': return jsonEditor(def, { get, set, drone: () => this.editDrone, uid, label, importBetaflight: this.host.importBetaflight ? () => this.host.importBetaflight?.() : undefined });
        }
    }

    private switchControl(uid: string, label: string, get: () => unknown, set: (v: unknown) => void, enabled: boolean): Editor {
        const box = h('input', { type: 'checkbox', role: 'switch', id: uid, class: 'sw-input', 'aria-label': label, disabled: !enabled }) as HTMLInputElement;
        const state = h('span', { class: 'sw-state', 'aria-hidden': 'true' });
        box.addEventListener('change', () => set(box.checked));
        const el = h('label', { class: 'sw' }, box, h('span', { class: 'sw-track', 'aria-hidden': 'true' }), state);
        const refresh = (): void => {
            const on = get() === true;
            box.checked = on;
            state.textContent = t(on ? 'prefs.on' : 'prefs.off');
        };
        return { el, focus: () => box.focus({ preventScroll: true }), labelFor: uid, refresh };
    }

    private numberControl(def: NumDef, uid: string, label: string, get: () => unknown, set: (v: unknown) => void, enabled: boolean): Editor {
        const bounds = () => {
            const c = this.ctxOf(def);
            const b = boundsOf(def, RESOLVER, def.scope === 'drone' ? (c as Ctx | null)?.drone : droneOf(this.store));
            return { min: Number.isFinite(b.min) ? b.min : 0, max: Number.isFinite(b.max) ? b.max : 100 };
        };
        const log = def.curve === 'log';
        const slider = h('input', { type: 'range', class: 'sr-range', 'aria-hidden': 'true', tabindex: -1, disabled: !enabled }) as HTMLInputElement;
        const field = h('input', { type: 'number', class: 'num', id: uid, inputmode: 'decimal', step: def.step, 'aria-label': label, disabled: !enabled }) as HTMLInputElement;
        const unit = unitSymbol(def.unit);
        const write = (v: number): void => {
            const b = bounds();
            set(snap(v, b.min, b.max, def.step));
        };
        // the slider drags live (FOV shows behind the panel); the field writes when it is left or Enter is pressed
        slider.addEventListener('input', () => { const b = bounds(); write(fromSlider(Number(slider.value), b.min, b.max, log)); });
        field.addEventListener('change', () => {
            const n = Number(field.value.replace(',', '.'));
            if (field.value.trim() === '' || !Number.isFinite(n)) { refresh(); return; }
            write(n);
        });
        const el = h('div', { class: 'sr-num' }, slider, h('span', { class: 'sr-field' }, field, unit ? h('span', { class: 'sr-unit' }, unit) : null));
        const refresh = (): void => {
            const b = bounds();
            const v = Number(get());
            if (log && b.min > 0) {
                slider.min = '0';
                slider.max = '1000';
                slider.step = 'any';
            } else {
                slider.min = String(b.min);
                slider.max = String(b.max);
                slider.step = String(def.step);
            }
            field.min = String(b.min);
            field.max = String(b.max);
            if (document.activeElement !== slider) slider.value = String(toSlider(v, b.min, b.max, log));
            if (document.activeElement !== field) field.value = formatNumber(v, def.step);
        };
        return { el, focus: () => field.focus({ preventScroll: true }), labelFor: uid, refresh };
    }

    private segmented(def: EnumDef, uid: string, label: string, get: () => unknown, set: (v: unknown) => void, enabled: boolean): Editor {
        const inputs = def.options.map((o, i) => {
            const id = `${uid}-${i}`;
            const r = h('input', { type: 'radio', name: uid, id, value: o, disabled: !enabled }) as HTMLInputElement;
            r.addEventListener('change', () => { if (r.checked) set(o); });
            return { r, lab: h('label', { for: id }, texts.option(def, o)) };
        });
        const el = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, ...inputs.flatMap((x) => [x.r, x.lab]));
        const refresh = (): void => {
            const v = String(get());
            for (const x of inputs) x.r.checked = x.r.value === v;
        };
        // the focus goes to the checked option, as a radio group's Tab does
        return { el, focus: () => (inputs.find((x) => x.r.checked) ?? inputs[0]).r.focus({ preventScroll: true }), refresh };
    }

    private selectControl(def: EnumDef, uid: string, label: string, get: () => unknown, set: (v: unknown) => void, enabled: boolean): Editor {
        const sel = h('select', { id: uid, 'aria-label': label, disabled: !enabled }, ...def.options.map((o) => h('option', { value: o }, texts.option(def, o)))) as HTMLSelectElement;
        sel.addEventListener('change', () => set(sel.value));
        const refresh = (): void => { sel.value = String(get()); };
        return { el: sel, focus: () => sel.focus({ preventScroll: true }), labelFor: uid, refresh };
    }

    /** "Reset this group" with a second press to confirm: only the explicit values of this group go. */
    private groupReset(g: GroupId): HTMLElement {
        const box = h('div', { class: 'sg-foot' });
        const draw = (): void => {
            const n = this.explicitIn(g);
            const btn = h('button', { type: 'button', class: 'btn', 'data-action': 'reset-group', disabled: n === 0, onclick: () => confirm() }, t('prefs.resetGroup'));
            box.replaceChildren(btn);
        };
        const confirm = (): void => {
            const n = this.explicitIn(g);
            if (!n) return;
            const yes = h('button', { type: 'button', class: 'btn primary', 'data-action': 'reset-group-yes', onclick: () => {
                for (const d of this.store.schema.defs) if (d.group === g) pilotReset(this.store, d.id, this.ctxOf(d) ?? undefined);
                draw();
            } }, t('prefs.confirm.reset'));
            const no = h('button', { type: 'button', class: 'btn', onclick: () => draw() }, t('common.cancel'));
            box.replaceChildren(h('p', { class: 'small' }, t('prefs.resetGroup.confirm', { n: String(n) })), yes, no);
            yes.focus();
        };
        draw();
        this.refreshers.push(() => { if (!box.querySelector('[data-action="reset-group-yes"]')) draw(); });
        return box;
    }

    /** Explicit values of a group for the drone and scan the rows show. */
    private explicitIn(g: GroupId): number {
        let n = 0;
        for (const d of this.store.schema.defs) {
            if (d.group !== g) continue;
            const c = this.ctxOf(d);
            if (c !== null && this.store.isExplicit(d.id, c ?? undefined)) n++;
        }
        return n;
    }

    // ------------------------------------------------------------------ state

    private changed(c: PrefChange): void {
        if (c.id === 'drone.current') for (const s of this.droneSelects) this.fillDrones(s);
        this.refreshAll();
    }

    private refreshAll(): void {
        for (const s of this.droneSelects) s.value = this.editDrone;
        for (const r of this.rows) r.refresh();
        for (const f of this.refreshers) f();
    }

    private narrow(): boolean {
        return typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches;
    }

    /**
     * The rail: another group shows that group (the focus stays on the rail, like tabs); the group
     * already shown takes the focus into its first control. A search in progress gives way.
     */
    private railPick(g: RailId): void {
        if (this.query) {
            this.search.value = '';
            this.query = '';
        } else if (this.selected === g) {
            this.sections.get(g)?.querySelector<HTMLElement>('.sg-body input:not([type="hidden"]):not([tabindex="-1"]):not(:disabled), .sg-body select:not(:disabled), .sg-body button:not([hidden]):not(:disabled)')?.focus();
            return;
        }
        this.select(g, true);
    }

    /** The rail's (or the accordion's) group; null closes the accordion. */
    private select(g: RailId | null, focusFirst: boolean): void {
        this.selected = g;
        this.render();
        if (g && focusFirst) this.pane.scrollTop = 0;
        if (g && this.narrow()) this.sections.get(g)?.scrollIntoView({ block: 'start' });
    }

    private render(): void {
        const searching = this.query.trim() !== '';
        this.root.classList.toggle('searching', searching);
        let found = 0;
        for (const r of this.rows) {
            const hit = !searching || matches(r.def, this.query, texts);
            r.el.hidden = !hit;
            if (hit && searching) found++;
        }
        for (const [g, sec] of this.sections) {
            const visibleRows = g === 'data' ? 0 : this.rows.filter((r) => r.def.group === g && !r.el.hidden).length;
            const sel = !searching && this.selected === g;
            sec.classList.toggle('sel', sel);
            sec.hidden = searching ? visibleRows === 0 : false;
            sec.querySelector('.sg-toggle')?.setAttribute('aria-expanded', String(searching || sel));
            const b = this.railButtons.get(g);
            if (b) {
                if (sel) b.setAttribute('aria-current', 'true');
                else b.removeAttribute('aria-current');
            }
        }
        this.empty.hidden = !searching || found > 0;
        this.empty.textContent = searching && !found ? t('prefs.search.none', { q: this.query.trim() }) : '';
    }

    private say(s: string): void {
        this.note.textContent = s;
        this.note.hidden = !s;
    }
}

// The Switches screen (v0.7 lane D2; the pilot's idea R-20261006-0003: "mode on CH5 and arm on CH6
// like on my radio"), a view of the Controls screen for the radio in use (ui/radio.ts puts it in its
// body): what each switch does, as Betaflight's Modes tab. Rows for Arm, Flight mode (the channel,
// what each position gives, then the Angle / Horizon ranges) and Functions (rewind, record...), each
// with a channel, a live bar of 900..2100 us with two range handles and "Flip to assign"; a paste of
// Betaflight's `diff all`, or of its bare aux lines, sets arm and the flight mode as on the quad. Every decision is in @gsfpv/input switches.ts; this
// file draws the state and passes the pilot's changes on.
//
// It starts from what the profile has: its switches, or the setup wizard's arm and mode switch as
// ranges. Untouched, saving leaves the profile as it was (the wizard keeps deciding); "Back to the
// setup wizard's switches" does the same after edits.
import './switches.css';
import {
    FLIGHT_MODES, ModeSwitchDetector, POSITION_BANDS, SWITCH_ACTIONS, US_MAX, US_MIN, US_STEP, bandOf, channelUs, copySwitches,
    defaultSwitchModes, fnOn, importOver, inputFromKey, inputKey, modeInput, modePositions, rangesMode, sameInput, setModePositions, snapUs, switchesFromBetaflight, switchesFromProfile, tablePairs
} from '@gsfpv/input';
import type { ImportOver, Profile, RawFrame, SwitchAction, SwitchFn, SwitchInput, SwitchModes, SwitchPos, Switches } from '@gsfpv/input';
import { parseAuxPaste, parseBetaflightDiff } from '@gsfpv/sim-core';
import { h } from './dom';
import { t } from '../i18n';
import { inputLabel } from '../controls';

export interface SwitchesViewOptions {
    profile: Profile;
    kind: 'hid' | 'gamepad';
    /** the screen's close button (x / Esc leave the whole Controls screen, nothing changed) */
    close: HTMLElement;
    onSave(p: Profile): void;
    onCancel(): void;
}

/**
 * What a Betaflight import over the pilot's switches (importOver) means for them, one line each: the
 * function switches kept ("Rewind CH7"), those that no longer fit, and an arm or a flight mode the
 * diff does not set. `name`: the input as the pilot reads it (controls.ts inputLabel). The Switches
 * screen's import and the menu's (app/builtin/import.ts) say the same.
 */
export function importOverNotes(over: ImportOver, name: (i: SwitchInput) => string): string[] {
    const out: string[] = [];
    if (over.kept.length) out.push(t('switches.importKept', { list: over.kept.map((r) => `${t(`keys.${r.fn}`)} ${name(r.input)}`).join(', ') }));
    if (over.dropped) out.push(t('switches.importDropped', { n: over.dropped }));
    if (over.noArm) out.push(t('switches.importNoArm'));
    if (over.noMode) out.push(t('switches.importNoMode'));
    return out;
}

/** What "Flip to assign" waits for. */
type Listen = { what: 'range'; index: number } | { what: 'mode' } | null;

const SPAN = US_MAX - US_MIN;
const pct = (us: number): number => ((us - US_MIN) / SPAN) * 100;
const keyOf = inputKey;

export class SwitchesView {
    readonly el: HTMLElement;
    private o: SwitchesViewOptions;
    private sw: Switches;
    /** true: the profile keeps no switches (the setup wizard decides); any edit makes it false */
    private wizard: boolean;
    private last: RawFrame | null = null;
    private axesSeen = 8;
    private listen: Listen = null;
    private det = new ModeSwitchDetector();
    private lives: (() => void)[] = [];
    private body: HTMLElement;
    private note: HTMLElement;
    /** the import's last answer, kept across redraws */
    private importLines: HTMLElement[] = [];

    constructor(o: SwitchesViewOptions) {
        this.o = o;
        this.wizard = !o.profile.switches;
        this.sw = o.profile.switches ? copySwitches(o.profile.switches) : switchesFromProfile(o.profile);
        // the sticks are never a switch; a recognised controller's two-bit switches are one switch each
        this.det.exclude(Object.values(o.profile.axes).map((a) => a.index), []);
        this.det.pairs(tablePairs(o.profile.channels));
        this.note = h('p', { class: 'swv-note small', role: 'status', 'aria-live': 'polite' });
        this.body = h('div', { class: 'swv-body' });
        this.el = h('div', { class: 'swv', 'data-testid': 'switches-screen' },
            h('div', { class: 'radio-head' }, h('div', {}, h('h1', { id: 'radio-title' }, t('switches.title')), h('p', { class: 'muted' }, o.profile.deviceName)), o.close),
            h('p', { class: 'swv-intro' }, t('switches.intro')),
            this.body, this.note);
        this.render();
    }

    /** A device frame: kept for the live parts, and watched for a flip while "Flip to assign" waits. */
    frame(f: RawFrame): void {
        this.last = f;
        if (f.axes.length !== this.axesSeen) { this.axesSeen = f.axes.length; this.render(); }
        const flip = this.listen ? this.det.feed(f) : null;
        if (flip) this.assign(flip.input, f);
    }

    /** Once per animation frame: bars, markers, ON / off. */
    live(): void {
        for (const l of this.lives) l();
    }

    // ------------------------------------------------------------------ changes

    private edited(): void {
        this.wizard = false;
        this.render();
    }

    private startListen(l: Listen): void {
        this.listen = l;
        this.det.reset();
        if (this.last) this.det.feed(this.last);
        this.render();
    }

    /** A flip seen: the waiting row takes the switch and the band it was flipped to. */
    private assign(input: SwitchInput, f: RawFrame): void {
        const l = this.listen;
        this.listen = null;
        if (!l) return;
        if (l.what === 'mode') {
            const cur = modeInput(this.sw);
            const modes = cur ? modePositions(this.sw, cur) : defaultSwitchModes();
            this.sw = setModePositions(this.sw, input, modes);
            this.say(t('switches.assignedMode', { src: this.label(input) }));
        } else {
            const r = this.sw.ranges[l.index];
            if (!r) return;
            const [lo, hi] = bandOf(input, channelUs(input, f) ?? US_MAX - 1);
            this.sw.ranges[l.index] = { ...r, input: { ...input }, lo, hi };
            this.say(t('switches.assigned', { fn: this.fnLabel(r.fn), src: this.label(input), lo, hi }));
        }
        this.edited();
    }

    private say(s: string): void {
        this.note.textContent = s;
    }

    // ------------------------------------------------------------------ names

    /** "CH6"; on a gamepad a button is "button 3" (its channels are not known); the device's own channel with its table: controls.ts inputLabel, as the HUD. */
    private label(i: SwitchInput): string {
        return inputLabel(i, this.o.kind, this.o.profile.channels);
    }

    private fnLabel(fn: SwitchFn): string {
        return fn === 'arm' || fn === 'angle' || fn === 'horizon' ? t(`switches.fn.${fn}`) : t(`keys.${fn}`);
    }

    /** The inputs a switch can be on: CH5..CH16 of a USB radio (CH9+ arrive as buttons); a gamepad's spare axes and its buttons. */
    private candidates(): SwitchInput[] {
        const out: SwitchInput[] = [];
        const sticks = new Set(Object.values(this.o.profile.axes).map((a) => a.index));
        const table = this.o.profile.channels;
        if (table) {
            // a recognised controller: its channels from CH5 (its switches and buttons, a two-bit
            // switch as one), then its other buttons, so a bit of a two-bit switch is never offered alone
            const inPairs = new Set(table.flatMap((i) => (i.kind === 'bits' ? [i.lo, i.hi] : [])));
            for (const i of table) if (!(i.kind === 'axis' && sticks.has(i.index))) out.push({ ...i });
            for (let b = 0; b < 16; b++) if (!inPairs.has(b) && !out.some((x) => x.kind === 'button' && x.bit === b)) out.push({ kind: 'button', bit: b });
            for (const r of this.sw.ranges) if (!out.some((x) => sameInput(x, r.input))) out.push({ ...r.input });
            return out;
        }
        const axes = this.o.kind === 'hid' ? 8 : this.axesSeen;
        for (let i = 0; i < axes; i++) if (!sticks.has(i) && (this.o.kind === 'gamepad' || i >= 4)) out.push({ kind: 'axis', index: i });
        for (let b = 0; b < (this.o.kind === 'hid' ? 8 : 16); b++) out.push({ kind: 'button', bit: b });
        for (const r of this.sw.ranges) if (!out.some((x) => sameInput(x, r.input))) out.push({ ...r.input });
        return out;
    }

    private channelSelect(value: SwitchInput | null, aria: string, onPick: (i: SwitchInput | null) => void, withNone: boolean): HTMLSelectElement {
        const sel = h('select', { class: 'swv-ch', 'aria-label': aria }) as HTMLSelectElement;
        if (withNone) sel.append(h('option', { value: '' }, t('switches.none')));
        for (const i of this.candidates()) sel.append(h('option', { value: keyOf(i) }, this.label(i)));
        sel.value = value ? keyOf(value) : '';
        sel.addEventListener('change', () => onPick(sel.value ? inputFromKey(sel.value) : null));
        return sel;
    }

    // ------------------------------------------------------------------ drawing

    private render(): void {
        this.lives = [];
        const p = this.o.profile;
        const sections: HTMLElement[] = [];

        // the channels: one live bar each, so the pilot sees which channel a switch moves
        const strip = h('div', { class: 'swv-strip', 'aria-hidden': 'true' });
        for (const i of this.candidates()) {
            const fill = h('i');
            const cell = h('div', { class: 'swv-chan' }, h('span', {}, this.label(i)), h('div', { class: 'swv-mini' }, fill));
            strip.append(cell);
            this.lives.push(() => {
                const us = this.last ? channelUs(i, this.last) : null;
                fill.style.width = us === null ? '0%' : `${pct(us).toFixed(1)}%`;
                // before the first report nothing is missing yet
                cell.classList.toggle('missing', !!this.last && us === null);
            });
        }
        sections.push(h('section', { class: 'swv-sec' }, h('h2', {}, t('switches.channels')), h('p', { class: 'muted small' }, t('switches.channelsHint')), strip));

        // arm
        const arm = h('section', { class: 'swv-sec', 'data-fn': 'arm' }, h('h2', {}, t('switches.fn.arm')));
        const armIdx = this.indexes('arm');
        if (!armIdx.length) {
            const src = !p.arm || p.arm.kind === 'key' ? t('wizard.armSource.key') : p.arm.kind === 'button' ? t('wizard.armSource.button', { n: p.arm.bit + 1 }) : t('wizard.armSource.ch', { n: p.arm.index + 1 });
            arm.append(h('p', { class: 'muted' }, t('switches.armWizard', { src })), this.addButton('arm'));
        } else {
            for (const i of armIdx) arm.append(this.rangeRow(i, armIdx.length > 1));
            arm.append(h('p', { class: 'muted small' }, t('switches.armHint')), this.addButton('arm', true));
        }
        sections.push(arm);

        // flight mode
        sections.push(this.modeSection());

        // functions
        const fns = h('section', { class: 'swv-sec', 'data-fn': 'functions' }, h('h2', {}, t('switches.functions')), h('p', { class: 'muted small' }, t('switches.functionsHint')));
        for (const a of SWITCH_ACTIONS) {
            const idx = this.indexes(a);
            for (const i of idx) fns.append(this.rangeRow(i, idx.length > 1));
        }
        const add = h('select', { class: 'swv-add', 'data-testid': 'switches-add', 'aria-label': t('switches.add') }) as HTMLSelectElement;
        add.append(h('option', { value: '' }, t('switches.add')));
        for (const a of SWITCH_ACTIONS) if (!this.indexes(a).length) add.append(h('option', { value: a }, t(`keys.${a}`)));
        add.addEventListener('change', () => {
            const a = add.value as SwitchAction;
            if (!a) return;
            this.addRange(a, true);
        });
        fns.append(add);
        sections.push(fns);

        sections.push(this.importSection());

        // the end: save, back to the wizard's, cancel
        const save = h('button', { type: 'button', class: 'btn primary big', 'data-action': 'switches-save', onclick: () => this.save() }, t('switches.save'));
        const back = h('button', { type: 'button', class: 'btn', 'data-action': 'switches-wizard', disabled: this.wizard, onclick: () => {
            const plain: Profile = { ...p };
            delete plain.switches;
            this.sw = switchesFromProfile(plain);
            this.wizard = true;
            this.listen = null;
            this.say(t('switches.wizardBack'));
            this.render();
        } }, t('switches.reset'));
        const cancel = h('button', { type: 'button', class: 'btn', 'data-action': 'switches-cancel', onclick: () => this.o.onCancel() }, t('switches.cancel'));
        const state = h('p', { class: 'muted small' }, this.wizard ? t('switches.fromWizard') : t('switches.edited'));
        sections.push(h('div', { class: 'swv-foot' }, state, h('div', { class: 'actions' }, save, back, cancel), h('p', { class: 'muted small' }, t('switches.recalNote'))));
        this.body.replaceChildren(...sections);
    }

    private indexes(fn: SwitchFn): number[] {
        const out: number[] = [];
        this.sw.ranges.forEach((r, i) => { if (r.fn === fn) out.push(i); });
        return out;
    }

    /** "Use a switch" / "Add a range": a new range on the first free channel, then waits for a flip. */
    private addButton(fn: 'arm' | 'angle' | 'horizon', more = false): HTMLButtonElement {
        return h('button', { type: 'button', class: 'btn', 'data-action': `switches-add-${fn}`, onclick: () => this.addRange(fn, true) }, t(more ? 'switches.addRange' : 'switches.useSwitch'));
    }

    private addRange(fn: SwitchFn, listen: boolean): void {
        if (this.sw.ranges.length >= 20) { this.say(t('switches.full')); return; }
        const used = new Set(this.sw.ranges.map((r) => keyOf(r.input)));
        const input = this.candidates().find((i) => !used.has(keyOf(i))) ?? this.candidates()[0] ?? { kind: 'axis', index: 4 };
        this.sw.ranges.push({ fn, input, lo: 1700, hi: 2100 });
        this.wizard = false;
        if (listen) this.startListen({ what: 'range', index: this.sw.ranges.length - 1 });
        else this.render();
    }

    /** One range: function, channel, the bar with two handles and the live marker, ON / off, flip, remove. */
    private rangeRow(index: number, several: boolean): HTMLElement {
        const r = this.sw.ranges[index];
        const name = this.fnLabel(r.fn);
        const ch = this.channelSelect(r.input, t('switches.channelOf', { fn: name }), (i) => {
            if (!i) return;
            this.sw.ranges[index] = { ...this.sw.ranges[index], input: i };
            this.edited();
        }, false);
        const band = h('div', { class: 'swv-band' });
        const mark = h('div', { class: 'swv-mark' });
        const handle = (which: 'lo' | 'hi'): HTMLInputElement => {
            const inp = h('input', { type: 'range', min: US_MIN, max: US_MAX, step: US_STEP, value: r[which], class: `swv-h ${which}`, 'aria-label': t(which === 'lo' ? 'switches.from' : 'switches.to', { fn: name }), 'data-testid': `switches-${which}-${index}` }) as HTMLInputElement;
            inp.addEventListener('input', () => {
                const cur = this.sw.ranges[index];
                let v = snapUs(Number(inp.value));
                if (which === 'lo' && v >= cur.hi) v = cur.hi - US_STEP;
                if (which === 'hi' && v <= cur.lo) v = cur.lo + US_STEP;
                inp.value = String(v);
                this.sw.ranges[index] = { ...cur, [which]: v };
                this.wizard = false;
                drawBand();
            });
            inp.addEventListener('change', () => this.render());
            return inp;
        };
        const lo = handle('lo'), hi = handle('hi');
        const values = h('span', { class: 'swv-val' });
        const drawBand = (): void => {
            const c = this.sw.ranges[index];
            band.style.left = `${pct(c.lo)}%`;
            band.style.width = `${pct(c.hi) - pct(c.lo)}%`;
            values.textContent = t('switches.range', { lo: c.lo, hi: c.hi });
        };
        drawBand();
        const bar = h('div', { class: 'swv-bar' }, band, mark, lo, hi);
        const onOff = h('span', { class: 'swv-on', 'data-testid': `switches-on-${index}` });
        const now = h('span', { class: 'swv-now muted small' });
        const listening = this.listen?.what === 'range' && this.listen.index === index;
        const flip = h('button', { type: 'button', class: `btn swv-flip${listening ? ' listening' : ''}`, 'data-action': `switches-flip-${index}`, onclick: () => (listening ? (this.listen = null, this.render()) : this.startListen({ what: 'range', index })) }, t(listening ? 'switches.flipping' : 'switches.flip'));
        const remove = h('button', { type: 'button', class: 'btn swv-x', 'data-action': `switches-remove-${index}`, 'aria-label': t('switches.removeAria', { fn: name, src: this.label(r.input) }), title: t('switches.remove'), onclick: () => {
            this.sw.ranges.splice(index, 1);
            if (this.listen?.what === 'range') this.listen = null;
            this.edited();
        } }, '×');
        let logic: HTMLSelectElement | null = null;
        if (several || r.and) {
            logic = h('select', { class: 'swv-logic', 'aria-label': t('switches.logic', { fn: name }) }, h('option', { value: 'or' }, t('switches.or')), h('option', { value: 'and' }, t('switches.and'))) as HTMLSelectElement;
            logic.value = r.and ? 'and' : 'or';
            logic.addEventListener('change', () => {
                const cur = { ...this.sw.ranges[index] };
                if (logic!.value === 'and') cur.and = true; else delete cur.and;
                this.sw.ranges[index] = cur;
                this.edited();
            });
        }
        const warn = h('p', { class: 'swv-warn small warn' });
        const isButton = r.input.kind === 'button';
        if (isButton && r.lo > US_MIN && r.hi < US_MAX) warn.textContent = t('switches.buttonOnly', { src: this.label(r.input) });
        const row = h('div', { class: 'swv-row', 'data-fn': r.fn, 'data-testid': `switches-row-${index}` },
            h('span', { class: 'swv-name' }, name), ch, h('div', { class: 'swv-mid' }, bar, h('div', { class: 'swv-under' }, values, now)), onOff, logic, flip, remove, warn);
        this.lives.push(() => {
            const c = this.sw.ranges[index];
            const us = this.last ? channelUs(c.input, this.last) : null;
            mark.hidden = us === null;
            if (us !== null) mark.style.left = `${pct(us).toFixed(2)}%`;
            const on = !!this.last && us !== null && fnOn({ v: 1, ranges: [c] }, c.fn, this.last);
            onOff.textContent = us === null ? '—' : t(on ? 'switches.on' : 'switches.off');
            row.classList.toggle('on', on);
            // no report yet: say nothing rather than "does not reach the simulator"
            now.textContent = !this.last ? '' : us === null ? t('switches.noChannel', { src: this.label(c.input) }) : t('switches.now', { us: Math.round(us) });
        });
        return row;
    }

    /** Flight mode: the switch and what each position gives; below, the Angle and Horizon ranges themselves. */
    private modeSection(): HTMLElement {
        const sec = h('section', { class: 'swv-sec', 'data-fn': 'mode' }, h('h2', {}, t('switches.mode')));
        const input = modeInput(this.sw);
        const any = this.indexes('angle').length + this.indexes('horizon').length > 0;
        const listening = this.listen?.what === 'mode';
        const flip = h('button', { type: 'button', class: `btn swv-flip${listening ? ' listening' : ''}`, 'data-action': 'switches-flip-mode', onclick: () => (listening ? (this.listen = null, this.render()) : this.startListen({ what: 'mode' })) }, t(listening ? 'switches.flipping' : 'switches.flip'));
        const ch = this.channelSelect(input, t('switches.channelOf', { fn: t('switches.mode') }), (i) => {
            if (!i) {
                this.sw = { v: 1, ranges: this.sw.ranges.filter((r) => r.fn !== 'angle' && r.fn !== 'horizon') };
            } else {
                const modes = input ? modePositions(this.sw, input) : defaultSwitchModes();
                this.sw = setModePositions(this.sw, i, modes);
            }
            this.edited();
        }, true);
        sec.append(h('div', { class: 'swv-modehead' }, h('span', { class: 'swv-name' }, t('switches.channel')), ch, flip));
        if (!any) sec.append(h('p', { class: 'muted' }, t('switches.modeNone')));
        else if (!input) sec.append(h('p', { class: 'muted' }, t('switches.modeMixed')));
        else {
            const modes = modePositions(this.sw, input);
            const positions: SwitchPos[] = input.kind === 'button' ? [0, 2] : [0, 1, 2];
            const btns = positions.map((pos) => {
                const label = (): string => `${this.posName(input, pos)}: ${t(`mode.${modes[pos]}`)}`;
                const b = h('button', { type: 'button', class: 'btn swv-pos', 'data-action': `switches-pos-${pos}`, onclick: () => {
                    const next: SwitchModes = [modes[0], modes[1], modes[2]];
                    next[pos] = FLIGHT_MODES[(FLIGHT_MODES.indexOf(modes[pos]) + 1) % FLIGHT_MODES.length];
                    if (input.kind === 'button') next[1] = next[0];
                    this.sw = setModePositions(this.sw, input, next);
                    this.edited();
                } }, label());
                return { pos, b };
            });
            sec.append(h('div', { class: 'swv-positions' }, ...btns.map((x) => x.b)));
            this.lives.push(() => {
                const us = this.last ? channelUs(input, this.last) : null;
                const at = us === null ? -1 : input.kind === 'button' ? (us >= 1500 ? 2 : 0) : POSITION_BANDS.findIndex(([lo, hi]) => us >= lo && us < hi);
                for (const { pos, b } of btns) b.classList.toggle('now', pos === at);
            });
        }
        const now = h('p', { class: 'swv-modenow' });
        this.lives.push(() => {
            const m = this.last ? rangesMode(this.sw, this.last) : null;
            now.textContent = m ? t('switches.modeNow', { mode: t(`mode.${m}`) }) : t('switches.modePilot');
        });
        sec.append(now);
        // Betaflight's own view: the ranges
        const det = h('details', { class: 'swv-ranges', open: !input && any });
        det.append(h('summary', {}, t('switches.ranges')));
        for (const fn of ['angle', 'horizon'] as const) {
            const idx = this.indexes(fn);
            for (const i of idx) det.append(this.rangeRow(i, idx.length > 1));
            det.append(h('button', { type: 'button', class: 'btn', 'data-action': `switches-add-${fn}`, onclick: () => this.addRange(fn, true) }, t('switches.addFn', { fn: t(`switches.fn.${fn}`) })));
        }
        sec.append(det);
        return sec;
    }

    private posName(input: SwitchInput, pos: SwitchPos): string {
        if (input.kind === 'button') return t(pos === 2 ? 'mode.switch.pressed' : 'mode.switch.released');
        return t(pos === 0 ? 'switches.pos.low' : pos === 1 ? 'switches.pos.mid' : 'switches.pos.high');
    }

    /** Paste `diff all`: its aux lines replace the switches (ARM, ANGLE, HORIZON; the rest is listed). */
    private importSection(): HTMLElement {
        const area = h('textarea', { class: 'swv-import', rows: 6, spellcheck: 'false', 'aria-label': t('switches.import'), placeholder: 'aux 0 0 0 1700 2100 0 0' }) as HTMLTextAreaElement;
        const go = h('button', { type: 'button', class: 'btn', 'data-action': 'switches-import', onclick: () => this.importText(area.value) }, t('switches.importApply'));
        const out = h('div', { class: 'swv-import-out small', role: 'status' }, ...this.importLines);
        return h('details', { class: 'swv-sec swv-importsec', open: this.importLines.length > 0 }, h('summary', {}, t('switches.import')), h('p', { class: 'muted small' }, t('switches.importHint')), area, go, out);
    }

    /** A paste of bare aux lines (the CLI's `aux`, a diff's aux block) or a whole `diff all`. */
    private importText(text: string): void {
        const r = parseAuxPaste(text) ?? parseBetaflightDiff(text);
        const imp = r.errors.length ? null : switchesFromBetaflight(r.aux, this.o.profile.channels);
        if (!imp) this.importLines = [h('p', { class: 'error' }, t('switches.importError', { msg: r.errors.join(' ') }))];
        else if (!imp.applied.length) this.importLines = [h('p', { class: 'warn' }, t('switches.importNone'))];
        else {
            // ARM / ANGLE / HORIZON replaced as on the quad; the simulator's own functions stay
            const over = importOver(this.sw, imp.switches);
            this.sw = over.switches;
            this.listen = null;
            this.wizard = false;
            const list = imp.applied.map((c, i) => `${c.mode} ${this.label(imp.switches.ranges[i].input)} ${c.lo}–${c.hi}${c.and ? ' AND' : ''}`).join(', ');
            this.importLines = [h('p', { class: 'ok' }, t('switches.importDone', { list }))];
            const skipped = [...new Set(imp.skipped.filter((x) => x.why === 'notInSimulator').map((x) => x.cond.mode))];
            if (skipped.length) this.importLines.push(h('p', { class: 'muted' }, t('switches.importSkipped', { list: skipped.join(', ') })));
            for (const x of imp.skipped.filter((y) => y.why !== 'notInSimulator')) this.importLines.push(h('p', { class: 'warn' }, t(x.why === 'linked' ? 'switches.importLinked' : 'switches.full', { mode: x.cond.mode })));
            for (const n of importOverNotes(over, (i) => this.label(i))) this.importLines.push(h('p', { class: 'muted' }, n));
            this.say(t('switches.importDone', { list }));
        }
        this.render();
    }

    private save(): void {
        const p: Profile = structuredClone(this.o.profile);
        if (this.wizard) delete p.switches;
        else p.switches = copySwitches(this.sw);
        this.o.onSave(p);
    }
}

// The menu's "Import Betaflight diff" (phase D): rates, PID and throttle curve from a Betaflight CLI
// diff become the tune of the drone flown, stored for that drone (tune.rates / tune.pid /
// tune.throttle; W2-1, review finding C10: v0.2 put them into one set of overrides that the next
// drone inherited and a reload forgot), then a new flight model from the store; every warning is
// shown in full. v0.7: Quick rates come with their quickrates_rc_expo, and a diff whose aux lines
// set ARM / ANGLE / HORIZON offers them to the radio in use (its Switches, @gsfpv/input switches.ts):
// they replace its arm and flight-mode ranges, its function switches (rewind, record...) stay.
import { copyRates, parseBetaflightDiff } from '@gsfpv/sim-core';
import type { BfAuxCondition } from '@gsfpv/sim-core';
import { channelOf, importOver, switchesFromBetaflight } from '@gsfpv/input';
import type { ImportOver, Profile } from '@gsfpv/input';
import { h, clear, panel } from '../../ui/dom';
import { importOverNotes } from '../../ui/switches';
import { inputLabel } from '../../controls';
import { t } from '../../i18n';
import { applyModel, droneOf, pilotSet } from '../prefs';
import type { TestHook } from '../test-hook';
import type { Feature, FlightContext } from '../context';

type ImportResult = ReturnType<NonNullable<TestHook['importDiff']>>;

/** The import, and the diff's mode switches for the panel (empty when refused). Exported for the Node tests. */
export function importDiff(ctx: FlightContext, text: string): ImportResult & { aux: BfAuxCondition[] } {
    const r = parseBetaflightDiff(text);
    if (r.errors.length || (!r.rates && !r.pid)) return { ok: false, errors: r.errors.length ? r.errors : ['nothing to import'], warnings: r.warnings, aux: [] };
    const store = ctx.prefs;
    const at = { drone: droneOf(store) };
    const warnings = [...r.warnings];
    const put = (id: string, v: unknown): void => {
        const s = pilotSet(store, id, v, at);
        if (!s.ok) warnings.push(`${id}: not stored (${s.reason})`);
        else if (s.clamped) warnings.push(`${id}: adjusted into the simulator's range`);
    };
    // copyRates keeps quickrates_rc_expo with QUICK (and only there)
    if (r.rates) put('tune.rates', copyRates(r.rates));
    if (r.pid) put('tune.pid', { roll: [...r.pid.roll], pitch: [...r.pid.pitch], yaw: [...r.pid.yaw] });
    if (r.throttle) put('tune.throttle', { mid: r.throttle.mid, expo: r.throttle.expo });
    ctx.clearCrash();
    applyModel(ctx.session, store);
    const v = r.firmware.version;
    return { ok: true, firmware: v ? `${r.firmware.name ?? 'Betaflight'} ${v.major}.${v.minor}.${v.patch}` : null, ratesType: r.rates?.type, warnings, aux: r.aux };
}

/**
 * The radio's profile with a diff's switches laid over its own (importOver: ARM / ANGLE / HORIZON
 * replaced, the simulator's function switches kept), and what that did. Exported for the Node tests.
 */
export function withDiffSwitches(profile: Profile, aux: readonly BfAuxCondition[]): { profile: Profile; over: ImportOver } {
    const over = importOver(profile.switches, switchesFromBetaflight(aux).switches);
    return { profile: { ...profile, switches: over.switches }, over };
}

/**
 * The diff's ARM / ANGLE / HORIZON switches under an import's answer: a button puts them on the radio
 * in use (saved for it, flown at once); without a radio the line says where to paste them later.
 */
function switchesOffer(ctx: FlightContext, aux: readonly BfAuxCondition[], out: HTMLElement): void {
    const imp = switchesFromBetaflight(aux);
    if (!imp.applied.length) return;
    const list = imp.applied.map((c, i) => `${c.mode} CH${channelOf(imp.switches.ranges[i].input)} ${c.lo}–${c.hi}`).join(', ');
    const radio = ctx.input.radioInUse();
    if (!radio?.profile) { out.append(h('p', { class: 'muted' }, t('switches.diffNoRadio', { list }))); return; }
    const name = radio.profile.deviceName;
    const line = h('p', {}, t('switches.diffFound', { list }));
    const device = radio.kind === 'gamepad' ? 'gamepad' : 'hid';
    const use = h('button', { type: 'button', class: 'btn', 'data-action': 'import-switches', onclick: () => {
        const { profile: p, over } = withDiffSwitches(radio.profile!, aux);
        if (!ctx.input.replaceProfile(p)) return;
        use.remove();
        line.textContent = t('switches.diffApplied', { name });
        for (const n of importOverNotes(over, (i) => inputLabel(i, device))) out.append(h('p', { class: 'muted' }, n));
    } }, t('switches.diffApply', { name }));
    out.append(line, use);
}

function openImport(ctx: FlightContext): void {
    ctx.pause('panel');
    const p = panel(t('import.title'), () => { p.close(); ctx.resume('panel'); });
    const area = h('textarea', { class: 'import-text', rows: 10, spellcheck: 'false', 'aria-label': t('import.title'), placeholder: '# version … Betaflight / STM32F405 (S405) 4.5.1 …' }) as HTMLTextAreaElement;
    const out = h('div', { class: 'import-out', role: 'status', 'aria-live': 'polite' });
    const apply = h('button', { type: 'button', class: 'btn primary', 'data-action': 'import-apply', onclick: () => {
        const r = importDiff(ctx, area.value);
        clear(out);
        out.append(h('p', {}, r.ok ? t('import.ok', { fw: r.firmware ?? '?', type: r.ratesType ?? '—', w: String(r.warnings?.length ?? 0) }) : t('import.refused', { msg: (r.errors ?? []).join(' · ') })));
        // every warning in full: a success with warnings must not read as a clean success
        if (r.warnings?.length) out.append(h('ul', { class: 'import-warnings' }, ...r.warnings.map((w) => h('li', {}, w))));
        if (r.ok) switchesOffer(ctx, r.aux, out);
    } }, t('import.apply'));
    p.body.append(h('p', { class: 'muted' }, t('import.hint')), area, apply, out);
    ctx.ui.append(p.root);
    area.focus();
}

export const betaflightImport: Feature = {
    id: 'betaflight-import',
    install(ctx) {
        ctx.hook.importDiff = (text) => importDiff(ctx, text);
        ctx.menu.add({ id: 'pause.import', action: null, labelKey: 'pause.import', order: 90, section: 'tools', run: () => openImport(ctx) });
    }
};

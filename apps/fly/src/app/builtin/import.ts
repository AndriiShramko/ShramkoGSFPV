// The menu's "Import Betaflight diff" (phase D): rates, PID and throttle curve from a Betaflight CLI
// diff become the tune of the drone flown, stored for that drone (tune.rates / tune.pid /
// tune.throttle; W2-1, review finding C10: v0.2 put them into one set of overrides that the next
// drone inherited and a reload forgot), then a new flight model from the store; every warning is
// shown in full.
import { parseBetaflightDiff } from '@gsfpv/sim-core';
import { h, clear, panel } from '../../ui/dom';
import { t } from '../../i18n';
import { applyModel, droneOf, pilotSet } from '../prefs';
import type { TestHook } from '../test-hook';
import type { Feature, FlightContext } from '../context';

type ImportResult = ReturnType<NonNullable<TestHook['importDiff']>>;

function importDiff(ctx: FlightContext, text: string): ImportResult {
    const r = parseBetaflightDiff(text);
    if (r.errors.length || (!r.rates && !r.pid)) return { ok: false, errors: r.errors.length ? r.errors : ['nothing to import'], warnings: r.warnings };
    const store = ctx.prefs;
    const at = { drone: droneOf(store) };
    const warnings = [...r.warnings];
    const put = (id: string, v: unknown): void => {
        const s = pilotSet(store, id, v, at);
        if (!s.ok) warnings.push(`${id}: not stored (${s.reason})`);
        else if (s.clamped) warnings.push(`${id}: adjusted into the simulator's range`);
    };
    if (r.rates) put('tune.rates', { type: r.rates.type, roll: { ...r.rates.roll }, pitch: { ...r.rates.pitch }, yaw: { ...r.rates.yaw }, rateLimit: r.rates.rateLimit });
    if (r.pid) put('tune.pid', { roll: [...r.pid.roll], pitch: [...r.pid.pitch], yaw: [...r.pid.yaw] });
    if (r.throttle) put('tune.throttle', { mid: r.throttle.mid, expo: r.throttle.expo });
    ctx.clearCrash();
    applyModel(ctx.session, store);
    const v = r.firmware.version;
    return { ok: true, firmware: v ? `${r.firmware.name ?? 'Betaflight'} ${v.major}.${v.minor}.${v.patch}` : null, ratesType: r.rates?.type, warnings };
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

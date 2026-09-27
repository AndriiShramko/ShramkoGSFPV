// /fly entry. The page is composed in app/ (docs/architecture-v03.md 1.1): boot.ts (browser
// checks, first-visit warning, scene picker) -> flight.ts (scan, FlightContext, features.ts).
// URL: ?scene=<id|link>&drone=<preset>&g=<m/s2>&gm=<honest|same-twr|auto-throttle>
// Test-only switches (never linked): ?simradio=scenario|open|raw, ?lat=1, ?lagFrames=N (app/test-modes.ts).
import { t } from './i18n';
import { h, clear } from './ui/dom';
import { boot } from './app/boot';
import { hook } from './app/test-hook';

const ui = document.getElementById('ui')!;
const canvas = document.getElementById('view') as HTMLCanvasElement;
document.title = t('app.title');

boot(ui, canvas).catch((e) => {
    hook.status = 'error';
    hook.error = String(e?.message ?? e);
    clear(ui);
    ui.append(h('div', { class: 'center-msg' }, h('div', { class: 'error' }, hook.error)));
    console.error(e);
});

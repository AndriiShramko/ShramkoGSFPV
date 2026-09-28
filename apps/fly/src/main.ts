// /fly entry: preflight -> scene picker -> flight. The page is composed in app/
// (docs/architecture-v03.md 1.1):
//   app/boot.ts       browser checks, the first-visit warning, the scene picker
//   app/flight.ts     the scan behind the loading screen, the FlightContext, the input
//   app/features.ts   every feature of the flight page (app/builtin/*), one line each
//   app/keys.ts       the one keydown router over the keymap of @gsfpv/prefs
//   app/test-hook.ts  window.__gsfpv for the acceptance harnesses
// URL: ?scene=<id|link>&drone=<preset>&g=<m/s2>&gm=<honest|same-twr|auto-throttle>
// Test-only switches (never linked, app/test-modes.ts): ?simradio=scenario|open|raw, ?lat=1,
// ?lagFrames=N, ?guard=0, ?refine=auto|offer|off (finer walls: the plan's choice, only on request,
// never), ?bake=1, ?walls=on|off (this load only, not remembered), ?voxels=overlay|only
// &vstyle=solid|wire|height|floaters&vopacity=0..1&vradius=m (the voxel grid for screenshots and
// checks; nothing remembered), ?render=off (logic only: the scan is not drawn; machines without a GPU).
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

// Settings (docs/architecture-v03.md A.7-A.9; owner's items 12, 13, 20; defects D-b, D-h): the screen
// generated from the prefs schema (ui/settings/screen.ts), its four ways in (the pause menu's
// "Settings", the gear next to Controls and Pause, O, and the deep link ?open=settings&focus=<id> of
// the site's catalogue, also at the scene picker), and the store as the one source of what the
// flight uses:
//  - at the flight's start the store's drone, flight model and camera go on the session (a reload, a
//    new scan or a visit days later flies what the pilot set: item 20);
//  - 'live' settings follow the store at once (camera, HUD, quality, reduced motion, frame stats, the
//    voxel look), whoever changed it: the screen, a key, an import, another tab;
//  - 'life' settings (the flight model, the walls) wait in the store while the screen is open and go
//    on the flight once, when it closes: one new flight model where the craft is (A.7), not the spawn.
// Opening and closing the screen changes nothing by itself (D-b); FOV and uptilt never touch the
// flight model (D-h).
import type { PrefChange, PrefsStore } from '@gsfpv/prefs';
import { SettingsScreen } from '../../ui/settings/screen';
import { dialogOpen } from '../../devices/keyboard';
import { loadVoxelPrefs } from '../../voxels';
import { t } from '../../i18n';
import { banner, q } from '../env';
import { applyCamera, applyModel, bridgeVoxels, modelDiffers, pilotSet } from '../prefs';
import { floatersRow } from './floaters';
import type { Feature, FlightContext } from '../context';

let current: SettingsScreen | null = null;

/** Is the settings screen up? */
export function settingsOpen(): boolean {
    return !!current?.isOpen;
}

/** The deep link opens the screen once: closing it takes ?open= and ?focus= out of the address bar. */
function forgetDeepLink(): void {
    try {
        const u = new URL(location.href);
        if (!u.searchParams.has('open') && !u.searchParams.has('focus')) return;
        u.searchParams.delete('open');
        u.searchParams.delete('focus');
        history.replaceState(history.state, '', u);
    } catch {
        /* no history */
    }
}

/** The page's language changed in Settings: the page reloads in it (A.7 'reload'). */
function reloadForLanguage(store: PrefsStore): void {
    store.flush();
    const v = store.get<string>('ui.language');
    const lang = v === 'en' || v === 'es' || v === 'pl' || v === 'ru' ? v : browserLocale();
    if (/^\/(en|es|pl|ru)\//.test(location.pathname)) location.pathname = location.pathname.replace(/^\/(en|es|pl|ru)\//, `/${lang}/`);
    else location.reload();
}

/** The browser's language among ours (the same choice as i18n.ts when no cookie is set). */
function browserLocale(): 'en' | 'es' | 'pl' | 'ru' {
    for (const l of navigator.languages ?? [navigator.language]) {
        const b = l.slice(0, 2).toLowerCase();
        if (b === 'es' || b === 'pl' || b === 'en') return b;
        if (b === 'ru' || b === 'uk' || b === 'be') return 'ru';
    }
    return 'en';
}

/**
 * Everything the flight takes from the store when the screen closes, or when the flight starts:
 * the drone and its flight model (one new model, where the craft is). The walls follow the store by
 * themselves (app/walls.ts). true when the flight model changed.
 */
function applyToFlight(ctx: FlightContext): boolean {
    const store = ctx.prefs;
    let changed = false;
    if (modelDiffers(ctx.session, store)) {
        // a new flight model: a crash on screen belongs to the old one
        ctx.clearCrash();
        changed = applyModel(ctx.session, store);
    }
    applyCamera(ctx.session, store);
    return changed;
}

/**
 * One screen at a time: the drone picker and the panels opened from the pause menu share the
 * 'panel' pause with Settings, so one of them closing would start the flight under the other. The
 * gear reaches Settings from over them: they close first (each keeps what it had), then Settings opens.
 */
function makeRoom(ctx: FlightContext): void {
    ctx.ui.querySelector<HTMLButtonElement>('[data-action="drone-close"]')?.click();
    for (const x of Array.from(ctx.ui.querySelectorAll<HTMLButtonElement>('.panel:not(.pause-menu):not(.settings) .panel-x'))) x.click();
}

/** Opens the screen in flight (paused while it is up); `focus`: the setting whose row gets the focus. */
export function openSettings(ctx: FlightContext, focus: string | null = null): void {
    if (current?.isOpen) {
        if (focus) current.focusRow(focus);
        return;
    }
    makeRoom(ctx);
    const menuUp = ctx.menu.isOpen;
    ctx.pause('panel');
    // the gear over the pause menu: Settings takes the pause over, the menu goes
    if (menuUp) ctx.menu.close();
    current = new SettingsScreen(ctx.ui, {
        store: ctx.prefs,
        scene: { id: ctx.scene.id, title: ctx.scene.meta?.title },
        caps: (a) => ctx.keys.caps(a),
        // the import panel has a pause of its own: settings closes first (its changes are in the store)
        importBetaflight: () => {
            current?.close();
            ctx.menu.items().find((i) => i.id === 'pause.import')?.run();
        },
        reload: (id) => { if (id === 'ui.language') reloadForLanguage(ctx.prefs); else location.reload(); },
        onClose: () => {
            current = null;
            forgetDeepLink();
            applyToFlight(ctx);
            ctx.resume('panel');
        },
        extra: (id) => (id === 'scene.dropFloaters' ? floatersRow(ctx, () => current?.close()) : null)
    }, { focus });
}

/** The page's storage cannot keep anything (private window, blocked or full): one banner says so (A.5). */
export function storageBanner(ui: HTMLElement, store: PrefsStore): void {
    if (!store.writable && !ui.querySelector('.banner[data-kind="prefs-blocked"]')) banner(ui, t('prefs.storage.blocked'), 'prefs-blocked');
}

/**
 * The site catalogue's link at the scene picker (/{locale}/fly/?open=settings&focus=<id>, no scan
 * yet): the screen opens over the picker; per-scan rows say a scan is needed. The flight takes the
 * store's values when it starts.
 */
export function openSettingsLink(ui: HTMLElement, store: PrefsStore): void {
    if (q.get('open') !== 'settings' || current?.isOpen) return;
    current = new SettingsScreen(ui, {
        store,
        scene: null,
        reload: (id) => { if (id === 'ui.language') reloadForLanguage(store); else location.reload(); },
        onClose: () => {
            current = null;
            forgetDeepLink();
        }
    }, { focus: q.get('focus') });
}

/** The F3 line (display.frameStats) on the OSD as the store says. */
function showFrameStats(ctx: FlightContext, on: boolean): void {
    const el = ctx.ui.querySelector('.hud .osd.frame');
    if (el && el.classList.contains('hidden') === on) ctx.hud.toggleFrameStats();
}

/** The reduced-motion setting as the crash camera uses it: 'system' follows the OS. */
function reducedMotion(v: string): boolean {
    if (v === 'on') return true;
    if (v === 'off') return false;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const settings: Feature = {
    id: 'settings',
    install(ctx) {
        const store = ctx.prefs;
        // the start: what the store says, not what the link alone said (item 20; the craft is parked at the spawn)
        applyToFlight(ctx);
        // a scene switched in the page (E.4): the same for the new session (the host carried most of it already)
        const offSession = ctx.events.on('session', () => applyToFlight(ctx));
        ctx.hud.visible = store.get<boolean>('display.hud');
        ctx.crash.reducedMotion = reducedMotion(store.get<string>('display.reducedMotion'));
        // quality: only a pilot's (or a link's) value; untouched, the app's own ceiling stays (a bench's ?scale=)
        if (store.isExplicit('display.quality') || store.get('display.quality') !== store.defaultOf('display.quality')) ctx.quality.setUser(store.get<number>('display.quality'));
        showFrameStats(ctx, store.get<boolean>('display.frameStats'));
        const offVoxels = bridgeVoxels(store, ctx.voxels, loadVoxelPrefs);

        // 'live': on screen at once, whoever changed the store
        const offStore = store.onChange((c: PrefChange) => {
            if (c.id.startsWith('camera.')) applyCamera(ctx.session, store);
            else if (c.id === 'display.hud') ctx.hud.visible = store.get<boolean>('display.hud');
            else if (c.id === 'display.quality') ctx.quality.setUser(store.get<number>('display.quality'));
            else if (c.id === 'display.reducedMotion') ctx.crash.reducedMotion = reducedMotion(store.get<string>('display.reducedMotion'));
            else if (c.id === 'display.frameStats') showFrameStats(ctx, store.get<boolean>('display.frameStats'));
        });

        ctx.menu.add({ id: 'pause.settings', action: 'settings.open', labelKey: 'pause.settings', order: 60, section: 'setup', run: () => openSettings(ctx) });
        const offO = ctx.keys.on('settings.open', (e) => {
            if (e.repeat) return;
            if (current?.isOpen) current.close();
            else if (!dialogOpen()) openSettings(ctx);
        });
        // F3 is display.frameStats' key: the store keeps it (a reload keeps the line), the OSD follows the store
        const offF3 = ctx.keys.on('frameStats.toggle', (e) => {
            e.preventDefault();
            if (e.repeat) return;
            pilotSet(store, 'display.frameStats', !store.get<boolean>('display.frameStats'));
        });
        if (q.get('open') === 'settings') openSettings(ctx, q.get('focus'));
        return () => {
            offSession();
            offVoxels();
            offStore();
            offO();
            offF3();
            current?.close();
        };
    }
};

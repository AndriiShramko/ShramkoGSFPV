// Before a flight: what the browser cannot do (WebGPU, WebHID), the page's preferences store
// (app/prefs.ts: opened once, the v0.2 keys migrated at the first v0.3 boot), the first-visit
// warning, the scene from the link or the scene picker; a scan that fails to load comes back to the
// picker with its error.
import { flyQueryString, parseSceneLink, sceneRender, writeSceneQuery } from '@gsfpv/scenes';
import { ScenePicker, loadCatalog } from '../ui/scenes';
import type { PickSource } from '../ui/picker-tabs';
import { warningModal } from '../ui/panels';
import { t } from '../i18n';
import { banner, beacon, hasHid, hasWebGPU, q } from './env';
import { hook } from './test-hook';
import { fly } from './flight';
import { mirrorWarned, openPagePrefs, prefsHook } from './prefs';
import { openSettingsLink, storageBanner } from './builtin/settings';
import { useStoreLibrary } from './scene-host';
import { pageRender } from './drawing';

export async function boot(ui: HTMLElement, canvas: HTMLCanvasElement): Promise<void> {
    if (!hasWebGPU) banner(ui, t('banner.noWebgpu'), 'no-webgpu');
    else if (!hasHid) banner(ui, t('banner.noHid'), 'no-hid');
    // the owner's published catalogue (/api/catalog), else the release's static list
    const catalog = await loadCatalog();
    const showcase = catalog.scenes;
    // the curated scans are the store's per-scan defaults (the walls switch), so it opens after them
    const prefs = openPagePrefs(showcase, q.toString());
    hook.prefs = prefsHook(prefs);
    // E.1: history, favourites and the filter live in the store from here on (the picker reads them)
    useStoreLibrary(prefs);
    // W2-1: blocked storage says so once (A.5); the catalogue's ?open=settings opens over the picker
    storageBanner(ui, prefs);
    let picker: ScenePicker | null = null;

    function showPicker(errorCode: string | null, msg?: string): void {
        picker?.remove();
        picker = new ScenePicker(ui, showcase, catalog.collections);
        picker.onPick = (raw, src) => go(raw, src);
        if (errorCode) picker.showError(errorCode, msg);
        hook.status = 'picker';
        hook.errorCode = errorCode ?? undefined;
    }

    /**
     * Open a scene from a pasted text, a card or the page's link. `page`: the text is the page's own
     * ?scene=, so the page's ?budget= and ?stochastic count for it too (over the pasted link's own);
     * the address becomes the deep link /fly/?scene=<id>&budget=<M>&stochastic (v0.7 lane R).
     */
    function go(raw: string, source: PickSource, page = false): void {
        const link = parseSceneLink(raw);
        if (!link) {
            hook.errorCode = 'invalid-link';
            showPicker('invalid-link');
            return;
        }
        const render = page ? sceneRender(pageRender, link.render) : link.render;
        const u = new URL(location.href);
        writeSceneQuery(u.searchParams, link.id, render);
        u.search = flyQueryString(u.searchParams);
        history.replaceState(null, '', u);
        beacon('scene_open', { source });
        picker?.remove();
        void fly(ui, canvas, render ? { id: link.id, render } : { id: link.id }, showcase, prefs, (code, msg) => showPicker(code, msg), catalog.collections);
    }

    let first = true;
    try { first = localStorage.getItem('gsfpv.warned') !== '1'; } catch { first = true; }
    const sceneParam = q.get('scene');
    const start = (): void => {
        if (sceneParam) go(sceneParam, 'paste', true);
        else {
            showPicker(null);
            openSettingsLink(ui, prefs);
        }
    };
    if (first && !q.get('simradio') && q.get('lat') !== '1' && q.get('nowarn') !== '1') {
        warningModal(ui, () => { try { localStorage.setItem('gsfpv.warned', '1'); } catch { /* ignore */ } mirrorWarned(prefs); start(); });
    } else start();
}

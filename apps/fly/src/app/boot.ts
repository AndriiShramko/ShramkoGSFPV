// Before a flight: what the browser cannot do (WebGPU, WebHID), the first-visit warning, the scene
// from the link or the scene picker; a scan that fails to load comes back to the picker with its
// error.
import { parseSceneInput } from '@gsfpv/scenes';
import { ScenePicker, loadShowcase } from '../ui/scenes';
import { warningModal } from '../ui/panels';
import { t } from '../i18n';
import { banner, beacon, hasHid, hasWebGPU, q } from './env';
import { hook } from './test-hook';
import { fly } from './flight';

export async function boot(ui: HTMLElement, canvas: HTMLCanvasElement): Promise<void> {
    if (!hasWebGPU) banner(ui, t('banner.noWebgpu'), 'no-webgpu');
    else if (!hasHid) banner(ui, t('banner.noHid'), 'no-hid');
    const showcase = await loadShowcase();
    let picker: ScenePicker | null = null;

    function showPicker(errorCode: string | null, msg?: string): void {
        picker?.remove();
        picker = new ScenePicker(ui, showcase);
        picker.onPick = (raw, src) => go(raw, src);
        if (errorCode) picker.showError(errorCode, msg);
        hook.status = 'picker';
        hook.errorCode = errorCode ?? undefined;
    }

    function go(raw: string, source: 'showcase' | 'paste' | 'history'): void {
        const id = parseSceneInput(raw);
        if (!id) {
            hook.errorCode = 'invalid-link';
            showPicker('invalid-link');
            return;
        }
        const u = new URL(location.href);
        u.searchParams.set('scene', id);
        history.replaceState(null, '', u);
        beacon('scene_open', { source });
        picker?.remove();
        void fly(ui, canvas, id, showcase, (code, msg) => showPicker(code, msg));
    }

    let first = true;
    try { first = localStorage.getItem('gsfpv.warned') !== '1'; } catch { first = true; }
    const sceneParam = q.get('scene');
    const start = (): void => {
        if (sceneParam) go(sceneParam, 'paste');
        else showPicker(null);
    };
    if (first && !q.get('simradio') && q.get('lat') !== '1' && q.get('nowarn') !== '1') {
        warningModal(ui, () => { try { localStorage.setItem('gsfpv.warned', '1'); } catch { /* ignore */ } start(); });
    } else start();
}

// Before the flight: what the browser lacks (banners), the first-visit warning, the scene picker
// or the ?scene= link, then the flight (flight.ts).
import { parseSceneInput } from '@gsfpv/scenes';
import { h } from '../ui/dom';
import { ScenePicker, loadShowcase } from '../ui/scenes';
import type { ShowcaseScene } from '../ui/scenes';
import { warningModal } from '../ui/panels';
import { t } from '../i18n';
import { beacon, hasHid, hasWebGPU, q } from './env';
import { fly } from './flight';
import { hook } from './test-hook';

export async function boot(ui: HTMLElement, canvas: HTMLCanvasElement): Promise<void> {
    let picker: ScenePicker | null = null;

    function banner(text: string, kind: string): void {
        ui.append(h('div', { class: 'banner', role: 'note', 'data-testid': 'banner', 'data-kind': kind }, text));
    }

    function showPicker(showcase: ShowcaseScene[], errorCode: string | null, msg?: string): void {
        picker?.remove();
        picker = new ScenePicker(ui, showcase);
        picker.onPick = (raw, src) => go(raw, src, showcase);
        if (errorCode) picker.showError(errorCode, msg);
        hook.status = 'picker';
        hook.errorCode = errorCode ?? undefined;
    }

    function go(raw: string, source: 'showcase' | 'paste' | 'history', showcase: ShowcaseScene[]): void {
        const id = parseSceneInput(raw);
        if (!id) {
            hook.errorCode = 'invalid-link';
            showPicker(showcase, 'invalid-link');
            return;
        }
        const u = new URL(location.href);
        u.searchParams.set('scene', id);
        history.replaceState(null, '', u);
        beacon('scene_open', { source });
        picker?.remove();
        void fly(ui, canvas, id, showcase, (code, msg) => showPicker(showcase, code, msg));
    }

    if (!hasWebGPU) banner(t('banner.noWebgpu'), 'no-webgpu');
    else if (!hasHid) banner(t('banner.noHid'), 'no-hid');
    const showcase = await loadShowcase();
    let first = true;
    try { first = localStorage.getItem('gsfpv.warned') !== '1'; } catch { first = true; }
    const sceneParam = q.get('scene');
    const start = () => {
        if (sceneParam) go(sceneParam, 'paste', showcase);
        else showPicker(showcase, null);
    };
    if (first && !q.get('simradio') && q.get('lat') !== '1' && q.get('nowarn') !== '1') {
        warningModal(ui, () => { try { localStorage.setItem('gsfpv.warned', '1'); } catch { /* ignore */ } start(); });
    } else start();
}

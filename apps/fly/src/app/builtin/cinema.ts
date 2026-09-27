// Phase D: cinema mode (full detail, no OSD) and the recorder with the scene's credit burnt in.
// Recording is only for showcase scenes, whose licence and credit are known.
import type { CinemaRecorder, RecorderInfo } from '../../cinema';
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { q } from '../env';
import type { Feature } from '../context';
import type { TestHook } from '../test-hook';

export const cinema: Feature = {
    id: 'cinema',
    install(ctx) {
        const { id: sceneId, meta } = ctx.scene;
        const canvas = ctx.canvas;
        const renderer = ctx.renderer;
        const credit = meta ? `${meta.title} — ${meta.author}, ${meta.license} · gsfpv.flyreelstudio.eu` : '';
        let on = false;
        let recorder: CinemaRecorder | null = null;
        const recBtn = h('button', { type: 'button', class: 'btn rec', 'data-action': 'cinema-rec', hidden: true, onclick: () => void (recorder?.recording ? stopRec() : startRec()) }, t('cinema.rec')) as HTMLButtonElement;
        const note = h('div', { class: 'cinema-note', role: 'status', 'data-testid': 'cinema-note', hidden: true });
        ctx.ui.append(h('div', { class: 'cinema-bar interactive' }, recBtn, note));
        renderer.app.on('frameend', () => { if (recorder?.recording) recorder.addFrame(canvas, performance.now()); });

        function toggle(): void {
            on = !on;
            document.body.classList.toggle('cinema', on);
            renderer.setDetail(on ? 'final' : 'auto');
            ctx.events.emit('cinema', { on });
            recBtn.hidden = !on || !meta;
            note.hidden = !on;
            note.textContent = on ? (meta ? t('cinema.on') : t('cinema.noRec')) : '';
            if (!on && recorder?.recording) void stopRec();
        }
        async function startRec(): Promise<string> {
            if (!meta) throw new Error('recording is only for showcase scenes');
            const { CinemaRecorder } = await import('../../cinema');
            if (!CinemaRecorder.supported) { note.textContent = t('cinema.unsupported'); throw new Error('WebCodecs unavailable'); }
            recorder = new CinemaRecorder(canvas.width, canvas.height, credit);
            const codec = await recorder.start();
            recBtn.textContent = t('cinema.stop');
            recBtn.classList.add('on');
            return codec;
        }
        async function stopRec(): Promise<RecorderInfo | null> {
            if (!recorder) return null;
            const { bytes, info } = await recorder.stop();
            recBtn.textContent = t('cinema.rec');
            recBtn.classList.remove('on');
            hookCinema.last = info;
            hookCinema.lastBytes = bytes;
            note.textContent = t('cinema.saved', { s: info.seconds.toFixed(1), mb: (info.bytes / 1048576).toFixed(1) });
            if (!q.get('simradio')) {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }));
                a.download = `gsfpv-${sceneId}-${Date.now()}.mp4`;
                a.click();
            }
            return info;
        }
        const hookCinema: NonNullable<TestHook['cinema']> = { on: () => on, toggle, canRecord: !!meta, start: startRec, stop: stopRec, last: null, lastBytes: null, creditStripStd: () => recorder?.lastCreditStripStd ?? 0 };
        ctx.hook.cinema = hookCinema;

        ctx.menu.add({ id: 'pause.cinema', action: null, labelKey: 'pause.cinema', order: 100, section: 'tools', run: toggle });
    }
};

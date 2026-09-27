// Cinema mode (phase D): full detail with the governor off, a Record button for showcase scenes
// (their credit burnt into the video), the bar at the bottom middle; the menu's "Cinema mode".
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { q } from '../env';
import type { CinemaRecorder, RecorderInfo } from '../../cinema';
import type { TestHook } from '../test-hook';
import type { Feature } from '../context';

export const cinema: Feature = {
    id: 'cinema',
    install(ctx) {
        const { canvas, ui } = ctx;
        const meta = ctx.scene.meta;
        const credit = meta ? `${meta.title} — ${meta.author}, ${meta.license} · gsfpv.flyreelstudio.eu` : '';
        let recorder: CinemaRecorder | null = null;
        const recBtn = h('button', { type: 'button', class: 'btn rec', 'data-action': 'cinema-rec', hidden: true, onclick: () => void (recorder?.recording ? stopRec() : startRec()) }, t('cinema.rec')) as HTMLButtonElement;
        const cinemaNote = h('div', { class: 'cinema-note', role: 'status', 'data-testid': 'cinema-note', hidden: true });
        const cinemaBar = h('div', { class: 'cinema-bar interactive' }, recBtn, cinemaNote);
        ui.append(cinemaBar);
        // the arm hint (Hud's gate line) stacks above the bar (fly.css body.cinema .gate-msg): it was
        // printed under the Record button. The bar's height changes with its note, its place with touch
        const placeOverCinema = (): void => {
            if (!ctx.quality.cinema) return;
            const top = cinemaBar.getBoundingClientRect().top;
            const v = `${Math.max(0, Math.round(innerHeight - top))}px`;
            if (ui.style.getPropertyValue('--cinema-top') !== v) ui.style.setProperty('--cinema-top', v);
        };
        new ResizeObserver(placeOverCinema).observe(cinemaBar);
        addEventListener('resize', placeOverCinema);
        ctx.session.renderer.app.on('frameend', () => { if (recorder?.recording) recorder.addFrame(canvas, performance.now()); });
        function toggleCinema(): void {
            const on = !ctx.quality.cinema;
            document.body.classList.toggle('cinema', on);
            ctx.quality.setCinema(on);
            ctx.session.renderer.setDetail(on ? 'final' : 'auto');
            ctx.quality.apply();
            recBtn.hidden = !on || !meta;
            cinemaNote.hidden = !on;
            cinemaNote.textContent = on ? (meta ? t('cinema.on') : t('cinema.noRec')) : '';
            if (!on && recorder?.recording) void stopRec();
            placeOverCinema();
        }
        async function startRec(): Promise<string> {
            if (!meta) throw new Error('recording is only for showcase scenes');
            const { CinemaRecorder } = await import('../../cinema');
            if (!CinemaRecorder.supported) { cinemaNote.textContent = t('cinema.unsupported'); throw new Error('WebCodecs unavailable'); }
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
            cinemaNote.textContent = t('cinema.saved', { s: info.seconds.toFixed(1), mb: (info.bytes / 1048576).toFixed(1) });
            if (!q.get('simradio')) {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }));
                a.download = `gsfpv-${ctx.scene.id}-${Date.now()}.mp4`;
                a.click();
            }
            return info;
        }
        const hookCinema: NonNullable<TestHook['cinema']> = { on: () => ctx.quality.cinema, toggle: toggleCinema, canRecord: !!meta, start: startRec, stop: stopRec, last: null, lastBytes: null, creditStripStd: () => recorder?.lastCreditStripStd ?? 0 };
        ctx.hook.cinema = hookCinema;
        ctx.menu.add({ id: 'pause.cinema', action: null, labelKey: 'pause.cinema', order: 100, section: 'tools', run: toggleCinema });
    }
};

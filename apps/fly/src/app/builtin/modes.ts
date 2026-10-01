// Flight modes on the page (docs/architecture-v03.md B.2-B.4, C.3 page side; the owner's items 15
// and 23). The pilot's mode is the setting flight.mode: global, angle by default for everyone,
// kept across scenes and visits (the store), and Controls puts it on ch[5] unless the radio's mode
// switch decides. The HUD chip shows the mode flying and picks another; M cycles acro, angle,
// horizon for every input (with a radio whose switch decides, it says so instead). The arm gate
// follows respawn.keepArmed (owned by the respawn feature, read here by id; on by default), so a
// switch left on through a crash arms the respawned craft with no new flip.
import { isFlightMode } from '@gsfpv/input';
import type { FlightMode } from '@gsfpv/sim-core';
import { ModeChip, CHIP_MODES } from '../../ui/mode-chip';
import { t } from '../../i18n';
import type { Feature, FlightContext } from '../context';

/** The radio input that decides the mode, as the pilot reads it on the radio ("CH6"), or null. */
function radioSwitch(ctx: FlightContext): string | null {
    const c = ctx.controls;
    if (!c.radioDecides()) return null;
    const ms = c.profile?.modeSwitch;
    if (ms) return ms.input.kind === 'axis' ? t('wizard.armSource.ch', { n: ms.input.index + 1 }) : t('wizard.armSource.button', { n: ms.input.bit + 1 });
    const a = c.profile?.angleMode;
    return a?.kind === 'axis' ? t('wizard.armSource.ch', { n: a.index + 1 }) : a?.kind === 'button' ? t('wizard.armSource.button', { n: a.bit + 1 }) : '';
}

export const modes: Feature = {
    id: 'modes',
    install(ctx) {
        const prefs = ctx.prefs;
        const mode = (): FlightMode => {
            const v = prefs.get('flight.mode');
            return isFlightMode(v) ? v : 'angle';
        };
        const keepArmed = (): boolean => prefs.get('respawn.keepArmed') !== false;
        ctx.controls.setMode(mode());
        ctx.controls.keepArmedAfterCrash = keepArmed();

        const chip = new ModeChip({
            current: () => ctx.controls.flyingMode(),
            radio: () => radioSwitch(ctx),
            // the pilot's choice: stored, and over any ?set.flight.mode= of this load (it no longer describes the flight)
            pick: (m) => { prefs.set('flight.mode', m); prefs.clearSession('flight.mode'); },
            caps: ctx.keys.caps('mode.cycle')
        });
        // in the page's order right after the OSD it sits beside (paint and focus order)
        ctx.hud.root.after(chip.el);

        const offPrefs = prefs.onChange((c) => {
            if (c.id === 'flight.mode') { ctx.controls.setMode(mode()); chip.update(); }
            else if (c.id === 'respawn.keepArmed') ctx.controls.keepArmedAfterCrash = keepArmed();
        });

        const offKey = ctx.keys.on('mode.cycle', (e) => {
            // a screen or a panel on top has its own keys; a held key does not spin through the modes
            if (e.repeat || document.querySelector('#ui .screen, #ui .panel')) return;
            const radio = radioSwitch(ctx);
            if (radio !== null) { ctx.hud.flash(t('mode.radioDecides', { src: radio }), 3000); return; }
            const next = CHIP_MODES[(CHIP_MODES.indexOf(mode()) + 1) % CHIP_MODES.length];
            prefs.set('flight.mode', next);
            prefs.clearSession('flight.mode');
            ctx.hud.flash(t('mode.now', { mode: t(`mode.${next}`) }));
        });

        // the chip follows the mode flying (a radio switch flips it too) and the OSD line it sits beside,
        // clear of the right-hand OSD line, the top buttons and the boxes and notes at the top
        const place = (): void => chip.place(ctx.ui.querySelector<HTMLElement>('.hud .osd.tl'),
            [...ctx.ui.querySelectorAll('.hud .osd.tr, .top-actions')],
            [...ctx.ui.querySelectorAll(':scope > .bake-box, .touch-hint, :scope > .voxel-legend, :scope > .banner')]);
        let last = 0;
        const offFrame = ctx.events.on('frame', ({ now }) => {
            if (now - last < 100) return;
            last = now;
            chip.update();
            place();
        });
        addEventListener('resize', place);
        // a pause (the menu, a panel, Controls, a hidden tab) closes the popover: nothing of it stays over a screen
        const offPause = ctx.events.on('pause', ({ on }) => { if (on) chip.close(); });

        return () => {
            offPrefs();
            offKey();
            offFrame();
            offPause();
            removeEventListener('resize', place);
            chip.dispose();
        };
    }
};

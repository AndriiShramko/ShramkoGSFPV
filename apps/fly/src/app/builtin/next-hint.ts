// The crash hint (v0.9 item 11, the owner's message 22): after a visitor's 3rd crash in a visit (and the 6th,
// if N was still not used) a calm line, "Want another place? Press N for the next scene". Touch screens get
// a Next scene button in it; a radio whose profile maps the next-scene function names that switch. Never
// again once N was used (app/next-used.ts), and not with scenes.autoSwitch on. The rules are
// app/next-hint-logic.ts, the widget ui/next-hint.ts; this file counts the crashes and shows and takes it away.
// It goes with the next scene, N, its close button or after HINT_MS, and never covers the crash toast or the
// crash panel (builtin/crash.ts): it has its own place at the top.
import { hasFn } from '@gsfpv/input';
import { NextHint } from '../../ui/next-hint';
import { t } from '../../i18n';
import { HINT_MS, hintDue, hintKind } from '../next-hint-logic';
import { nextUsed, onNextUsed } from '../next-used';
import type { Feature, FlightContext } from '../context';

/** The radio in use maps the next-scene function to a switch (Profile.switches, the Switches screen). */
function radioMapsNext(ctx: FlightContext): boolean {
    const sw = ctx.controls.profile?.switches;
    return !!sw && hasFn(sw, 'scene.next');
}

export const nextHint: Feature = {
    id: 'next-hint',
    install(ctx) {
        /** crashes of this visit: it counts across scene switches, the page is the visit */
        let crashes = 0;
        let hint: NextHint | null = null;
        let timer = 0;

        const hide = (): void => {
            clearTimeout(timer);
            hint?.remove();
            hint = null;
        };

        const show = (): void => {
            hide();
            const source = ctx.controls.source;
            const kind = hintKind({ source, radioSwitch: radioMapsNext(ctx) });
            const key = ctx.keys.caps('scene.next')[0]?.cap ?? 'N';
            const text = t(kind === 'touch' ? 'nexthint.touch' : kind === 'radio' ? 'nexthint.radio' : 'nexthint.key', { key });
            hint = new NextHint(ctx.ui, {
                text,
                button: kind === 'touch' ? { label: t('keys.scene.next'), run: () => void ctx.scenes.go('next') } : null,
                onClose: hide
            });
            timer = window.setTimeout(hide, HINT_MS);
        };

        const offSim = ctx.events.on('sim', (e) => {
            // a replayed crash (the crash panel's Replay) is not a new one
            if (e.type !== 'crash' || ctx.session.replaying) return;
            crashes++;
            if (hintDue({ crashes, nextUsed: nextUsed(), autoSwitch: ctx.prefs.get<boolean>('scenes.autoSwitch') === true })) show();
        });
        // a new scene is the answer to the hint; so is N, however it was pressed
        const offSession = ctx.events.on('session', hide);
        const offUsed = onNextUsed(hide);
        return () => {
            offSim();
            offSession();
            offUsed();
            hide();
        };
    }
};

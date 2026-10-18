// The chip for the scene settings a shared link brought (v0.9 lane C, item 15 of the owner's message 22):
// "Shared settings: x3, walls off - Keep / Reset". boot.ts put them into the store's visit layer for this
// scene before the flight began (app/shared-visit.ts), so the scene is flown with them and the pilot's saved
// settings are untouched. Keep stores them as his own (the same writes as setting each by hand); Reset lets
// go of them and the flight takes his own back live (the features that follow the store do the rest; the
// drone is rebuilt here). Both take the parameters out of the address bar. Changing one of the settings
// himself (a key, the Settings screen) ends its share and the chip stops naming it; with none left it goes.
// A scene switch (N, the picker, auto-switch) ends the visit: the layer is cleared, the address cleaned and
// the link's drone let go (the pilot's own comes back, as after Reset: shared-visit.ts leaveShared), so a
// reload of the next scene never inherits this one's settings.
// window.__gsfpv.sharedSettings: what stands and the two buttons' actions, for the acceptance.
import { flyQueryString, isEmptyShared, stripSharedParams } from '@gsfpv/scenes';
import type { SharedSettings } from '@gsfpv/scenes';
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { PRESETS } from '../../presets';
import { aboveStart } from '../../session/ceiling-source';
import { addSceneNote } from '../scene-notes';
import { applyModel, linkSettings } from '../prefs';
import { chipItems, endSharedVisit, keepShared, leaveShared, resetShared, sharedVisit, stillShared } from '../shared-visit';
import type { Feature } from '../context';
import './shared-settings.css';

declare module '../test-hook' {
    interface TestHook {
        /** v0.9 item 15: the settings of a shared link that stand now (null: none), and the chip's two buttons */
        sharedSettings?: { standing(): SharedSettings | null; chip(): string | null; keep(): void; reset(): void };
    }
}

/** The address without the parameters of a shared link (not the drone: forgetLinkValue takes that out, in Reset and in a scene switch). */
function cleanAddress(): void {
    try {
        const u = new URL(location.href);
        stripSharedParams(u.searchParams);
        u.search = flyQueryString(u.searchParams);
        history.replaceState(history.state, '', u);
    } catch {
        /* no history (tests): the visit is over all the same */
    }
}

export const sharedSettings: Feature = {
    id: 'shared-settings',
    install(ctx) {
        let removeChip: (() => void) | null = null;
        let text: HTMLElement | null = null;

        /** The visit of this scene, or null. */
        const mine = () => {
            const v = sharedVisit();
            return v && v.scene === ctx.scene.id ? v : null;
        };
        const standing = (): SharedSettings | null => {
            const v = mine();
            return v ? stillShared(ctx.prefs, v.scene, v.applied, linkSettings()) : null;
        };
        const words = (s: SharedSettings): string => chipItems(s, {
            droneName: (id) => (Object.hasOwn(PRESETS, id) ? PRESETS[id].name : id),
            ceilingHeight: (c) => aboveStart(ctx.session, c)
        }).map((i) => t(i.key, i.args)).join(t('shared.sep'));

        const close = (): void => {
            removeChip?.();
            removeChip = null;
            text = null;
            endSharedVisit();
        };
        const show = (): void => {
            const s = standing();
            if (!s || isEmptyShared(s)) {
                if (removeChip) close();
                return;
            }
            const label = t('shared.chip', { items: words(s) });
            if (text) {
                text.textContent = label;
                return;
            }
            text = h('span', { class: 'sn-text' }, label);
            const keep = h('button', { type: 'button', class: 'btn sn-btn', 'data-action': 'shared-keep', 'aria-label': t('shared.keep.aria'), title: t('shared.keep.aria'), onclick: () => keep_() }, t('shared.keep'));
            const reset = h('button', { type: 'button', class: 'btn sn-btn', 'data-action': 'shared-reset', 'aria-label': t('shared.reset.aria'), title: t('shared.reset.aria'), onclick: () => reset_() }, t('shared.reset'));
            const chip = h('div', { class: 'shared-chip', role: 'group', 'aria-label': t('shared.chip.aria'), 'data-testid': 'shared-chip' }, text, keep, reset);
            removeChip = addSceneNote(ctx.ui, chip);
        };

        const keep_ = (): void => {
            const v = mine();
            if (!v) return;
            keepShared(ctx.prefs, v);
            cleanAddress();
            close();
            ctx.hud.flash(t('shared.kept'), 3500);
        };
        const reset_ = (): void => {
            const v = mine();
            if (!v) return;
            resetShared(ctx.prefs, v);
            cleanAddress();
            close();
            // the drone is a 'life' setting that the store does not push by itself
            if (v.applied.drone !== undefined) applyModel(ctx.session, ctx.prefs);
            ctx.hud.flash(t('shared.reset.done'), 3500);
        };

        show();
        // a setting the pilot changes himself leaves the visit layer: the chip names what is still shared
        const offPrefs = ctx.prefs.onChange(() => { if (removeChip) show(); });
        // another scene: this visit is over (the layer cleared, the address cleaned, the link's drone let go)
        const offSession = ctx.events.on('session', () => {
            const v = sharedVisit();
            if (!v || v.scene === ctx.scene.id) return;
            const droneWasLinks = leaveShared(ctx.prefs, v);
            cleanAddress();
            close();
            // the new session was built with the drone flown; the pilot's own comes back like after Reset
            if (droneWasLinks) applyModel(ctx.session, ctx.prefs);
        });
        ctx.hook.sharedSettings = { standing, chip: () => text?.textContent ?? null, keep: keep_, reset: reset_ };
        return () => {
            offPrefs();
            offSession();
            removeChip?.();
            delete ctx.hook.sharedSettings;
        };
    }
};

// The scene flown: the credit line (a catalogue scene, or a scan whose facts the SuperSplat tab
// showed when it was picked, carries title, author and licence; a pasted scene links to its original)
// with the takedown link, the flight counted in the scene history on the first arm, and the menu's
// "Change scene" (the picker over the flight, app/scene-host.ts). sceneCredit() is what every credit
// of this scene starts from: the share picture and caption, the video's burned-in line, the notice.
import { recordFlight, sceneFacts } from '@gsfpv/scenes';
import { modeFromChannel } from '@gsfpv/sim-core';
import { h } from '../../ui/dom';
import { t, locale } from '../../i18n';
import { beacon } from '../env';
import { creditFacts } from '../../scene-facts';
import type { SceneCredit } from '../../scene-facts';
import type { Feature, FlightContext } from '../context';

/** The scene flown now: the catalogue's facts, else what the scene library knows of it, else the id. */
export function sceneCredit(ctx: Pick<FlightContext, 'scene'>): SceneCredit {
    return creditFacts(ctx.scene.id, ctx.scene.meta, sceneFacts(ctx.scene.id));
}

export const scene: Feature = {
    id: 'scene',
    install(ctx) {
        const attr = h('div', { class: 'attribution interactive', 'data-testid': 'attribution' });
        const credit = (): void => {
            const { id } = ctx.scene;
            const c = sceneCredit(ctx);
            attr.replaceChildren();
            attr.dataset.scene = id;
            if (c.author && c.license) attr.append(t('scenes.attribution', { title: c.title ?? id, author: c.author, license: c.license }), ' · ', h('a', { href: `https://superspl.at/scene/${id}`, target: '_blank', rel: 'noopener' }, 'SuperSplat'));
            else attr.append(h('a', { href: `https://superspl.at/scene/${id}`, target: '_blank', rel: 'noopener' }, t('scenes.byAuthor')));
            // takedown path: the landing's contact form opens with role "takedown" and the scene id filled in
            attr.append(' · ', h('a', { href: `/${locale}/?report=${id}#contact`, target: '_blank', rel: 'noopener', 'data-testid': 'report-scene' }, t('scenes.report')));
        };
        credit();
        ctx.ui.append(attr);
        // a scene switched in the page (E.4): its own credit; the walls line goes on it again (builtin/walls.ts)
        ctx.events.on('session', credit);

        ctx.events.on('sim', (e) => {
            // GA4 only (app/analytics.ts): the scene and the flight mode armed in; the counter keeps the bare event
            if (e.type === 'arm') { beacon('arm', {}, { scene_id: ctx.scene.id, mode: ctx.session.sim ? modeFromChannel(ctx.session.sim.ch[5]) : undefined }); recordFlight(ctx.scene.id); }
        });

        // the picker over the flight (E.4): a picked scene loads in the page, the radio stays connected
        ctx.menu.add({ id: 'pause.scene', action: null, labelKey: 'pause.scene', order: 30, section: 'scene', run: () => ctx.scenes.openPicker() });
    }
};

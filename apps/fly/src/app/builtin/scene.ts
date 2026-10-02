// The scene flown: the credit line (showcase scenes carry title, author and licence; a pasted scene
// links to its original) with the takedown link, the flight counted in the scene history on the
// first arm, and the menu's "Change scene" (the picker over the flight, app/scene-host.ts).
import { recordFlight } from '@gsfpv/scenes';
import { h } from '../../ui/dom';
import { t, locale } from '../../i18n';
import { beacon } from '../env';
import type { Feature } from '../context';

export const scene: Feature = {
    id: 'scene',
    install(ctx) {
        const attr = h('div', { class: 'attribution interactive', 'data-testid': 'attribution' });
        const credit = (): void => {
            const { id, meta } = ctx.scene;
            attr.replaceChildren();
            attr.dataset.scene = id;
            if (meta) attr.append(t('scenes.attribution', { title: meta.title, author: meta.author, license: meta.license }), ' · ', h('a', { href: `https://superspl.at/scene/${id}`, target: '_blank', rel: 'noopener' }, 'SuperSplat'));
            else attr.append(h('a', { href: `https://superspl.at/scene/${id}`, target: '_blank', rel: 'noopener' }, t('scenes.byAuthor')));
            // takedown path: the landing's contact form opens with role "takedown" and the scene id filled in
            attr.append(' · ', h('a', { href: `/${locale}/?report=${id}#contact`, target: '_blank', rel: 'noopener', 'data-testid': 'report-scene' }, t('scenes.report')));
        };
        credit();
        ctx.ui.append(attr);
        // a scene switched in the page (E.4): its own credit; the walls line goes on it again (builtin/walls.ts)
        ctx.events.on('session', credit);

        ctx.events.on('sim', (e) => {
            if (e.type === 'arm') { beacon('arm'); recordFlight(ctx.scene.id); }
        });

        // the picker over the flight (E.4): a picked scene loads in the page, the radio stays connected
        ctx.menu.add({ id: 'pause.scene', action: null, labelKey: 'pause.scene', order: 30, section: 'scene', run: () => ctx.scenes.openPicker() });
    }
};

// The scene flown: the credit line (showcase scenes carry title, author and licence; a pasted scene
// links to its original) with the takedown link, the flight counted in the scene history on the
// first arm, and the menu's "Change scene".
import { recordFlight } from '@gsfpv/scenes';
import { h } from '../../ui/dom';
import { t, locale } from '../../i18n';
import { beacon } from '../env';
import type { Feature } from '../context';

export const scene: Feature = {
    id: 'scene',
    install(ctx) {
        const { id, meta } = ctx.scene;
        const attr = h('div', { class: 'attribution interactive', 'data-testid': 'attribution' });
        if (meta) attr.append(t('scenes.attribution', { title: meta.title, author: meta.author, license: meta.license }), ' · ', h('a', { href: `https://superspl.at/scene/${id}`, target: '_blank', rel: 'noopener' }, 'SuperSplat'));
        else attr.append(h('a', { href: `https://superspl.at/scene/${id}`, target: '_blank', rel: 'noopener' }, t('scenes.byAuthor')));
        // takedown path: the landing's contact form opens with role "takedown" and the scene id filled in
        attr.append(' · ', h('a', { href: `/${locale}/?report=${id}#contact`, target: '_blank', rel: 'noopener', 'data-testid': 'report-scene' }, t('scenes.report')));
        ctx.ui.append(attr);

        ctx.events.on('sim', (e) => {
            if (e.type === 'arm') { beacon('arm'); recordFlight(ctx.scene.id); }
        });

        // the picker is another page load: the flight stays paused until the page goes
        ctx.menu.add({ id: 'pause.scene', action: null, labelKey: 'pause.scene', order: 30, section: 'scene', run: () => { ctx.pause('scene'); location.search = ''; } });
    }
};

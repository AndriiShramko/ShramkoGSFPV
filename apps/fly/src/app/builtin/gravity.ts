// S5: another world with the same motors: say what that does to thrust / weight before flying.
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import type { Feature } from '../context';

export const gravityNote: Feature = {
    id: 'gravity-note',
    install(ctx) {
        const s = ctx.session;
        const gNow = s.params.gravity;
        if (gNow > 0 && gNow < 9.8 && (s.overrides.gravityMode ?? 'honest') === 'honest') {
            const warn = h('div', { class: 'banner', role: 'note', 'data-testid': 'gravity-warning' }, t('settings.gravityWarning', { g: gNow.toFixed(2), x: (9.81 / gNow).toFixed(1) }));
            ctx.ui.append(warn);
            setTimeout(() => warn.remove(), 12000);
        }
    }
};

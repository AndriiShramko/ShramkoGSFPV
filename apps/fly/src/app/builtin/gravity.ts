// S5: another world with the same motors: say what that does to thrust / weight before flying.
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import type { Feature } from '../context';

/** How long the note stays at the top edge. */
const NOTE_MS = 12000;

export const gravityNote: Feature = {
    id: 'gravity-note',
    install(ctx) {
        const s = ctx.session;
        const g = s.params.gravity;
        if (!(g > 0 && g < 9.8 && (s.overrides.gravityMode ?? 'honest') === 'honest')) return;
        const warn = h('div', { class: 'banner', role: 'note', 'data-testid': 'gravity-warning' }, t('settings.gravityWarning', { g: g.toFixed(2), x: (9.81 / g).toFixed(1) }));
        ctx.ui.append(warn);
        setTimeout(() => warn.remove(), NOTE_MS);
    }
};

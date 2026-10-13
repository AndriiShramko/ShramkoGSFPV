// What the owner reads when the server refuses an ideas call, from lane B's answer (apps/api/admin.py,
// ideas_admin.py, service.py; the contract file apps/api/tests/ideas-admin-contract.json):
// - 503 ideas-store: ideas.json cannot be read now (nothing is lost, the server never writes over it);
//   503 ideas-disabled: the server has no ideas store. Either way only this tab is affected.
// - 409 on an e-mail (stale-draft, no-draft, too-late, not-resendable): it changed meanwhile, in another
//   tab, from Telegram or by an agent; the caller re-reads the idea and shows it as it is now.
// Anything else is shown with the server's reason.
import { t } from '../i18n';
import { ApiError } from '../api';

/** The ideas store cannot be used now (503 ideas-store / ideas-disabled), else null. */
export function storeDown(e: unknown): 'store' | 'disabled' | null {
    if (!(e instanceof ApiError) || e.status !== 503) return null;
    return e.reason === 'ideas-store' ? 'store' : e.reason === 'ideas-disabled' ? 'disabled' : null;
}

/** The e-mail (or its draft) changed on the server meanwhile: re-read the idea. */
export const changedMeanwhile = (e: unknown): boolean => e instanceof ApiError && e.status === 409;

/** The words for a refused call. */
export function refusal(e: unknown): string {
    const down = storeDown(e);
    if (down === 'store') return t('admin.ideas.down.store');
    if (down === 'disabled') return t('admin.ideas.down.disabled');
    if (changedMeanwhile(e)) return t('admin.ideas.mail.changed');
    return t('admin.ideas.error', { why: e instanceof Error ? e.message : String(e) });
}

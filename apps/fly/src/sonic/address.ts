// The address bar of a page entered through ?sonic= (v12-optin review R2): what the page reads at its next load. A shared link's
// sound settings stand in it only while they stand on the page (SonicSetup.visit): Keep, "Use my own settings" or a change of one
// of them takes it out (followVisit, from sonic/start.ts), and a lesson that opens writes its own link (lessons.ts), never the link
// it came from. The query itself is @gsfpv/scenes sonic-link.ts' (visitQuery, lessonQuery); every other parameter stays where it is.
import { parseSonicLink, visitQuery } from '@gsfpv/scenes/sonic-link';
import type { SonicSetup } from './entry';

/** Replaces the page's query by `next(the query now)`; the page's own writes it in place (no new history entry), a test's records it. */
export type AddressWriter = (next: (search: string) => string) => void;

/** The page's address bar. */
export const writeAddress: AddressWriter = (next) => {
    try {
        const u = new URL(location.href);
        u.search = next(u.search);
        history.replaceState(history.state, '', u);
    } catch {
        /* no history (a test): the address stays */
    }
};

/**
 * A shared link's sound settings for this visit: read from the page's query once, at the load (SonicSetup.setVisit); from then on the
 * address carries what of them still stands. One the link sets equal to the pilot's own, or a theme this release lacks, leaves it at
 * once, so a reload or a restored tab never brings back a setting he kept, changed or let go of.
 */
export function followVisit(setup: Pick<SonicSetup, 'setVisit' | 'onVisit'>, query: { get(name: string): string | null } | null | undefined, write: AddressWriter = writeAddress): void {
    const link = query ? parseSonicLink(query) : null;
    if (link) {
        const stands = setup.setVisit(link.sound);
        if (JSON.stringify(stands) !== JSON.stringify(link.sound)) write((search) => visitQuery(search, stands));
    }
    setup.onVisit = (visit) => write((search) => visitQuery(search, visit));
}

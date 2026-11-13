// Train 1, lane rooms: the pilot's nickname in rooms (rooms-plan.md 2.5): asked once, kept in this browser. The rule is the
// server's (apps/rooms/protocol.py clean_nick, the tracks-plan.md 2.8 rule): NFC, 2-20 characters after trimming, Unicode
// letters and digits, space and -_.' only, no '://' or 'www.', at least one letter or digit, and not one of the names that
// pretend to speak for the site. The server replaces a bad name with Pilot-NNNN, so the page checks first and says so.
// Kept under its own storage key, not in the prefs schema: the schema has no text setting (see docs/wip/rooms.md, "For the
// lead before the merge").

export const NICK_MIN = 2;
export const NICK_MAX = 20;
/** the storage key of the nickname in this browser */
export const NICK_KEY = 'gsfpv.rooms.nick';

const PUNCT = " -_.'";
/** the server's blocklist (apps/rooms/protocol.py _BLOCK), matched without case, spaces and punctuation */
const BLOCK = ['admin', 'administrator', 'moderator', 'gsfpv', 'shramko', 'system', 'official'];
const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;

/** The nickname as the server keeps it, or null when the rule refuses it. */
export function cleanNick(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const s = v.normalize('NFC').trim().replace(/ {2,}/g, ' ');
    const chars = [...s];
    if (chars.length < NICK_MIN || chars.length > NICK_MAX) return null;
    let some = false;
    for (const ch of chars) {
        if (PUNCT.includes(ch)) continue;
        if (!LETTER_OR_DIGIT.test(ch)) return null;
        some = true;
    }
    if (!some) return null;
    const low = s.toLowerCase();
    if (low.includes('://') || low.includes('www.')) return null;
    const bare = low.replace(/[ \-_.']/g, '');
    if (BLOCK.some((w) => bare.includes(w))) return null;
    return s;
}

/** The name given until the pilot picks one: 'Pilot-' and four digits (rooms-plan.md 2.5). */
export function defaultNick(random: () => number = Math.random): string {
    return `Pilot-${String(Math.floor(random() * 10000) % 10000).padStart(4, '0')}`;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** The kept nickname; a new default is made and kept when there is none or it no longer passes the rule. */
export function loadNick(store: Store | null, random: () => number = Math.random): { nick: string; asked: boolean } {
    let kept: string | null = null;
    try {
        kept = store?.getItem(NICK_KEY) ?? null;
    } catch {
        // storage blocked: a name for this page only
    }
    const ok = cleanNick(kept);
    if (ok !== null) return { nick: ok, asked: true };
    return { nick: defaultNick(random), asked: false };
}

/** Keeps a nickname that passes the rule; returns it, or null when refused. */
export function saveNick(store: Store | null, v: string): string | null {
    const ok = cleanNick(v);
    if (ok === null) return null;
    try {
        store?.setItem(NICK_KEY, ok);
    } catch {
        // storage blocked: the name holds for this page
    }
    return ok;
}

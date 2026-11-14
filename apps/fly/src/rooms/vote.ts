// Lane rooms2 (R27, docs/rooms-protocol.md "Open rooms and votes"): what key 9 does, which scan "the next scan" is, and
// what a vote message says. No DOM here: app/builtin/rooms.ts wires it, Node tests run it (tools/bench/test/rooms-open-vote.test.ts).

/** A vote message of the service. */
export interface VoteMsg {
    type: 'vote';
    state: 'open' | 'passed' | 'failed' | 'busy' | 'same' | 'wait';
    scene: { id: string };
    by?: number;
    yes?: number[];
    need?: number;
    present?: number;
    leftMs?: number;
}

/** The vote as the page keeps it (hook and panel): the open one, or null. */
export interface VoteView { scene: string; by: number; yes: number; need: number; mine: boolean }

/**
 * Key 9 (the owner's rule: fewest presses; an action that lacks its precondition fulfils it): outside a room it joins the open
 * room; in a room with an open vote this pilot has not agreed to, it agrees; else it opens the panel (propose, link, list).
 */
export function ninePress(inRoom: boolean, vote: VoteView | null): 'join' | 'agree' | 'panel' {
    if (!inRoom) return 'join';
    if (vote && !vote.mine) return 'agree';
    return 'panel';
}

/** The next scan after `current` in the catalogue's order (the author's list, the same on every page), wrapping; the
 *  first scan when `current` is not in it; null when there is no other scan. */
export function nextScan(order: readonly string[], current: string): string | null {
    const ids = order.filter((id, i) => order.indexOf(id) === i);
    const others = ids.filter((id) => id !== current);
    if (others.length === 0) return null;
    const at = ids.indexOf(current);
    return at < 0 ? others[0] : ids[(at + 1) % ids.length];
}

/** The page's view of an open vote message (null for every other state), `slot` this pilot's. */
export function voteView(m: VoteMsg, slot: number | null): VoteView | null {
    if (m.state !== 'open') return null;
    const yes = m.yes ?? [];
    return { scene: m.scene.id, by: m.by ?? -1, yes: yes.length, need: m.need ?? 1, mine: slot !== null && yes.includes(slot) };
}

/**
 * The line said and shown for a vote message: its locale key and parameters. `title` names a scan, `nick` a slot, `key` is
 * the key that agrees (9). An open vote this pilot agreed to says the count; one he has not says the key.
 */
export function voteLine(m: VoteMsg, slot: number | null, title: (id: string) => string, nick: (slot: number) => string, key: string): { key: string; params: Record<string, string | number> } {
    const scan = title(m.scene.id);
    const yes = m.yes?.length ?? 0;
    const need = m.need ?? 1;
    switch (m.state) {
        case 'open':
        case 'busy': {
            const v = voteView({ ...m, state: 'open' }, slot);
            if (v?.mine) return { key: 'rooms.vote.counted', params: { scan, yes, need } };
            return { key: 'rooms.vote.open', params: { nick: nick(m.by ?? -1), scan, yes, need, key } };
        }
        case 'passed':
            return { key: 'rooms.vote.passed', params: { scan } };
        case 'failed':
            return { key: 'rooms.vote.failed', params: { scan, yes, need } };
        case 'same':
            return { key: 'rooms.vote.same', params: { scan } };
        default:
            return { key: 'rooms.vote.wait', params: { scan } };
    }
}

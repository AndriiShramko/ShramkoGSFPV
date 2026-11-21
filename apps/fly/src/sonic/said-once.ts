// The one session record of what the narrator has named (train 4, lane tutor-say; decision 1 "say only what is new", the first
// outside feedback of 2026-11-20: "the menu buttons must not be read out at every step"). A key or a button is named once, when
// it first matters; after that only when the pilot asks (key K) or moves the focus onto it, and those two paths do not ask here.
// One instance lives for the page's visit (the lesson host's): a new lesson does not name again what an earlier one named.
//
// Ids: 'keys.lesson' (the line of a lesson's keys), 'keys.free' (the free flight's line of keys), 'key.<action id>' (one key, e.g. 'key.sonic.repeat'), 'button.<data-testid>'
// (a button of the sound pages, e.g. 'button.sonic-start-quick').

export type SaidId = 'keys.lesson' | 'keys.free' | `key.${string}` | `button.${string}`;

export class SaidOnce {
    private readonly said = new Set<string>();

    /** Whether `id` was named in this session. */
    named(id: string): boolean {
        return this.said.has(id);
    }

    /** `id` was named now. */
    mark(id: string): void {
        this.said.add(id);
    }

    /** Names `id` when it was not named yet: true the first time (the caller says it), false after. */
    first(id: string): boolean {
        if (this.said.has(id)) return false;
        this.said.add(id);
        return true;
    }

    /** Forget every name (a new session: the reset of the pilot's progress, a test). */
    reset(): void {
        this.said.clear();
    }
}

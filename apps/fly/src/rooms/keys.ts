// Lane rooms-public, review fixes RP-1 to RP-3: what the two rooms keys do (9 opens "Fly with others", 0 says who is around) and
// what the welcome line tells the pilot to press. No DOM here: app/builtin/rooms.ts gives the page's answers, Node tests run it.
//
// Fly by Sound takes every digit while a lesson runs and the flight is not held (sonic/digit-key.ts, capture phase, before the
// router: 0 skips the question), and its menu (Escape, sonic/lesson-menu.ts) takes every key while it is up. So while a lesson
// runs 9 and 0 never reach rooms, and the welcome line must not tell the pilot to press 0 now: it says the digits are the
// lesson's and 0 works after it. (The owner's rule of 2026-11-10: every digit in a lesson is the lesson's answer.)
import type { ActionHandler, HandlerOptions } from '../app/keys';

/** What the keys need of the page. */
export interface RoomKeyDeps {
    /** a dialog is up: a screen or panel of #ui, or the sound mode's start screen or lesson menu (devices/keyboard.ts dialogOpen) */
    dialogUp(): boolean;
    /** joined to a room, with a drone shown: 0 has an answer */
    inRoom(): boolean;
    openPanel(): void;
    sayWho(): void;
    sayNoRoom(): void;
    /** lane rooms2 (R27): what 9 does (rooms/vote.ts ninePress); without it 9 opens the panel */
    nine?(): 'join' | 'agree' | 'panel';
    joinOpen?(): void;
    agree?(): void;
}

export interface RoomKey { run: ActionHandler; opts: HandlerOptions }

/**
 * The two handlers and when each takes a press. Both stop the key's default action: the panel focuses its name field inside the
 * keydown, and the browser would type the 9 into it (review RP-2; share.ts does the same). 9 waits while a dialog is up (it would
 * open over the sound mode's start screen or lesson menu, review RP-3); 0 answers inside a room everywhere a key reaches the router
 * (the pause menu too), and without a room it stays silent while a dialog is up rather than cut its speech.
 */
export function roomKeys(d: RoomKeyDeps): { panel: RoomKey; who: RoomKey } {
    return {
        panel: {
            run: (e) => {
                e.preventDefault();
                if (e.repeat) return;
                const what = d.nine?.() ?? 'panel';
                if (what === 'join' && d.joinOpen) d.joinOpen();
                else if (what === 'agree' && d.agree) d.agree();
                else d.openPanel();
            },
            opts: { when: () => !d.dialogUp() }
        },
        who: {
            run: (e) => {
                e.preventDefault();
                if (e.repeat) return;
                if (d.inRoom()) d.sayWho();
                else d.sayNoRoom();
            },
            opts: { when: () => d.inRoom() || !d.dialogUp() }
        }
    };
}

/** The welcome line's key and parameters: with a lesson running, the line that says 0 works after the lesson (review RP-1). */
export function welcomeLine(lessonRuns: boolean, name: string, n: number, who: string): { key: string; params: Record<string, string | number> } {
    return { key: lessonRuns ? 'rooms.say.welcomeLesson' : 'rooms.say.welcome', params: { name, n, who } };
}

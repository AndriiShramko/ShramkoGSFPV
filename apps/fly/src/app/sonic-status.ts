// Key I (sonic.status) in Fly by Sound: one press, the lines of several features in their order (v0.12, docs/wip/v12-int.md
// step 3). `ctx.keys.on` runs only the LAST handler registered for an action, so two features that each registered I would
// hide each other (whichever installs last wins). Instead each feature adds a provider here, and the one handler (the flight
// side's, app/builtin/sonic-flight.ts, which owns the engine and the mode's speech queue) says what the providers give, in
// their order: the lesson (status.lesson, or status.none when no lesson runs), then the recording (status.recording-on or
// status.recording-off, the session side's, sonic-session/session.ts).
//
// Small on purpose and free of the sound package at run time (a type import only): the main chunk carries it for every page.
import type { SpeechLine } from '@shramko/sonic-fpv';
import type { FlightContext } from './context';

/** The order the lines are said in: lower first. */
export const STATUS_ORDER = { lesson: 10, recording: 20 } as const;

export interface StatusProvider {
    /** lower first (STATUS_ORDER) */
    readonly order: number;
    /** the line to say now, or null to say nothing; a provider that throws is left out */
    line(): SpeechLine | null;
}

export class StatusBoard {
    private readonly list: { readonly p: StatusProvider; readonly seq: number }[] = [];
    private seq = 0;

    /** Adds a provider; the function it returns takes it out again. */
    add(p: StatusProvider): () => void {
        const item = { p, seq: this.seq++ };
        this.list.push(item);
        return () => {
            const i = this.list.indexOf(item);
            if (i >= 0) this.list.splice(i, 1);
        };
    }

    /** What I says now: every provider's line, in order (equal orders: the one added first first). */
    lines(): SpeechLine[] {
        const out: SpeechLine[] = [];
        for (const { p } of [...this.list].sort((a, b) => a.p.order - b.p.order || a.seq - b.seq)) {
            try {
                const line = p.line();
                if (line !== null) out.push(line);
            } catch {
                // one feature's trouble does not silence the others
            }
        }
        return out;
    }

    get size(): number {
        return this.list.length;
    }
}

const boards = new WeakMap<FlightContext, StatusBoard>();

/** The board of this page (one per flight context). */
export function statusBoard(ctx: FlightContext): StatusBoard {
    let b = boards.get(ctx);
    if (!b) {
        b = new StatusBoard();
        boards.set(ctx, b);
    }
    return b;
}

/**
 * Says the board's lines one after the other through `say`: the first cuts what is being said (a status is asked for now),
 * the others queue behind it. Resolves when the last has been said.
 */
export async function sayStatus(board: StatusBoard, say: (line: SpeechLine, interrupt: boolean) => Promise<void>): Promise<void> {
    const lines = board.lines();
    await Promise.all(lines.map((line, i) => say(line, i === 0).catch(() => undefined)));
}

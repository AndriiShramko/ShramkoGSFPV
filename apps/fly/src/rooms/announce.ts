// Train 1, lane rooms: what is said about the room (rooms-plan.md 2.7): joins, leaves, who is around, a near call. When Fly by
// Sound runs, the line goes through its speech (sayVia, the engine's own voice, captions and queue; the text rides the host
// line `sonic.say.text`); otherwise it is written into a polite live region of its own (role=status) that a screen reader
// reads, never into #ui wholesale. Every line appends its key to RoomsHook.said (the last 50).
import type { SonicRuntime } from '@shramko/sonic-fpv';
import { sayVia } from '../app/say-via';
import { LineBudget } from './around';

export const SAID_MAX = 50;

export class Announcer {
    readonly region: HTMLElement;
    private readonly say: ReturnType<typeof sayVia>;

    /** room lines a minute (review RV-6); key 0's answer (interrupt) is asked for, so it is never counted or dropped */
    private readonly budget = new LineBudget();

    constructor(private readonly o: { runtime: () => SonicRuntime | null; said: (keys: string[]) => void; current: () => readonly string[]; doc?: Document; now?: () => number }) {
        const doc = o.doc ?? document;
        this.region = doc.createElement('div');
        this.region.setAttribute('role', 'status');
        this.region.setAttribute('aria-live', 'polite');
        this.region.setAttribute('data-testid', 'rooms-live');
        this.region.className = 'visually-hidden';
        doc.body.append(this.region);
        this.say = sayVia(o.runtime);
    }

    /** Says `text` (its key goes into said). `interrupt`: the sound mode drops what it was saying (key 0 answers at once). */
    announce(key: string, text: string, interrupt = false): void {
        if (!interrupt && !this.budget.take((this.o.now ?? (() => performance.now()))())) return;
        this.o.said([...this.o.current(), key].slice(-SAID_MAX));
        if (this.o.runtime() !== null) {
            void this.say({ key: 'sonic.say.text', params: { text } }, { interrupt });
            return;
        }
        // the same text twice must be read twice: empty the region first
        this.region.textContent = '';
        setTimeout(() => {
            this.region.textContent = text;
        }, 50);
    }

    dispose(): void {
        this.region.remove();
    }
}

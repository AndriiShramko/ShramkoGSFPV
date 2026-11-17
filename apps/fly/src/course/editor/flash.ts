// Lane editfix E2.4: Courses and Keys on the top bar always show what they did. When the window is already open and
// the part already on screen, scrolling to it changes nothing a person can see, so the part lights up for a moment.

/** how long the part stays lit (an estimate: long enough to be seen after the click, short enough not to linger) */
export const SHOWN_MS = 1200;
export const SHOWN_CLASS = 'ce-shown';

interface Lit {
    classList: { add(c: string): void; remove(c: string): void };
    readonly offsetWidth: number;
}

const timers = new WeakMap<object, unknown>();

/** lights the part (class ce-shown) and takes it off after SHOWN_MS; a second press starts the light again */
export function flashPart(
    part: Lit,
    later: (fn: () => void, ms: number) => unknown = setTimeout,
    stop: (id: unknown) => void = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
): void {
    const prev = timers.get(part);
    if (prev !== undefined) stop(prev);
    part.classList.remove(SHOWN_CLASS);
    void part.offsetWidth; // a fresh start of the CSS animation
    part.classList.add(SHOWN_CLASS);
    timers.set(
        part,
        later(() => {
            part.classList.remove(SHOWN_CLASS);
            timers.delete(part);
        }, SHOWN_MS),
    );
}

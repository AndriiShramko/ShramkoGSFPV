// The lap clock's text (moved out of course/hud.ts so the pure course parts and their tests do not load the DOM block).

/** m:ss.cc */
export function lapClock(ms: number | null): string {
    if (ms === null) return '-';
    const cs = Math.floor(Math.max(0, ms) / 10);
    const m = Math.floor(cs / 6000);
    const s = Math.floor((cs % 6000) / 100);
    return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

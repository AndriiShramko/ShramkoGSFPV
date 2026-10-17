// "N was used" (v0.9 item 11): a pilot who pressed N (or Shift+N, a radio's next-scene switch, the crash
// panel's Next scene, the hint's button) knows how to change the place, so the crash hint (builtin/next-hint.ts)
// is never shown to them again. Kept in localStorage, every access guarded; with storage blocked it is kept
// for this page only. Recorded in one place, the scene host's go() (every route to N passes it).
const KEY = 'gsfpv.nextUsed.v1';

/** the flag for this page, when storage cannot keep it */
let usedHere = false;

export function nextUsed(): boolean {
    if (usedHere) return true;
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function noteNextUsed(): void {
    usedHere = true;
    try { localStorage.setItem(KEY, '1'); } catch { /* blocked storage: this page remembers */ }
}

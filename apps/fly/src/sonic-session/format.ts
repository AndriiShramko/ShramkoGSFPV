// Small formatters for what the recording panel shows (docs/wip/v12-plan.md section 4.3 step 3): a size, a length, a date.
// Pure, so the Node tests read the same numbers the page shows.

/** `2.4 MB`, `640 KB`, `12 B`: decimal units, one decimal from megabytes up. */
export function formatBytes(n: number): string {
    if (!Number.isFinite(n) || n < 0) return '-';
    if (n < 1000) return `${Math.round(n)} B`;
    if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
    if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
    return `${(n / 1_000_000_000).toFixed(1)} GB`;
}

/** `4:12`, `1:02:03`: minutes and seconds (hours when there are some), from milliseconds. */
export function formatClock(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '-';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const two = (x: number): string => String(x).padStart(2, '0');
    return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/**
 * Writes `text` into an element only when it differs from what is there. A live region (role status, aria-live) is read out by a
 * screen reader whenever its content is written, and `textContent = same text` replaces the text node as much as a new text does:
 * a panel that redraws every second or every quarter of a second must not touch a sentence that has not changed.
 */
export function setText(el: { textContent: string | null }, text: string): void {
    if (el.textContent !== text) el.textContent = text;
}

/** A date and time of day in the page's language, in the viewer's time zone; the ISO text itself when it is not a date. */
export function formatWhen(iso: string, locale: string): string {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    try {
        return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    } catch {
        return d.toISOString().slice(0, 16).replace('T', ' ');
    }
}

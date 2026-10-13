// Where the credit line sits in a recorded frame (D34, D36: in every frame of every video; the
// recorder is cinema.ts). The line is "<title> — <author>, <licence> · ShramkoGSFPV · <site>"
// (scene-facts.ts videoCredit), and it has to be whole in any frame the pilot records: a landscape
// 1920x1080, a phone held upright (390 x 844 css px -> a 498 x 1080 file at 1080p), any title length.
// Until the review of lane D1 (docs/wip/v07-d1.md, R2) it was one line at a 40th of the frame height,
// clipped at the frame's edge: in an upright frame only the title was left (the author, the licence
// and ShramkoGSFPV cut off).
//
// The rule: one line at that size when it fits; else the font shrinks to 60 % of it; below that the
// line breaks at its separators (" · ", " — ": the title on one line, the author and the brand on the
// next), at the largest size that keeps it to two lines, else three; a phrase longer than the frame
// breaks between words, a word longer than the frame between letters. Every line fits the frame.
//
// Pure: the text is measured through `measure` (a canvas' measureText with creditFont in the
// browser, a width per letter in tools/bench/test/flight-ux-recording.test.ts).

/** The width of `text` in pixels at `fontPx` in the credit's font (creditFont). */
export type MeasureText = (text: string, fontPx: number) => number;

/** The credit's font at `px` pixels (what the recorder draws with and measures with). */
export function creditFont(px: number): string {
    return `600 ${px}px system-ui, sans-serif`;
}

/** How the credit sits in the frame: the box (bottom left, `pad` from the edges) and its lines. */
export interface CreditLayout {
    fontPx: number;
    /** the box's margin from the frame's edges and the text's padding inside the box */
    pad: number;
    /** from one line's middle to the next */
    lineH: number;
    lines: string[];
    x: number;
    y: number;
    w: number;
    h: number;
}

/** The places the credit may break, in the order it prefers them (scene-facts.ts videoCredit joins with them). */
export const CREDIT_BREAKS = [' · ', ' — '] as const;

/** The font size of v0.6's single line: a 40th of the frame height, at least 14 px. */
export function creditBaseFont(frameH: number): number {
    return Math.max(14, Math.round(frameH / 40));
}

/** The smallest size the line shrinks to before it breaks: 60 % of the base, at least 12 px. */
function creditMinFont(frameH: number): number {
    return Math.min(creditBaseFont(frameH), Math.max(12, Math.round(creditBaseFont(frameH) * 0.6)));
}

const padOf = (fontPx: number): number => Math.round(fontPx * 0.6);

/** `text` cut into pieces of at most `room` px, between words, else between letters. */
function breakLong(text: string, room: number, width: (s: string) => number): string[] {
    const out: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (width(next) <= room) {
            line = next;
            continue;
        }
        if (line) out.push(line);
        if (width(word) <= room) {
            line = word;
            continue;
        }
        // one word wider than the frame: between letters
        line = '';
        for (const ch of word) {
            if (line && width(line + ch) > room) {
                out.push(line);
                line = ch;
            } else line += ch;
        }
    }
    if (line) out.push(line);
    return out;
}

/**
 * The credit as lines of at most `room` px: phrases (between the separators) joined while they fit,
 * the separator dropped where a line breaks; a phrase wider than `room` broken by breakLong.
 */
export function wrapCredit(credit: string, room: number, width: (s: string) => number): string[] {
    // the phrases with the separator that came before each ('' for the first)
    const phrases: { sep: string; text: string }[] = [];
    let rest = credit;
    let sep = '';
    for (;;) {
        let at = -1;
        let found = '';
        for (const s of CREDIT_BREAKS) {
            const i = rest.indexOf(s);
            if (i >= 0 && (at < 0 || i < at)) { at = i; found = s; }
        }
        if (at < 0) {
            phrases.push({ sep, text: rest });
            break;
        }
        phrases.push({ sep, text: rest.slice(0, at) });
        rest = rest.slice(at + found.length);
        sep = found;
    }
    const lines: string[] = [];
    let line = '';
    for (const p of phrases) {
        const joined = line ? `${line}${p.sep}${p.text}` : p.text;
        if (width(joined) <= room) {
            line = joined;
            continue;
        }
        if (line) lines.push(line);
        if (width(p.text) <= room) line = p.text;
        else {
            const pieces = breakLong(p.text, room, width);
            line = pieces.pop() ?? '';
            lines.push(...pieces);
        }
    }
    if (line) lines.push(line);
    return lines;
}

/** The layout of `credit` in a frame of `frameW` x `frameH` (the rule at the top of this file). */
export function creditLayout(credit: string, frameW: number, frameH: number, measure: MeasureText): CreditLayout {
    const base = creditBaseFont(frameH);
    const min = creditMinFont(frameH);
    const at = (fontPx: number, maxLines: number): CreditLayout | null => {
        const pad = padOf(fontPx);
        const width = (s: string): number => measure(s, fontPx);
        // the box keeps `pad` from both edges and `pad` inside on both sides
        const room = Math.max(1, frameW - 4 * pad);
        const lines = wrapCredit(credit, room, width);
        if (lines.length > maxLines) return null;
        const lineH = Math.round(fontPx * 1.25);
        const w = Math.max(...lines.map(width)) + 2 * pad;
        const h = fontPx + (lines.length - 1) * lineH + 2 * pad;
        return { fontPx, pad, lineH, lines, x: pad, y: frameH - h - pad, w, h };
    };
    for (const maxLines of [1, 2, 3]) {
        for (let fs = base; fs >= min; fs--) {
            const l = at(fs, maxLines);
            if (l) return l;
        }
    }
    return at(min, Number.POSITIVE_INFINITY)!;
}

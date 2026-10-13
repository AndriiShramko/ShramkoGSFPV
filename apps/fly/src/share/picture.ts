// The share picture (W5; v0.7 D1 moved it here from app/builtin/share.ts): the view as it is,
// cropped to 1200x630 (the Open Graph card size), with a question on top, the brand, the call to
// action, the site and the scan's credit drawn in, as a JPEG data URL under the API's 400 KB limit.
// POST /api/share stores it and answers /s/<id>, a page whose card is this picture (apps/api/server.py).
import type { SplatRenderer } from '@gsfpv/render-pc';
import { grabView } from '../app/diagnostics';
import { BRAND, SITE_HOST } from '../scene-facts';

export const SHARE_W = 1200;
export const SHARE_H = 630;
/** the API keeps a picture up to 400 KB: the quality steps down until it fits */
const MAX_BYTES = 380 * 1024;
const FONT = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';

/** The words drawn into the picture (all already translated); `credit`: the scan's credit line, or null. */
export interface ShareWords { hook: string; tagline: string; cta: string; credit: string | null }

/** The largest font size up to `size` at which `text` fits `max` px. */
function fit(g: CanvasRenderingContext2D, text: string, weight: number, size: number, max: number, family = FONT): void {
    for (let s = size; s >= 12; s--) {
        g.font = `${weight} ${s}px ${family}`;
        if (g.measureText(text).width <= max) return;
    }
}

/** The project's mark (apps/site Logo): four rotors around a body, s px square, at (x, y). */
function logo(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    const k = s / 24;
    g.save();
    g.strokeStyle = '#4ade80';
    g.lineWidth = 1.8 * k;
    for (const [cx, cy] of [[6, 6], [18, 6], [6, 18], [18, 18]]) {
        g.beginPath();
        g.arc(x + cx * k, y + cy * k, 4 * k, 0, Math.PI * 2);
        g.stroke();
    }
    g.fillStyle = '#e8eaed';
    g.beginPath();
    g.roundRect(x + 9 * k, y + 9 * k, 6 * k, 6 * k, 1.5 * k);
    g.fill();
    g.restore();
}

/** The words and the brand over the frame: a question on top, the name, what it is and the way in at the bottom. */
export function brand(g: CanvasRenderingContext2D, w: number, hgt: number, o: ShareWords): void {
    const pad = 56;
    g.save();
    const top = g.createLinearGradient(0, 0, 0, 170);
    top.addColorStop(0, 'rgba(7,8,10,0.72)');
    top.addColorStop(1, 'rgba(7,8,10,0)');
    g.fillStyle = top;
    g.fillRect(0, 0, w, 170);
    const band = 250;
    const bottom = g.createLinearGradient(0, hgt - band, 0, hgt);
    bottom.addColorStop(0, 'rgba(7,8,10,0)');
    bottom.addColorStop(0.42, 'rgba(7,8,10,0.82)');
    bottom.addColorStop(1, 'rgba(7,8,10,0.95)');
    g.fillStyle = bottom;
    g.fillRect(0, hgt - band, w, band);

    g.textBaseline = 'alphabetic';
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 12;
    g.fillStyle = '#ffffff';
    fit(g, o.hook, 750, 58, w - 2 * pad);
    g.fillText(o.hook, pad, 92);
    g.shadowBlur = 0;

    // the call to action on the right of the name row
    g.font = `700 28px ${FONT}`;
    const ctaW = g.measureText(o.cta).width + 52;
    const rowY = hgt - 182;
    g.fillStyle = '#4ade80';
    g.beginPath();
    g.roundRect(w - pad - ctaW, rowY - 44, ctaW, 60, 30);
    g.fill();
    g.fillStyle = '#03170b';
    g.fillText(o.cta, w - pad - ctaW + 26, rowY - 4);

    logo(g, pad, rowY - 40, 44);
    g.fillStyle = '#ffffff';
    fit(g, BRAND, 700, 42, w - 2 * pad - ctaW - 80);
    g.fillText(BRAND, pad + 58, rowY);

    g.fillStyle = '#d6dae0';
    fit(g, o.tagline, 500, 27, w - 2 * pad);
    g.fillText(o.tagline, pad, hgt - 112);

    g.font = `600 22px ui-monospace, Consolas, monospace`;
    const hostW = g.measureText(SITE_HOST).width;
    g.fillStyle = '#4ade80';
    g.fillText(SITE_HOST, w - pad - hostW, hgt - 56);
    if (o.credit) {
        g.fillStyle = '#9ba3ae';
        fit(g, o.credit, 500, 20, w - 2 * pad - hostW - 32);
        g.fillText(o.credit, pad, hgt - 56);
    }
    g.restore();
}

/** The share picture of the view now as a JPEG data URL under MAX_BYTES, or null without a frame. */
export async function sharePicture(renderer: SplatRenderer, canvas: HTMLCanvasElement, words: ShareWords): Promise<string | null> {
    const c = await grabView(renderer, canvas, SHARE_W, SHARE_H);
    const g = c?.getContext('2d');
    if (!c || !g) return null;
    brand(g, SHARE_W, SHARE_H, words);
    let url = '';
    for (const q of [0.88, 0.8, 0.72, 0.64, 0.56]) {
        url = c.toDataURL('image/jpeg', q);
        if ((url.length - 23) * 0.75 <= MAX_BYTES) break;
    }
    return url;
}

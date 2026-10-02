// "Share this scene" (W5): the view as it is, cropped to 1200x630 with the scene's credit and our
// brand drawn in, goes to POST /api/share; the link it answers (/s/<id>) is a page whose Open Graph
// card is that picture, so a post on LinkedIn, Facebook, X, Telegram, WhatsApp or Reddit shows it at
// once and a click opens the simulator on this scene. Instagram has no share link: the Web Share API
// (phones) and "Save picture" reach it. From the pause menu, and after a flight of at least 30 s the
// summary panel asks for it in words (the moment a pilot is proud of a line).
import { DT } from '@gsfpv/sim-core';
import shareTargets from '@gsfpv/i18n/share.json';
import { h, clear, panel } from '../../ui/dom';
import { t, locale } from '../../i18n';
import { grabView } from '../diagnostics';
import { PauseMenu } from '../menu';
import type { Feature, FlightContext } from '../context';
import './share.css';

export const SHARE_W = 1200;
export const SHARE_H = 630;
/** the API keeps a picture up to 400 KB: the quality steps down until it fits */
const MAX_BYTES = 380 * 1024;
/** a flight this long (armed, seconds) earns the summary panel's "Nice flight" row */
const NICE_S = 30;
const SITE_HOST = 'gsfpv.flyreelstudio.eu';
const FONT = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';

export interface ShareWords { hook: string; tagline: string; cta: string; credit: string | null }

/** The scene's credit for the picture and the page (CC BY wants it): title, author, licence when known. */
function creditOf(ctx: FlightContext): string | null {
    const m = ctx.scene.meta;
    return m ? `${m.title} — ${m.author}, ${m.license}` : `superspl.at/scene/${ctx.scene.id}`;
}

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
    fit(g, 'ShramkoGSFPV', 700, 42, w - 2 * pad - ctaW - 80);
    g.fillText('ShramkoGSFPV', pad + 58, rowY);

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
export async function sharePicture(ctx: FlightContext): Promise<string | null> {
    const c = await grabView(ctx.renderer, ctx.canvas, SHARE_W, SHARE_H);
    const g = c?.getContext('2d');
    if (!c || !g) return null;
    const credit = creditOf(ctx);
    brand(g, SHARE_W, SHARE_H, { hook: t('share.hook'), tagline: t('share.tagline'), cta: `${t('share.cta')} →`, credit: credit ? t('share.scanBy', { credit }) : null });
    let url = '';
    for (const q of [0.88, 0.8, 0.72, 0.64, 0.56]) {
        url = c.toDataURL('image/jpeg', q);
        if ((url.length - 23) * 0.75 <= MAX_BYTES) break;
    }
    return url;
}

function targetHref(href: string, url: string, text: string, title: string): string {
    return href.replace('{url}', encodeURIComponent(url)).replace('{text}', encodeURIComponent(text)).replace('{title}', encodeURIComponent(title));
}

async function dataUrlFile(url: string): Promise<File> {
    const blob = await (await fetch(url)).blob();
    return new File([blob], 'shramkogsfpv-scene.jpg', { type: 'image/jpeg' });
}

export function openShare(ctx: FlightContext): void {
    if (document.querySelector('.panel.share')) return;
    ctx.pause('panel');
    const p = panel(t('share.title'), () => { p.close(); ctx.resume('panel'); });
    p.root.classList.add('share');
    p.root.dataset.testid = 'share';
    const status = h('p', { class: 'share-status', role: 'status', 'aria-live': 'polite', 'data-testid': 'share-status' }, t('share.making'));
    const preview = h('div', { class: 'share-preview' });
    const targets = h('div', { class: 'share-targets', hidden: true });
    const urlField = h('input', { class: 'share-url', type: 'text', readonly: true, 'aria-label': t('share.copy'), 'data-testid': 'share-url', hidden: true }) as HTMLInputElement;
    p.body.append(preview, status, targets, urlField, h('p', { class: 'muted small' }, t('share.instagram')));
    ctx.ui.append(p.root);

    const sceneName = ctx.scene.meta?.title ?? t('share.scan');
    const title = `ShramkoGSFPV — ${sceneName}`;
    const text = t('share.text', { scene: sceneName });
    const plain = `${location.origin}/${locale}/fly/?scene=${ctx.scene.id}`;

    const show = (url: string, picture: string | null): void => {
        clear(targets);
        urlField.value = url;
        urlField.hidden = false;
        const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
        if (typeof nav.share === 'function') {
            targets.append(h('button', { type: 'button', class: 'btn primary', 'data-action': 'share-native', onclick: () => void (async () => {
                try {
                    const file = picture ? await dataUrlFile(picture) : null;
                    // with the picture where the phone can (Instagram, stories); the link goes in the text then
                    await nav.share(file && nav.canShare?.({ files: [file] }) ? { files: [file], title, text: `${text} ${url}` } : { title, text, url });
                } catch { /* closed by the user */ }
            })() }, t('share.native')));
        }
        for (const s of shareTargets.targets) {
            targets.append(h('a', { class: 'btn', 'data-share': s.id, href: targetHref(s.href, url, text, title), target: '_blank', rel: 'noopener' }, s.label));
        }
        const copy = h('button', { type: 'button', class: 'btn', 'data-action': 'share-copy', onclick: () => void (async () => {
            try { await navigator.clipboard.writeText(url); } catch { urlField.select(); document.execCommand('copy'); }
            copy.textContent = t('share.copied');
        })() }, t('share.copy'));
        targets.append(copy);
        if (picture) targets.append(h('a', { class: 'btn', 'data-action': 'share-save', href: picture, download: `shramkogsfpv-${ctx.scene.id}.jpg` }, t('share.save')));
        targets.hidden = false;
    };

    void (async () => {
        const picture = await sharePicture(ctx);
        if (picture) preview.append(h('img', { src: picture, alt: t('share.title'), width: SHARE_W, height: SHARE_H, 'data-testid': 'share-picture' }));
        try {
            if (!picture) throw new Error('no frame');
            const r = await fetch('/api/share', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: picture, scene: ctx.scene.id, title: ctx.scene.meta?.title ?? '', credit: creditOf(ctx), locale, hp: '' })
            });
            const j = (await r.json()) as { ok?: boolean; url?: string };
            if (!r.ok || !j.ok || !j.url) throw new Error(`share ${r.status}`);
            status.textContent = t('share.ready');
            show(j.url, picture);
        } catch {
            status.textContent = t('share.failed');
            show(plain, picture);
        }
    })();
}

function mmss(s: number): string {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export const share: Feature = {
    id: 'share',
    install(ctx) {
        ctx.menu.add({ id: 'pause.share', action: null, labelKey: 'share.menu', order: 35, section: 'scene', run: () => openShare(ctx) });
        // the armed time of this flight and of the last one (sim ticks): what makes a flight "nice"
        let armedAt: number | null = null;
        let last = 0;
        ctx.events.on('sim', (e) => {
            if (e.type === 'arm') armedAt = e.tick;
            else if ((e.type === 'crash' || e.type === 'disarm' || e.type === 'respawn') && armedAt !== null) {
                last = (e.tick - armedAt) * DT;
                armedAt = null;
            }
        });
        ctx.events.on('session', () => { armedAt = null; last = 0; });
        if (ctx.menu instanceof PauseMenu) {
            ctx.menu.addRow(() => {
                const now = armedAt !== null ? (ctx.session.sim.tick - armedAt) * DT : 0;
                const best = Math.max(now, last);
                if (best < NICE_S) return null;
                return h('div', { class: 'share-nice', 'data-testid': 'share-nice' },
                    h('span', {}, t('share.nice', { time: mmss(best) })),
                    h('button', { type: 'button', class: 'btn primary', 'data-action': 'share-open', onclick: () => { openShare(ctx); ctx.menu.close(); } }, t('share.menu')));
            });
        }
    }
};

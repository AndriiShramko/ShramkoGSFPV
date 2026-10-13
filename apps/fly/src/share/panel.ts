// The one share panel (docs/wip/v07-d1.md section 1): every place a share starts opens this, in a
// flight or in the scene picker. It shows the picture (when the share started in a flight) and,
// once the link is known, the ways out: the phone's share sheet (Web Share API), LinkedIn,
// Facebook, X, Telegram, WhatsApp, Reddit (@gsfpv/i18n/share.json, shared with the landing),
// Instagram (no web share link: it saves the picture or the video and copies the caption), copy
// link, save picture. After a recording the video itself goes through the share sheet where the
// browser can share files (phones), else it is offered to save.
//
// Which link and which words: share/links.ts (pure). The picture: share/picture.ts. Selectors the
// acceptance reads (tools/bench/src/accept-v05-feedback.ts): .panel.share, [data-testid=share-url],
// [data-share] (the six link targets), .panel-x.
import shareTargets from '@gsfpv/i18n/share.json';
import { h, clear, panel } from '../ui/dom';
import { t, locale } from '../i18n';
import { creditText } from '../scene-facts';
import type { SceneCredit } from '../scene-facts';
import { SHARE_W, SHARE_H } from './picture';
import { dataUrlBytes, inFlight, instagramCaption, kindOf, shareLink, targetHref, wordsKey } from './links';
import type { ShareEntry } from './links';
import './share.css';

/** One share: where it started, the scene, and what the place it started from can add. */
export interface ShareRequest {
    entry: ShareEntry;
    scene: SceneCredit;
    /** makes the picture of the view (a flight); absent outside a flight */
    picture?: () => Promise<string | null>;
    /** the video of the flight (after a recording), loaded when the panel opens; null: it is gone */
    video?: () => Promise<File | null>;
    /** the crash's impact speed, m/s (the crash panel's words) */
    speed?: number;
}

/** Where the panel goes and what it holds while it is up (a flight's pause). */
export interface ShareHost {
    /** the element the panel is appended to (the flight's #ui, or the picker's screen) */
    parent: HTMLElement;
    onOpen?(): void;
    onClose?(): void;
}

/** What a test or the acceptance reads of the panel shown last (window.__gsfpv.share). */
export interface ShareState { entry: ShareEntry; kind: string; url: string | null; text: string; picture: boolean; video: 'none' | 'loading' | 'ready' | 'gone'; canShareFiles: boolean }
let lastState: ShareState | null = null;
/** The last share panel's state (null: none opened in this page). */
export function shareState(): ShareState | null {
    return lastState;
}

type ShareNav = Navigator & { canShare?: (d: ShareData) => boolean };

/** A picture data URL as a File (no fetch: the page's CSP has no data: in connect-src). */
function pictureFile(url: string, name: string): File | null {
    const b = dataUrlBytes(url);
    return b ? new File([b.bytes], name, { type: b.type }) : null;
}

/** A download of `href` named `name`, from inside the click that asked for it. */
function download(href: string, name: string): void {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
}

async function copyText(text: string, fallback?: HTMLInputElement): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        if (!fallback) return false;
        fallback.value = text;
        fallback.select();
        return document.execCommand('copy');
    }
}

/**
 * Opens the share panel (one at a time: null when one is up already). The flight's caller pauses
 * through `host.onOpen` / `onClose`; Esc and the x close it.
 */
export function openSharePanel(host: ShareHost, req: ShareRequest): { close(): void } | null {
    if (document.querySelector('.panel.share')) return null;
    const kind = kindOf(req.entry);
    const sceneName = req.scene.title ?? t('share.scan');
    const title = `ShramkoGSFPV — ${sceneName}`;
    const text = t(wordsKey(kind), { scene: sceneName, speed: (req.speed ?? 0).toFixed(1) });
    const credit = creditText(req.scene);
    const nav = navigator as ShareNav;
    const state: ShareState = { entry: req.entry, kind, url: null, text, picture: false, video: req.video ? 'loading' : 'none', canShareFiles: false };
    lastState = state;

    let closed = false;
    const objectUrls: string[] = [];
    const close = (): void => {
        if (closed) return;
        closed = true;
        p.close();
        for (const u of objectUrls) URL.revokeObjectURL(u);
        host.onClose?.();
    };
    const p = panel(t(kind === 'video' ? 'share.title.video' : 'share.title'), close);
    p.root.classList.add('share');
    p.root.dataset.testid = 'share';
    p.root.dataset.entry = req.entry;
    // Esc closes this panel only (the picker under it, the pause menu stay)
    p.root.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        close();
    });
    const status = h('p', { class: 'share-status', role: 'status', 'aria-live': 'polite', 'data-testid': 'share-status' }, t(req.video ? 'share.video.making' : 'share.making'));
    const preview = h('div', { class: 'share-preview' });
    if (!req.picture) preview.hidden = true;
    const videoRow = h('div', { class: 'share-targets share-video', hidden: true, 'data-testid': 'share-video' });
    const targets = h('div', { class: 'share-targets', hidden: true });
    const urlField = h('input', { class: 'share-url', type: 'text', readonly: true, 'aria-label': t('share.copy'), 'data-testid': 'share-url', hidden: true }) as HTMLInputElement;
    const note = h('p', { class: 'muted small' }, t('share.instagram.note'));
    p.body.append(preview, status, videoRow, targets, urlField, note);
    host.onOpen?.();
    host.parent.append(p.root);

    let picture: string | null = null;
    let video: File | null = null;
    /** the video's object URL (made once, revoked when the panel closes) */
    let videoHref = '';

    /** The video row: the share sheet with the file where the browser can, else a download. */
    const showVideo = (): void => {
        clear(videoRow);
        if (!video) {
            videoRow.append(h('span', { class: 'muted small' }, t('share.video.gone')));
            videoRow.hidden = false;
            return;
        }
        const file = video;
        state.canShareFiles = typeof nav.share === 'function' && !!nav.canShare?.({ files: [file] });
        if (state.canShareFiles) {
            videoRow.append(h('button', { type: 'button', class: 'btn primary', 'data-action': 'share-video', onclick: () => void nav.share({ files: [file], title, text: `${text} ${state.url ?? ''}`.trim() }).catch(() => undefined) }, t('share.video.native')));
        }
        videoHref = URL.createObjectURL(file);
        objectUrls.push(videoHref);
        videoRow.append(h('a', { class: state.canShareFiles ? 'btn' : 'btn primary', 'data-action': 'share-video-save', href: videoHref, download: file.name }, t('share.video.save')));
        videoRow.hidden = false;
    };

    /** The link's buttons, once the link is known. */
    const show = (url: string): void => {
        state.url = url;
        clear(targets);
        urlField.value = url;
        urlField.hidden = false;
        if (typeof nav.share === 'function') {
            targets.append(h('button', { type: 'button', class: req.video ? 'btn' : 'btn primary', 'data-action': 'share-native', onclick: () => {
                // with the picture where the phone can (Instagram, stories): the link goes in the text then
                const file = picture ? pictureFile(picture, `shramkogsfpv-${req.scene.id}.jpg`) : null;
                const data: ShareData = file && nav.canShare?.({ files: [file] }) ? { files: [file], title, text: `${text} ${url}` } : { title, text, url };
                void nav.share(data).catch(() => undefined); // closed by the pilot
            } }, t('share.native')));
        }
        for (const s of shareTargets.targets) {
            targets.append(h('a', { class: 'btn', 'data-share': s.id, href: targetHref(s.href, url, text, title), target: '_blank', rel: 'noopener' }, s.label));
        }
        targets.append(h('button', { type: 'button', class: 'btn', 'data-action': 'share-instagram', onclick: () => void (async () => {
            const caption = instagramCaption({ text, url, credit: t('share.scanBy', { credit }), tags: t('share.tags') });
            const copied = await copyText(caption, urlField);
            if (video && videoHref) download(videoHref, video.name);
            else if (picture) download(picture, `shramkogsfpv-${req.scene.id}.jpg`);
            status.textContent = video || picture ? t('share.instagram.done') : t('share.instagram.caption');
            if (!copied) urlField.value = url;
        })() }, t('share.instagram.button')));
        const copy = h('button', { type: 'button', class: 'btn', 'data-action': 'share-copy', onclick: () => void (async () => {
            if (await copyText(url, urlField)) copy.textContent = t('share.copied');
            urlField.value = url;
        })() }, t('share.copy'));
        targets.append(copy);
        if (picture) targets.append(h('a', { class: 'btn', 'data-action': 'share-save', href: picture, download: `shramkogsfpv-${req.scene.id}.jpg` }, t('share.save')));
        targets.hidden = false;
        // the first way out has the focus (Esc, Tab work from there)
        (videoRow.querySelector<HTMLElement>('.btn') ?? targets.querySelector<HTMLElement>('.btn'))?.focus({ preventScroll: true });
    };

    const at = { origin: location.origin, locale, search: location.search };
    void (async () => {
        if (req.video) {
            try { video = await req.video(); } catch { video = null; }
            state.video = video ? 'ready' : 'gone';
            if (closed) return;
            showVideo();
        }
        let pictureUrl: string | null = null;
        let failed = false;
        if (req.picture && inFlight(req.entry)) {
            picture = await req.picture().catch(() => null);
            state.picture = !!picture;
            if (closed) return;
            if (picture) preview.append(h('img', { src: picture, alt: t('share.title'), width: SHARE_W, height: SHARE_H, 'data-testid': 'share-picture' }));
            else preview.hidden = true;
            try {
                if (!picture) throw new Error('no frame');
                const r = await fetch('/api/share', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: picture, scene: req.scene.id, title: req.scene.title ?? '', credit, locale, hp: '' })
                });
                const j = (await r.json()) as { ok?: boolean; url?: string };
                if (!r.ok || !j.ok || !j.url) throw new Error(`share ${r.status}`);
                pictureUrl = j.url;
            } catch {
                failed = true;
            }
        }
        if (closed) return;
        const url = shareLink({ entry: req.entry, sceneId: req.scene.id, inCatalogue: req.scene.inCatalogue, at, pictureUrl });
        status.textContent = failed ? t('share.failed') : pictureUrl ? t('share.ready') : t('share.ready.page');
        show(url);
    })();
    return { close };
}

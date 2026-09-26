// Loading screen of a scan: what is downloading, how much of how much, for how long, and what to
// do when nothing arrives. Rows have fixed heights (numbers change, the layout does not move); the
// bar is drawn with transforms so its animation keeps running while the main thread decodes.
import { posterUrl, knownVersion } from '@gsfpv/scenes';
import type { LoadProgress, LoadPart } from '../session';
import { t, locale } from '../i18n';
import { h } from './dom';

const STALL_HINT_MS = 10000;
const STALL_ACTIONS_MS = 20000;
/** speed = bytes over the last few seconds, so one slow moment does not swing the time left */
const SPEED_WINDOW_MS = 2500;
/** time left is shown only when it says something: long enough, and once the speed has a full window */
const LEFT_MIN_S = 4;
/** below this the numbers row stays empty rather than showing "0.0 MB" */
const SHOW_BYTES_MIN = 50_000;
/** a speed is only a speed while bytes flow */
const SPEED_QUIET_MS = 2000;
const READY_MS = 450;
const FADE_MS = 260;
const CHECK = String.fromCharCode(0x2713);

export interface LoadingOptions {
    sceneId: string;
    title?: string;
    /** line under "The scan is ready" when the Controls screen comes next */
    next?: string | null;
    onRetry: () => void;
    onBack: () => void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class LoadingScreen {
    readonly root: HTMLDivElement;
    private readonly startedAt = performance.now();
    private stageAt = performance.now();
    private p: LoadProgress | null = null;
    private samples: { t: number; b: number }[] = [];
    private timer: number;
    private finished = false;
    private readonly next: string | null;
    private readonly sceneId: string;
    private readonly img: HTMLImageElement;
    /** the v<N> folder the poster is asked from */
    private posterVersion: number;
    private readonly stageEl: HTMLSpanElement;
    private readonly elapsedEl: HTMLSpanElement;
    private readonly bar: HTMLDivElement;
    private readonly fill: HTMLElement;
    private readonly numsEl: HTMLDivElement;
    private readonly partsEl: HTMLDivElement;
    private readonly hintEl: HTMLDivElement;
    /** screen readers hear each kind of hint once, not a counter ticking every second */
    private readonly srEl: HTMLDivElement;
    private srKey = '';
    private readonly nf = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    constructor(parent: HTMLElement, o: LoadingOptions) {
        this.next = o.next ?? null;
        this.sceneId = o.sceneId;
        // the same preview the scene picker shows, from the folder this browser last found the scene in;
        // a republished scene seen here for the first time gets its real folder once the scene resolves
        this.posterVersion = knownVersion(o.sceneId);
        const img = h('img', { src: posterUrl(o.sceneId, 'm', this.posterVersion), alt: '', decoding: 'async' });
        img.addEventListener('error', () => { img.style.visibility = 'hidden'; }); // keep the box: no jump
        img.addEventListener('load', () => { img.style.visibility = ''; });
        this.img = img;
        this.stageEl = h('span', { class: 'load-stage', role: 'status' }, t('loading.scene'));
        this.elapsedEl = h('span', { class: 'load-elapsed', 'aria-hidden': 'true' });
        this.fill = h('i', { class: 'fill' });
        this.bar = h('div', { class: 'load-bar', role: 'progressbar', 'aria-label': t('loading.scene'), 'aria-valuemin': 0, 'aria-valuemax': 100 }, this.fill, h('i', { class: 'sweep' }));
        // numbers change 4 times a second: read through the progress bar, not announced on each change
        this.numsEl = h('div', { class: 'load-nums', 'aria-hidden': 'true' });
        this.partsEl = h('div', { class: 'load-parts', 'aria-hidden': 'true' });
        this.hintEl = h('div', { class: 'load-hint', 'aria-hidden': 'true' });
        this.srEl = h('div', { class: 'visually-hidden', role: 'status' });
        const actions = h('div', { class: 'load-actions' },
            h('button', { type: 'button', class: 'btn primary', 'data-action': 'load-retry', onclick: () => o.onRetry() }, t('loading.retry')),
            h('button', { type: 'button', class: 'btn', 'data-action': 'load-back', onclick: () => o.onBack() }, t('loading.back')));
        this.root = h('div', { class: 'loading', 'data-testid': 'loading', 'data-stage': 'connect', 'data-indeterminate': true, 'aria-busy': 'true' },
            h('div', { class: 'load-card' },
                h('div', { class: 'load-poster' }, img),
                h('div', { class: 'load-title' }, o.title ?? o.sceneId),
                h('div', { class: 'load-head' }, this.stageEl, this.elapsedEl),
                this.bar,
                this.numsEl,
                this.partsEl,
                this.hintEl,
                this.srEl,
                actions));
        parent.append(this.root);
        this.render();
        this.timer = window.setInterval(() => this.render(), 250);
    }

    update(p: LoadProgress): void {
        if (this.finished) return;
        if (p.version !== null && p.version !== this.posterVersion) {
            this.posterVersion = p.version;
            this.img.src = posterUrl(this.sceneId, 'm', p.version);
        }
        const now = performance.now();
        if (p.stage !== this.p?.stage) {
            this.stageAt = now;
            // the speed is the download's: the connect phase's zero bytes would halve it
            if (p.stage === 'download') this.samples = [];
        }
        this.p = p;
        const last = this.samples[this.samples.length - 1];
        if (!last || last.b !== p.loaded || now - last.t > 500) this.samples.push({ t: now, b: p.loaded });
        // keep one sample older than the window as its base
        while (this.samples.length > 2 && now - this.samples[1].t > SPEED_WINDOW_MS) this.samples.shift();
        this.render();
    }

    private mb(bytes: number): string {
        return this.nf.format(bytes / 1e6);
    }

    /** bytes per second over the window, or 0 before there is a window */
    private speed(now: number): number {
        const s = this.samples;
        if (s.length < 2) return 0;
        const a = s[0];
        const b = s[s.length - 1];
        const dt = Math.max(now, b.t) - a.t;
        return dt >= 1000 ? ((b.b - a.b) * 1000) / dt : 0;
    }

    private stageText(p: LoadProgress): string {
        if (p.stage === 'done') return t(p.partial ? 'loading.stage.partial' : 'loading.stage.ready');
        if (p.stage !== 'download') return t(`loading.stage.${p.stage}`);
        const scanLeft = !p.scan.done;
        const wallsLeft = !!p.walls && !p.walls.done;
        return t(scanLeft && wallsLeft ? 'loading.stage.both' : wallsLeft ? 'loading.stage.walls' : 'loading.stage.scan');
    }

    private part(label: string, part: LoadPart): string {
        if (part.cached) return `${label} ${CHECK} ${t('loading.part.cached')}`;
        if (part.done || (part.total > 0 && part.loaded >= part.total && part.exact)) return `${label} ${CHECK} ${t('loading.bytesOnly', { got: this.mb(part.total) })}`;
        if (part.total <= 0) return `${label} …`;
        return `${label} ${t(part.exact ? 'loading.bytes' : 'loading.bytesApprox', { got: this.mb(part.loaded), total: this.mb(part.total) })}`;
    }

    private render(): void {
        if (this.finished) return;
        const now = performance.now();
        const p = this.p;
        const stage = p?.stage ?? 'connect';
        this.root.dataset.stage = stage;
        this.elapsedEl.textContent = t('loading.elapsed', { s: Math.floor((now - this.startedAt) / 1000) });
        if (!p) return;
        this.stageEl.textContent = this.stageText(p);

        // determinate while bytes are the story; an honest sweep where no number exists
        const determinate = stage === 'download' && p.total > 0;
        this.root.toggleAttribute('data-indeterminate', !determinate);
        this.fill.style.transform = `scaleX(${stage === 'connect' ? 0 : p.fraction})`;
        const pct = Math.round(p.fraction * 100);
        if (determinate) {
            this.bar.setAttribute('aria-valuenow', String(pct));
            this.bar.setAttribute('aria-valuetext', `${pct} %, ${t('loading.bytes', { got: this.mb(p.loaded), total: this.mb(p.total) })}`);
        } else {
            this.bar.removeAttribute('aria-valuenow');
            this.bar.setAttribute('aria-valuetext', this.stageText(p));
        }

        // numbers: how much of how much, speed and time left while downloading
        const nums: string[] = [];
        if (p.total > 0 && stage !== 'connect') nums.push(t(p.exact ? 'loading.bytes' : 'loading.bytesApprox', { got: this.mb(p.loaded), total: this.mb(p.total) }));
        else if (p.loaded >= SHOW_BYTES_MIN) nums.push(t('loading.bytesOnly', { got: this.mb(p.loaded) }));
        const v = now - p.lastByteAt < SPEED_QUIET_MS ? this.speed(now) : 0;
        if (stage === 'download' && v > 0) {
            nums.push(t('loading.speed', { v: this.mb(v) }));
            const left = (p.total - p.loaded) / v;
            if (left >= LEFT_MIN_S && now - this.stageAt >= SPEED_WINDOW_MS) {
                nums.push(left < 90 ? t('loading.left', { s: Math.ceil(left) }) : t('loading.leftMin', { m: Math.round(left / 60) }));
            }
        }
        this.numsEl.textContent = nums.join(' · ');

        const parts = [this.part(t('loading.part.scan'), p.scan)];
        if (p.walls) parts.push(this.part(t('loading.part.walls'), p.walls));
        this.partsEl.textContent = stage === 'connect' && p.loaded === 0 ? '' : parts.join(' · ');

        // silence: a hint after 10 s, a way out after 20 s; a failed file gets the way out at once
        const waitingForBytes = stage === 'connect' || stage === 'download';
        const quietMs = now - Math.max(this.startedAt, this.stageAt, waitingForBytes ? p.lastByteAt : 0);
        const quietS = Math.floor(quietMs / 1000);
        let key = '';
        let actions = false;
        if (p.failed > 0) {
            key = 'loading.failed';
            actions = true;
        } else if (quietMs >= STALL_HINT_MS) {
            actions = quietMs >= STALL_ACTIONS_MS;
            key = !waitingForBytes ? 'loading.stallPrepare' : actions ? 'loading.stallLong' : 'loading.stall';
        }
        const hint = key ? t(key, { s: quietS }) : '';
        if (this.hintEl.textContent !== hint) this.hintEl.textContent = hint;
        this.hintEl.classList.remove('note');
        this.say(key, key ? t(key, { s: Math.floor((key === 'loading.stallLong' ? STALL_ACTIONS_MS : STALL_HINT_MS) / 1000) }) : '');
        this.root.toggleAttribute('data-actions', actions);
    }

    private say(key: string, text: string): void {
        if (key === this.srKey) return;
        this.srKey = key;
        this.srEl.textContent = text;
    }

    /** "The scan is ready" for a moment, then fade to the scan; resolves when the screen is gone. */
    async finish(): Promise<void> {
        if (this.finished) return;
        this.render();
        this.finished = true;
        clearInterval(this.timer);
        // shown after a long silence: say so, and leave the bar where the bytes left it
        const partial = !!this.p?.partial;
        const f = partial ? this.p!.fraction : 1;
        this.root.dataset.stage = 'done';
        this.root.toggleAttribute('data-partial', partial);
        this.root.removeAttribute('data-indeterminate');
        this.root.removeAttribute('data-actions');
        this.root.setAttribute('aria-busy', 'false');
        this.fill.style.transform = `scaleX(${f})`;
        this.bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
        this.stageEl.textContent = t(partial ? 'loading.stage.partial' : 'loading.stage.ready');
        this.hintEl.textContent = this.next ?? '';
        this.hintEl.classList.add('note');
        this.say('done', `${this.stageEl.textContent} ${this.next ?? ''}`.trim());
        await sleep(READY_MS);
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.root.classList.add('leaving');
            await sleep(FADE_MS);
        }
        this.root.remove();
    }

    remove(): void {
        this.finished = true;
        clearInterval(this.timer);
        this.root.remove();
    }
}

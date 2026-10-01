// Types of visual-browser.mjs (plain JS, run by node as it is).
import type { BrowserInfo, BrowserPick } from '../src/chrome.mjs';

type Env = Record<string, string | undefined>;
/** The part of a Playwright Page the gate uses. */
interface PageLike { evaluate<T>(f: () => T | Promise<T>): Promise<T> }

export interface BrowserRecord extends BrowserInfo {
    userAgent: string | null;
    /** the WebGL renderer the page got, null without WebGL */
    webgl: string | null;
    softwareGl: boolean;
    /** false: no picture or timing of this run counts (software GL, or not system Chrome) */
    counts: boolean;
}

export const SOFTWARE_GL: RegExp;
export function isSoftwareGl(renderer: string | null | undefined): boolean;
export function softwareAllowed(env?: Env): boolean;
export class NoGpuError extends Error {}
export function pickHarnessBrowser(o?: Parameters<typeof import('../src/chrome.mjs').pickBrowser>[0], visual?: boolean): BrowserPick;
export function webglRenderer(page: PageLike): Promise<string | null>;
export function browserRecord(info: BrowserInfo | BrowserPick, page: PageLike, o?: { visual?: boolean; env?: Env; version?: string }): Promise<BrowserRecord>;

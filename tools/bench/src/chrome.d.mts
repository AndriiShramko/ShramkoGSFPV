// Types of chrome.mjs (plain JS, shared with apps/site/scripts).
export type BrowserKind = 'system-chrome' | 'bundled-chromium' | 'custom';
export interface BrowserPick {
    kind: BrowserKind;
    /** headless unless BENCH_VISIBLE=1 (chrome.mjs header) */
    /** args: only with BENCH_UNCAPPED=1, the flags that free the frames from the display's pacing (chrome.mjs) */
    launch: ({ channel: 'chrome' } | { executablePath: string }) & { headless: boolean; args?: string[] };
    executable: string | null;
    why: string;
}
export interface BrowserInfo {
    kind: BrowserKind;
    version: string | null;
    executable: string | null;
    why: string;
}
type Env = Record<string, string | undefined>;
export function systemChromePaths(env?: Env, platform?: string): string[];
export function browserRoots(env?: Env, platform?: string): string[];
export function bundledChromium(env?: Env, platform?: string, exists?: (p: string) => boolean, list?: (dir: string) => string[]): string | null;
export function isPlaywrightBuild(path: string): boolean;
export function pickBrowser(o?: { env?: Env; platform?: string; expected?: string; exists?: (p: string) => boolean; list?: (dir: string) => string[]; realpath?: (p: string) => string }): BrowserPick;
export function describeBrowser(pick: BrowserPick, version?: string): BrowserInfo;
export function benchHeadless(env?: Record<string, string | undefined>): boolean;
export const UNCAPPED_ARGS: readonly string[];
export function benchUncappedArgs(env?: Record<string, string | undefined>): string[];

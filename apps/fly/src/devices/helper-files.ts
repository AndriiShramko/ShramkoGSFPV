// The helper program for DJI controllers on Windows (tools/rc-bridge, lane connect C3, docs/wip/connect.md): its two
// files, given by the page itself so the pilot gets real files with one press each (a link to raw files on another
// site opens them as text in a tab, and Chrome ignores `download` on another origin). The bytes are the repository's
// files at the release's commit, bundled as text (Vite ?raw) and loaded only when the helper is offered. Until they
// are loaded each link points at the same file in the public repository. start-dji-helper.cmd gets Windows line ends
// here whatever the checkout did: cmd.exe finds its labels reliably only with CRLF.

/** the two files as the pilot saves them, in the order he needs them: the one he double-clicks first. The program is
 * saved as dji-helper.py (the pilot never reads the word bridge); start-dji-helper.cmd runs the newest dji-helper*.py
 * or rc_bridge*.py next to it. */
export const HELPER_NAMES = ['start-dji-helper.cmd', 'dji-helper.py'] as const;
export type HelperName = (typeof HELPER_NAMES)[number];
/** each file's name in the repository's tools/rc-bridge */
export const HELPER_SOURCE: Record<HelperName, string> = { 'start-dji-helper.cmd': 'start-dji-helper.cmd', 'dji-helper.py': 'rc_bridge.py' };

/** the same file in the public repository (main): the fallback until the bundled copy is ready */
export const helperRaw = (name: HelperName): string =>
    `https://raw.githubusercontent.com/AndriiShramko/ShramkoGSFPV/main/tools/rc-bridge/${HELPER_SOURCE[name]}`;

export function windowsLines(s: string): string {
    return s.replace(/\r?\n/g, '\r\n');
}

export type HelperTexts = Record<HelperName, string>;
export interface HelperFile { name: HelperName; url: string }

/** the bundled texts (a separate chunk, fetched on first use) */
export async function loadHelperTexts(): Promise<HelperTexts> {
    const [cmd, py] = await Promise.all([
        import('../../../../tools/rc-bridge/start-dji-helper.cmd?raw'),
        import('../../../../tools/rc-bridge/rc_bridge.py?raw'),
    ]);
    return { 'start-dji-helper.cmd': cmd.default, 'dji-helper.py': py.default };
}

const blobUrl = (text: string): string => URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));

/** the two files as same-origin URLs the page's `download` links can save */
export async function helperFiles(load: () => Promise<HelperTexts> = loadHelperTexts, url: (text: string, name: HelperName) => string = blobUrl): Promise<HelperFile[]> {
    const texts = await load();
    return HELPER_NAMES.map((name) => ({ name, url: url(name.endsWith('.cmd') ? windowsLines(texts[name]) : texts[name], name) }));
}

// Copying text from a click (share/panel.ts: the link, Instagram's caption). The Clipboard API first;
// where it is refused (a page over http, an older browser, no permission) the old
// document.execCommand('copy') on a scratch text area that is removed at once. The page's own fields
// are never written: the link field once kept Instagram's caption after such a copy, its line breaks
// stripped, because an <input> drops them (evidence/2026-10-13/v07-d1-S1-control-e344977.json).
// A text area keeps them.

/** What copyText needs of the page: the real navigator and document in the browser, fakes in tests. */
export interface ClipboardEnv {
    clipboard?: { writeText(text: string): Promise<void> };
    document: {
        createElement(tag: 'textarea'): HTMLTextAreaElement;
        body: { append(node: Node): void };
        activeElement: Element | null;
        execCommand(command: 'copy'): boolean;
    };
}

/** The page's own clipboard and document. */
function pageEnv(): ClipboardEnv {
    return { clipboard: navigator.clipboard, document };
}

/** Copies `text` (inside a click or a key press); false when the browser refused both ways. */
export async function copyText(text: string, env: ClipboardEnv = pageEnv()): Promise<boolean> {
    try {
        if (!env.clipboard) throw new Error('no Clipboard API');
        await env.clipboard.writeText(text);
        return true;
    } catch {
        const doc = env.document;
        const back = doc.activeElement as (Element & { focus?: (o?: FocusOptions) => void }) | null;
        const scratch = doc.createElement('textarea');
        scratch.value = text;
        scratch.readOnly = true;
        scratch.setAttribute('aria-hidden', 'true');
        scratch.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        doc.body.append(scratch);
        scratch.select();
        let ok = false;
        try {
            ok = doc.execCommand('copy');
        } catch {
            ok = false;
        }
        scratch.remove();
        back?.focus?.({ preventScroll: true });
        return ok;
    }
}

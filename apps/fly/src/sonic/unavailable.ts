// Fly by Sound could not load (v0.12, v12-int step 4): the chunk of the start screen and the sound package (sonic/lazy-start.ts)
// did not arrive (offline, a release replaced under the page). The page must not stay silent for a pilot who cannot see it, so the
// line the start screen says for a lesson that did not open (sonic.say.lessonFailed) is shown in an alert (a screen reader reads
// it at once), said by the browser's own voice where it may speak (the engine is in the chunk that did not load), and said again
// at the first key press (a key is the user activation a voice may wait for). "Try again" reloads the page, which loads the chunk
// anew. Main chunk: no import of the sound package.
import { locale, t } from '../i18n';

function speak(text: string): void {
    try {
        const synth = globalThis.speechSynthesis;
        if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = locale;
        synth.cancel();
        synth.speak(u);
    } catch {
        // no voice here: the alert is read by a screen reader, and seen
    }
}

/** Shows and says that Fly by Sound did not load; returns the box (for tests). */
export function sonicUnavailable(doc: Document = document): HTMLElement {
    const text = t('sonic.say.lessonFailed');
    const box = doc.createElement('div');
    box.className = 'sonic-unavailable';
    box.setAttribute('role', 'alert');
    box.setAttribute('data-testid', 'sonic-unavailable');
    box.style.cssText = 'position:fixed;inset:auto 16px 16px 16px;z-index:100;padding:16px;background:#111;color:#fff;font:18px/1.4 system-ui,sans-serif;border:2px solid #fff;border-radius:8px';
    const p = doc.createElement('p');
    p.style.margin = '0 0 12px';
    p.textContent = text;
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.textContent = t('loading.retry');
    retry.style.cssText = 'font:inherit;padding:8px 16px';
    retry.addEventListener('click', () => location.reload());
    box.append(p, retry);
    doc.body.append(box);
    retry.focus();
    speak(text);
    const again = (): void => {
        removeEventListener('keydown', again, true);
        removeEventListener('pointerdown', again, true);
        speak(text);
    };
    addEventListener('keydown', again, true);
    addEventListener('pointerdown', again, true);
    return box;
}

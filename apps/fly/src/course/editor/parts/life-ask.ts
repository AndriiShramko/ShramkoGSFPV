// Lane edit4b (design edit4 1.4): the question before a step that drops the pilot's work, a modal with its own 44 px
// cross. The design expects lane gen4's dialog with this signature in apps/fly/src/app/ask.ts; it was not there when this
// lane started, so this file holds the same signature and the merge swaps one import (docs/wip/edit4b.md, For the lead).
// Focus starts on No; Esc, the cross and a click outside the box answer No; Enter answers what has the focus.
import { t } from '../../../i18n';
import './life.css';

export interface AskFirst {
    readonly titleKey: string;
    readonly bodyKey: string;
    readonly vars?: Record<string, string | number>;
    readonly yesKey: string;
    readonly noKey: string;
}

/** the dialog open now (one at a time: a second question answers the first No) */
let open: { answer: (yes: boolean) => void } | null = null;

export function askOpen(): boolean {
    return open !== null;
}

export function askFirst(q: AskFirst, parent: HTMLElement = document.body): Promise<boolean> {
    open?.answer(false);
    return new Promise<boolean>((resolve) => {
        const back = document.createElement('div');
        back.className = 'life-ask-back interactive';
        const box = document.createElement('div');
        box.className = 'life-ask';
        box.setAttribute('role', 'alertdialog');
        box.setAttribute('aria-modal', 'true');
        const title = document.createElement('h2');
        title.id = 'life-ask-title';
        title.textContent = t(q.titleKey, q.vars);
        const body = document.createElement('p');
        body.id = 'life-ask-body';
        body.textContent = t(q.bodyKey, q.vars);
        box.setAttribute('aria-labelledby', title.id);
        box.setAttribute('aria-describedby', body.id);
        const cross = document.createElement('button');
        cross.type = 'button';
        cross.className = 'life-ask-x';
        cross.dataset.ask = 'close';
        cross.setAttribute('aria-label', t('course.life.ask.close'));
        cross.textContent = '×';
        const row = document.createElement('div');
        row.className = 'life-ask-row';
        const no = document.createElement('button');
        no.type = 'button';
        no.dataset.ask = 'no';
        no.textContent = t(q.noKey, q.vars);
        const yes = document.createElement('button');
        yes.type = 'button';
        yes.dataset.ask = 'yes';
        yes.className = 'life-ask-yes';
        yes.textContent = t(q.yesKey, q.vars);
        row.append(no, yes);
        box.append(cross, title, body, row);
        back.append(box);
        // the editor's keys (Delete, Ctrl+Z, W A S D ...) do nothing while the question is open
        const onKey = (e: KeyboardEvent): void => {
            if (e.code === 'Escape') { e.preventDefault(); answer(false); }
            else if (e.code === 'Tab') { e.preventDefault(); (document.activeElement === no ? yes : no).focus(); }
            else if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Space') e.preventDefault();
            e.stopImmediatePropagation();
        };
        const answer = (v: boolean): void => {
            if (open !== me) return;
            open = null;
            window.removeEventListener('keydown', onKey, true);
            back.remove();
            resolve(v);
        };
        const me = { answer };
        open = me;
        no.addEventListener('click', () => answer(false));
        cross.addEventListener('click', () => answer(false));
        yes.addEventListener('click', () => answer(true));
        back.addEventListener('pointerdown', (e) => { if (e.target === back) answer(false); });
        window.addEventListener('keydown', onKey, true);
        parent.append(back);
        no.focus();
    });
}

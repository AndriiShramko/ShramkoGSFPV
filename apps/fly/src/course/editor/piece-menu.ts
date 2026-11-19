// What Add puts (lane edit4c, stage C2, complaint E12; design edit4.md 1.3 'add (menu: Gate, then C's pieces)' and 5 C2).
// Add still arms a plain gate with one press (editor3's path stays one press); while it is armed this small list under the
// top bar offers the ready pieces (pieces.ts): a press on one makes the next click on the scene put that piece. Its 44 px
// cross ends adding, as Esc and a second press on Add do. The list's items come from PIECES, so a new piece is one table row.
import { t } from '../../i18n';
import { ADD_CHOICES, ADD_CHOICE_KEYS, ADD_CLOSE_KEY, ADD_TITLE_KEY, type AddChoice } from './pieces-texts';
import './pieces.css';

export interface AddChooserHost {
    /** a press on an item: the next click on the scene puts it */
    choose(what: AddChoice): void;
    /** the cross: adding ends */
    close(): void;
    /** the bottom of the editor's top bar on the page, CSS px, and the left edge of its Add button */
    anchor(): { readonly top: number; readonly left: number };
}

export class AddChooser {
    readonly root: HTMLElement;
    private readonly items = new Map<AddChoice, HTMLButtonElement>();
    private chosen: AddChoice = 'gate';

    constructor(ui: HTMLElement, private readonly host: AddChooserHost) {
        const root = document.createElement('div');
        root.className = 'ce-add interactive';
        root.setAttribute('role', 'menu');
        root.dataset.testid = 'add-chooser';
        const title = document.createElement('div');
        title.className = 'ce-add-title';
        title.textContent = t(ADD_TITLE_KEY);
        root.append(title);
        for (const what of ADD_CHOICES) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ce-add-item';
            b.setAttribute('role', 'menuitemradio');
            b.dataset.add = what;
            b.textContent = t(ADD_CHOICE_KEYS[what]);
            b.addEventListener('click', () => {
                b.blur();
                this.pick(what);
                host.choose(what);
            });
            this.items.set(what, b);
            root.append(b);
        }
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'ce-add-x';
        x.textContent = '×';
        x.setAttribute('aria-label', t(ADD_CLOSE_KEY));
        x.title = t(ADD_CLOSE_KEY);
        x.addEventListener('click', () => {
            x.blur();
            host.close();
        });
        root.append(x);
        root.hidden = true;
        ui.append(root);
        this.root = root;
    }

    /** Add is armed (`on`) for `what`, or no more: the list shows under the Add button, the chosen item pressed */
    show(on: boolean, what: AddChoice = 'gate'): void {
        this.pick(what);
        this.root.hidden = !on;
        if (!on) return;
        const a = this.host.anchor();
        const w = this.root.offsetWidth || 220;
        this.root.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, a.left)))}px`;
        this.root.style.top = `${Math.round(a.top + 6)}px`;
    }

    private pick(what: AddChoice): void {
        this.chosen = what;
        for (const [k, b] of this.items) b.setAttribute('aria-checked', k === what ? 'true' : 'false');
    }

    /** read only, for the page probes */
    debug(): { open: boolean; chosen: AddChoice; items: string[] } {
        return { open: !this.root.hidden, chosen: this.chosen, items: [...this.items.keys()] };
    }

    destroy(): void {
        this.root.remove();
    }
}

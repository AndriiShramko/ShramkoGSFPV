// The menu registry and the pause menu that shows it (MenuRegistry in context.ts). Features add
// their items; the menu lists them by `order` and binds the keys it shows beside them.
import { dialogOpen } from '../devices/keyboard';
import { pauseMenu } from '../ui/pause';
import type { MenuItem, MenuRegistry, PauseReason } from './context';
import type { KeyRouter } from './keys';

export class PauseMenu implements MenuRegistry {
    private list: MenuItem[] = [];
    private closeUi: (() => void) | null = null;
    private unbind: (() => void)[] = [];
    private ui: HTMLElement;
    private keys: KeyRouter;
    private hold: { pause(r: PauseReason): void; resume(r: PauseReason): void };

    constructor(ui: HTMLElement, keys: KeyRouter, hold: { pause(r: PauseReason): void; resume(r: PauseReason): void }) {
        this.ui = ui;
        this.keys = keys;
        this.hold = hold;
    }

    add(item: MenuItem): () => void {
        this.list.push(item);
        return () => {
            const i = this.list.indexOf(item);
            if (i >= 0) this.list.splice(i, 1);
        };
    }

    items(): readonly MenuItem[] {
        return [...this.list].sort((a, b) => a.order - b.order);
    }

    get isOpen(): boolean {
        return this.closeUi !== null;
    }

    open(): void {
        // over another dialog (settings, a picker) the menu's Continue would fly under that dialog
        if (this.isOpen || dialogOpen()) return;
        this.hold.pause('menu');
        const items = this.items();
        this.closeUi = pauseMenu(this.ui, items, (it) => this.pick(it), () => this.close());
        // with the menu up, a key shown beside an item is that item (P / Esc continue, R restarts)
        for (const it of items) if (it.action) this.unbind.push(this.keys.on(it.action, () => this.pick(it)));
    }

    close(): void {
        if (!this.isOpen) return;
        this.dismiss();
        this.hold.resume('menu');
    }

    private pick(it: MenuItem): void {
        if (it.enabled?.() === false) return; // a disabled item's key does nothing either
        this.dismiss();
        it.run();
        this.hold.resume('menu');
    }

    private dismiss(): void {
        this.closeUi?.();
        this.closeUi = null;
        for (const u of this.unbind.splice(0)) u();
    }
}

// The menu registry and the pause menu that shows it (MenuRegistry in context.ts). Features add
// their items; the menu lists them by `order`, shows each item's keys (the keymap, through the
// router) and, while it is up, lets those keys run the item. Since D.2 the menu is the summary
// panel: the summary feature (builtin/summary.ts) hands it the flight's stats and the keymap's
// shortcuts through setSummary, and they show beside the items.
import { dialogOpen } from '../devices/keyboard';
import { pauseMenu } from '../ui/pause';
import type { SummaryData } from '../ui/summary';
import type { MenuItem, MenuRegistry, PauseReason } from './context';
import type { KeyRouter } from './keys';

export class PauseMenu implements MenuRegistry {
    private list: MenuItem[] = [];
    private closeUi: (() => void) | null = null;
    private unbind: (() => void)[] = [];
    private ui: HTMLElement;
    private keys: KeyRouter;
    private hold: { pause(r: PauseReason): void; resume(r: PauseReason): void };
    private summary: (() => SummaryData | null) | null = null;

    constructor(ui: HTMLElement, keys: KeyRouter, hold: { pause(r: PauseReason): void; resume(r: PauseReason): void }) {
        this.ui = ui;
        this.keys = keys;
        this.hold = hold;
    }

    add(item: MenuItem): () => void {
        if (this.list.some((x) => x.id === item.id)) throw new Error(`menu item ${item.id} added twice`);
        this.list.push(item);
        return () => {
            const i = this.list.indexOf(item);
            if (i >= 0) this.list.splice(i, 1);
        };
    }

    /** What the summary panel shows beside the items, taken each time the menu opens (after its pause). */
    setSummary(source: (() => SummaryData | null) | null): void {
        this.summary = source;
    }

    /** The items in menu order (by `order`; equal orders keep the order they were added in). */
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
        const entries = items.map((it) => ({ id: it.id, labelKey: it.labelKey, keys: it.action ? this.keys.caps(it.action) : [], disabled: it.enabled?.() === false }));
        this.closeUi = pauseMenu(this.ui, entries, (i) => this.pick(items[i]), () => this.close(), this.summary?.() ?? null);
        // with the menu up, a key shown beside an item is that item (P / Esc continue, R restarts)
        for (const it of items) if (it.action && this.keys.routes(it.action)) this.unbind.push(this.keys.on(it.action, () => this.pick(it)));
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

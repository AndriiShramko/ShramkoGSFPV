// Train 1, lane rooms: name tags over the other pilots' drones: a DOM overlay over the canvas, each tag placed every frame
// by projecting its drone's position through the flight camera. Hidden with the HUD; hidden from screen readers (the member
// list and key 0 say the same).
import { Vec3 as PcVec3 } from 'playcanvas';
import type { Entity } from 'playcanvas';
import type { Vec3 } from './around';
import { nearAlpha } from './remote-stage';

/** The tag sits this far above the drone, metres (estimate: clear of a 0.25 m drone). */
const TAG_LIFT_M = 0.3;

export interface Tag { slot: number; nick: string; pos: Vec3; frozen: boolean }

export class NameTags {
    readonly root: HTMLDivElement;
    private readonly tags = new Map<number, HTMLSpanElement>();
    private readonly w = new PcVec3();
    private readonly s = new PcVec3();

    constructor(parent: HTMLElement, private readonly camera: () => Entity | null) {
        this.root = document.createElement('div');
        this.root.className = 'rooms-tags';
        this.root.setAttribute('aria-hidden', 'true');
        this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
        parent.append(this.root);
    }

    /** Places the tags of this frame; `shown` false hides them all (the HUD is off). */
    update(list: readonly Tag[], shown: boolean): void {
        const cam = this.camera();
        this.root.style.display = shown && cam?.camera ? '' : 'none';
        const keep = new Set<number>();
        if (shown && cam?.camera) {
            const fwd = cam.forward;
            const cp = cam.getPosition();
            for (const tg of list) {
                this.w.set(tg.pos[0], tg.pos[1] + TAG_LIFT_M, tg.pos[2]);
                // the near rule (remote-stage.ts): a drone too near the camera has no tag either; in the fade band the tag fades
                const near = nearAlpha(Math.hypot(tg.pos[0] - cp.x, tg.pos[1] - cp.y, tg.pos[2] - cp.z));
                if (near <= 0) continue;
                // behind the camera: no tag
                const ahead = (this.w.x - cp.x) * fwd.x + (this.w.y - cp.y) * fwd.y + (this.w.z - cp.z) * fwd.z;
                if (ahead <= 0) continue;
                cam.camera.worldToScreen(this.w, this.s);
                let el = this.tags.get(tg.slot);
                if (!el) {
                    el = document.createElement('span');
                    el.className = 'rooms-tag';
                    el.style.cssText = 'position:absolute;transform:translate(-50%,-100%);font:600 12px/1.2 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:1px 6px;border-radius:4px;white-space:nowrap;';
                    this.root.append(el);
                    this.tags.set(tg.slot, el);
                }
                if (el.textContent !== tg.nick) el.textContent = tg.nick;
                el.style.left = `${this.s.x.toFixed(1)}px`;
                el.style.top = `${this.s.y.toFixed(1)}px`;
                el.style.opacity = String(+((tg.frozen ? 0.5 : 1) * near).toFixed(3));
                keep.add(tg.slot);
            }
        }
        for (const [slot, el] of this.tags) {
            if (keep.has(slot)) continue;
            el.remove();
            this.tags.delete(slot);
        }
    }

    /** the slots tagged now (the page hook) */
    get slots(): number[] {
        return [...this.tags.keys()];
    }

    dispose(): void {
        this.root.remove();
        this.tags.clear();
    }
}

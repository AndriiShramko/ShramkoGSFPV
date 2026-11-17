// Integration F, seam c: the walls and voxel panel and the voxel legend use lane uiaudit's parts (ui/panel-head.ts,
// decision U1) instead of their own header, so they look and close like every other panel of the fly page.
// The panel's Esc is ONE mechanism: closeTop picks the top panel; the legend gets a cross that switches the grid off.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string): string => readFileSync(join(__dirname, '../../../apps/fly/src', p), 'utf8');
const walls = src('walls.ts');
const voxels = src('ui/voxels.ts');
const css = src('fly.css').replace(/\/\*[\s\S]*?\*\//g, '');

function rule(sel: string): string {
    const m = css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    return m ? m[2]! : '';
}

describe('walls and voxel panel (seam c)', () => {
    it('its header is panelHead with the probes\' action names kept', () => {
        expect(walls).toMatch(/panelHead\(t\('voxels\.panel\.title'\)/);
        expect(walls).toContain("dataset.action = 'voxpanel-close'");
        expect(walls).not.toContain('walls-head-btn');
    });
    it('the menu carries data-panel, so closeTop finds its cross', () => {
        expect(walls).toMatch(/class: 'walls-menu'[^\n]*'data-panel'/);
    });
    it('Esc with the panel open goes through closeTop (one mechanism) and stops there', () => {
        const esc = walls.slice(walls.indexOf('const onEsc'), walls.indexOf("window.addEventListener('keydown', onEsc, true)"));
        expect(esc).toContain('closeTop(document)');
        expect(esc).toContain('stopPropagation');
    });
    it('the opening caption is drawn as a 44 px button; text is 12 px or more', () => {
        expect(rule('[data-testid="walls-summary"]')).toMatch(/min-height:\s*44px/);
        expect(rule('[data-testid="walls-summary"]')).toMatch(/border:/);
        expect(rule('.walls-menu')).toMatch(/font-size:\s*12px/);
        expect(rule('.wv kbd')).toMatch(/12px/);
    });
});

describe('voxel legend (seam c, uiaudit fault 2)', () => {
    it('has a cross from panelHead that switches the grid off', () => {
        expect(voxels).toMatch(/panelHead\('', \{ close: t\('voxels\.legendOff'\) \}, \(\) => v\.setMode\('off'\)\)/);
        expect(rule('.voxel-legend .vl-x')).toMatch(/pointer-events:\s*auto/);
    });
    it('its small line is 12 px', () => {
        expect(rule('.vl-sub')).toMatch(/font-size:\s*12px/);
    });
    it('on a narrow or short view it stands below the lone speaker button, so its cross is not covered', () => {
        const m = css.match(/@media \(max-width: 640px\), \(max-height: 500px\) \{ \.voxel-legend \{ top: calc\(var\(--top-row-bottom, 78px\) \+ (\d+)px\); \} \}/);
        expect(m).not.toBeNull();
        // the speaker: top-row-bottom + 8 px, 40 px high; the legend must start below it
        expect(Number(m![1])).toBeGreaterThanOrEqual(48);
    });
});

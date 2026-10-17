// The few pictures the studio paints itself (v0.9 lane D): the weave of carbon fibre, fine streaks for brushed metal, the
// fade of the floor, and the studio's light (an equirectangular picture of softboxes the engine turns into reflections).
// Canvas 2D only; nothing is downloaded.

const canvas = (w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) throw new Error('no 2d canvas');
    return { c, g };
};

/** A 2x2 twill: each tow is a rounded strip, lighter along its middle; the over/under pattern shifts a cell a row. */
export function carbonWeave(size = 128): HTMLCanvasElement {
    const { c, g } = canvas(size, size);
    const n = 8, cell = size / n;
    g.fillStyle = '#202225';
    g.fillRect(0, 0, size, size);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const warpOnTop = ((x + y) % 4) < 2;
            const x0 = x * cell, y0 = y * cell;
            const grad = warpOnTop ? g.createLinearGradient(x0, 0, x0 + cell, 0) : g.createLinearGradient(0, y0, 0, y0 + cell);
            const tone = warpOnTop ? 176 : 150;
            grad.addColorStop(0, `rgb(${tone * 0.42},${tone * 0.42},${tone * 0.45})`);
            grad.addColorStop(0.5, `rgb(${tone},${tone},${tone * 1.02})`);
            grad.addColorStop(1, `rgb(${tone * 0.42},${tone * 0.42},${tone * 0.45})`);
            g.fillStyle = grad;
            g.fillRect(x0 + 0.5, y0 + 0.5, cell - 1, cell - 1);
        }
    }
    return c;
}

/** Fine streaks along one direction, used to break up the gloss of machined metal. Values stay near white. */
export function brushedStreaks(w = 256, h = 64): HTMLCanvasElement {
    const { c, g } = canvas(w, h);
    g.fillStyle = '#e8e8e8';
    g.fillRect(0, 0, w, h);
    let seed = 7;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 520; i++) {
        const y = rnd() * h, len = 20 + rnd() * 120, x = rnd() * w;
        const v = 190 + Math.floor(rnd() * 60);
        g.strokeStyle = `rgba(${v},${v},${v},${0.18 + rnd() * 0.3})`;
        g.lineWidth = 0.5 + rnd();
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (rnd() - 0.5) * 0.8); g.stroke();
    }
    return c;
}

/** The floor: a soft round pool of light that fades to nothing at the edge (alpha), so the model stands in a spot, not on a plane. */
export function floorFade(size = 256): HTMLCanvasElement {
    const { c, g } = canvas(size, size);
    const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.45, 'rgba(235,238,245,0.92)');
    r.addColorStop(0.8, 'rgba(210,216,228,0.35)');
    r.addColorStop(1, 'rgba(200,206,220,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, size, size);
    return c;
}

/**
 * The studio's light as an equirectangular picture: a dark room, a big softbox above and to the left (the key), a tall strip
 * to the right, a cool rim behind, a faint floor bounce. The engine filters it into the reflections and the ambient light
 * of every material, so metal and glass have something to mirror.
 */
export function studioEnvironment(w = 512, h = 256): HTMLCanvasElement {
    const { c, g } = canvas(w, h);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#2a3040');
    sky.addColorStop(0.5, '#10141b');
    sky.addColorStop(1, '#171b22');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const box = (cx: number, cy: number, bw: number, bh: number, level: number, tint: string): void => {
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(bw, bh));
        rg.addColorStop(0, `rgba(${tint},${level})`);
        rg.addColorStop(0.6, `rgba(${tint},${level * 0.55})`);
        rg.addColorStop(1, `rgba(${tint},0)`);
        g.fillStyle = rg;
        g.fillRect(cx - bw * 1.3, cy - bh * 1.3, bw * 2.6, bh * 2.6);
        g.fillStyle = `rgba(${tint},${Math.min(1, level * 1.1)})`;
        g.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
    };
    // equirect: u = azimuth (0..w), v = elevation (0 = up). The model faces -Z, the studio's camera orbits it.
    box(w * 0.30, h * 0.22, w * 0.16, h * 0.20, 1, '255,246,232'); // key softbox, up and to one side
    box(w * 0.78, h * 0.42, w * 0.05, h * 0.34, 0.95, '236,244,255'); // tall strip
    box(w * 0.55, h * 0.30, w * 0.12, h * 0.08, 0.8, '210,228,255'); // cool rim from behind
    box(w * 0.05, h * 0.5, w * 0.06, h * 0.22, 0.55, '255,240,225'); // fill
    const floor = g.createLinearGradient(0, h * 0.62, 0, h);
    floor.addColorStop(0, 'rgba(70,76,88,0)');
    floor.addColorStop(1, 'rgba(70,76,88,0.9)');
    g.fillStyle = floor;
    g.fillRect(0, h * 0.62, w, h * 0.38);
    return c;
}

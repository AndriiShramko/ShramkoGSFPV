import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Production build = the simulator only (served at /{locale}/fly/, assets under /fly/).
// The lab pages (probes, determinism, latency controls) exist only in dev/preview builds.
const lab = process.env.GSFPV_LAB === '1';

export default defineConfig({
    base: '/fly/',
    build: {
        target: 'es2022',
        outDir: lab ? 'dist-lab' : 'dist',
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            input: lab
                ? {
                      main: resolve(__dirname, 'index.html'),
                      a1engine: resolve(__dirname, 'lab/a1-engine.html'),
                      a1viewer: resolve(__dirname, 'lab/a1-viewer.html'),
                      det: resolve(__dirname, 'lab/det.html'),
                      blank: resolve(__dirname, 'lab/blank.html'),
                      flash: resolve(__dirname, 'lab/flash.html')
                  }
                : { main: resolve(__dirname, 'index.html') }
        }
    },
    server: { port: 5190, strictPort: true },
    preview: { port: 5191, strictPort: true }
});

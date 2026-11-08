// A stand-in for apps/fly/src/sonic-session/texts.ts in the browser probes of the recording panel (tools/bench/src/sonicrec-*.ts). The real module adds the
// recorder's dictionaries to t()'s with Vite's import.meta.glob (v12-int step 4: they come with the session side's lazy chunk), which esbuild cannot
// bundle; the probes' own i18n stand-in (sonicrec-i18n-shim.ts) reads the same four JSON files, so there is nothing to add.
export {};

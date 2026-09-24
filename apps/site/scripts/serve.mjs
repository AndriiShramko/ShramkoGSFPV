// Serve a COPY of out/ (so a rebuild never fights a running server over locked files).
// Usage: node scripts/serve.mjs [port]  → prints the base URL, keeps running.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
const port = Number(process.argv[2] ?? 8137);
const dir = mkdtempSync(join(tmpdir(), "gsfpv-site-"));
cpSync(OUT, dir, { recursive: true });
const py = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "inherit" });
console.log(`serving copy of out/ from ${dir} at http://127.0.0.1:${port}/`);
const stop = () => {
  py.kill();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
py.on("exit", () => stop());

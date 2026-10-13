import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Static export: nginx:alpine serves ./out. The bare "/" is redirected by nginx
// (cookie NEXT_LOCALE, then Accept-Language); out/index.html repeats that logic
// client-side as a fallback (written by scripts/fix-lang.mjs).
// The simulator (/{locale}/fly/) is a separate Vite app merged into out/ later.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // the catalogue reader (@gsfpv/scenes/catalog: one set of rules with the simulator and the admin) ships as TypeScript
  transpilePackages: ["@gsfpv/scenes"],
};

export default withNextIntl(nextConfig);

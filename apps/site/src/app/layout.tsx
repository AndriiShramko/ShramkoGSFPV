import type { ReactNode } from "react";
import type { Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#07080a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

// The root layout carries one lang at build time ("en"); scripts/fix-lang.mjs rewrites it per
// locale folder after `next build`, and LangSync keeps it right on client navigations.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

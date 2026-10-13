import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing, type Locale } from "@/i18n/routing";

/**
 * The scene page templates (docs/wip/v07-a.md section 4): rendered at build time with the landing's own
 * header, footer and classes, then turned into API templates by scripts/scene-templates.mjs (every
 * executable script dropped, the route itself removed from out/). No client components here: the scene
 * pages run no JavaScript, so nothing may depend on hydration (no consent banner, no feedback button).
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function SceneTemplateLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale as Locale);
  return children;
}

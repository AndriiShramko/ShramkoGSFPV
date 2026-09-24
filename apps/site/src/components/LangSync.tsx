"use client";
import { useEffect } from "react";
import type { Locale } from "@/i18n/routing";

/** Keeps <html lang> right on client navigations (the static export has one root layout). */
export default function LangSync({ locale }: { locale: Locale }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}

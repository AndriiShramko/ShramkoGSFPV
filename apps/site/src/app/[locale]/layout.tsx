import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { routing, type Locale } from "@/i18n/routing";
import ClickTracker from "@/components/ClickTracker";
import ConsentBanner from "@/components/ConsentBanner";
import LangSync from "@/components/LangSync";

export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale as Locale);
  // Only the client components' strings go into the RSC payload (banner + lead form).
  const messages = (await getMessages()) as Record<string, Record<string, unknown>>;
  const clientMessages = { consent: messages.consent, contact: { form: messages.contact.form } } as AbstractIntlMessages;
  return (
    <NextIntlClientProvider messages={clientMessages}>
      <LangSync locale={locale as Locale} />
      <ClickTracker />
      {children}
      <ConsentBanner />
    </NextIntlClientProvider>
  );
}

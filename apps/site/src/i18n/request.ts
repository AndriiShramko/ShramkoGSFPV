import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import en from "@gsfpv/i18n/site/en.json";
import es from "@gsfpv/i18n/site/es.json";
import pl from "@gsfpv/i18n/site/pl.json";
import ru from "@gsfpv/i18n/site/ru.json";
import { routing } from "./routing";

const MESSAGES = { en, es, pl, ru };

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { locale, messages: MESSAGES[locale] };
});

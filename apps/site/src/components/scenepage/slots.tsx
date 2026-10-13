import type { ReactNode } from "react";
import en from "@gsfpv/i18n/scenepage/en.json";
import es from "@gsfpv/i18n/scenepage/es.json";
import pl from "@gsfpv/i18n/scenepage/pl.json";
import ru from "@gsfpv/i18n/scenepage/ru.json";
import type { Locale } from "@/i18n/routing";

/**
 * The slot language of the scene page templates (apps/api/templating.py), written into the HTML as plain
 * text at build time. The site renders the design; the API fills the slots with escaped data at request
 * time (apps/api/scenepages.py). Every name must be listed in apps/api/scene-slots.json: the postbuild
 * (scripts/scene-templates.mjs) refuses a template that uses another one.
 */

/** An escaped text slot. */
export const slot = (name: string): string => `{{${name}}}`;

/** A raw slot (markup the API builds and escapes itself: the head tags, the JSON-LD). */
export const rawSlot = (name: string): string => `{{{${name}}}}`;

/** Repeated for each item of the list `name`; inside, the item's own slots. */
export function Each({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      {`[[#${name}]]`}
      {children}
      {`[[/${name}]]`}
    </>
  );
}

/** Shown when `name` is set (a text, a true flag, a list with items). */
export function If({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      {`[[?${name}]]`}
      {children}
      {`[[/${name}]]`}
    </>
  );
}

/** Shown when `name` is not set. */
export function Unless({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      {`[[^${name}]]`}
      {children}
      {`[[/${name}]]`}
    </>
  );
}

/** The scene pages' own words (packages/i18n/locales/scenepage/<lang>.json, `ui`); `gen` is the API's. */
export function sceneWords(locale: Locale) {
  return { en, es, pl, ru }[locale].ui;
}

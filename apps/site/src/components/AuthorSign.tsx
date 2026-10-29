import { useTranslations } from "next-intl";
import { AUTHOR } from "@/config/site";
import { Ext } from "./kit";

/** The owner's signature: his photo in a circle and his public contacts (people should see who made the project). */
export default function AuthorSign() {
  const t = useTranslations("supporters.author");
  const link = "link inline-flex min-h-11 items-center";
  return (
    <div className="flex flex-col gap-5 rounded-xl border border-line bg-surface/60 p-6 sm:flex-row sm:items-center">
      <picture className="shrink-0">
        <source type="image/webp" srcSet="/media/andrii-shramko-160.webp 1x, /media/andrii-shramko-320.webp 2x" />
        <img src="/media/andrii-shramko-320.jpg" alt={AUTHOR.name} width={96} height={96} loading="lazy" decoding="async" className="size-24 rounded-full border border-line-strong object-cover" />
      </picture>
      <div>
        <p className="text-lg font-semibold text-ink">{AUTHOR.name}</p>
        <p className="text-sm text-muted">{t("role")}</p>
        <p className="mt-3 max-w-2xl text-ink/85">{t("note")}</p>
        <ul className="mt-2 flex flex-wrap gap-x-5 text-sm">
          <li>
            <a href={`mailto:${AUTHOR.email}`} className={link} data-track="cta_click" data-p="email">
              {AUTHOR.email}
            </a>
          </li>
          <li>
            <Ext href={AUTHOR.calendar} className={link} track="cta_click" p="calendar">
              {t("call")}
            </Ext>
          </li>
          <li>
            <Ext href={AUTHOR.linkedin} className={link} track="cta_click" p="linkedin">
              LinkedIn
            </Ext>
          </li>
          <li>
            <Ext href={AUTHOR.github} className={link} track="cta_click" p="github">
              GitHub
            </Ext>
          </li>
        </ul>
      </div>
    </div>
  );
}

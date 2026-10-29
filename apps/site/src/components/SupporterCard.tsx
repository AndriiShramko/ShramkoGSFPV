import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { supporterPath, type Supporter } from "@/lib/supporters";
import { Ext } from "./kit";

/** One person on the supporters wall; their own page shows the same card as a preview (`linked={false}`). */
export default function SupporterCard({ p, locale, linked = true }: { p: Supporter; locale: Locale; linked?: boolean }) {
  const t = useTranslations("supporters.card");
  const text = p.text[locale];
  const home = p.links[0];
  return (
    <article className="flex h-full flex-col gap-4 rounded-xl border border-line bg-surface/60 p-5">
      <div className="flex items-center gap-4">
        <img src={p.photo} alt="" width={64} height={64} loading="lazy" decoding="async" className="size-16 shrink-0 rounded-full border border-line-strong object-cover" />
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-ink">
            {linked ? (
              <a href={supporterPath(locale, p.slug)} className="link">
                {p.name}
              </a>
            ) : (
              p.name
            )}
          </h3>
          <p className="text-sm text-muted">{text.role}</p>
        </div>
      </div>
      <p className="text-sm">
        {p.review ? (
          <Ext href={p.review.href} className="link">
            {t("review", { platform: p.review.platform })}: {p.review.title}
          </Ext>
        ) : (
          <span className="text-muted">{t("pending")}</span>
        )}
      </p>
      {home ? (
        <p className="mt-auto text-sm">
          <Ext href={home.href} className="link inline-flex min-h-11 items-center">
            {home.label}
          </Ext>
        </p>
      ) : null}
    </article>
  );
}

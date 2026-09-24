import { flyPath } from "@/config/site";

/**
 * Mobile bottom bar with the primary CTA (desktop has it in the sticky header).
 * Hidden by CSS while a text field is focused so it never covers the on-screen keyboard.
 */
export default function StickyCTA({ locale, label, note }: { locale: string; label: string; note: string }) {
  return (
    <aside aria-label={label} className="sticky-cta fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-xl items-center gap-3">
        <p className="min-w-0 flex-1 text-sm leading-snug text-muted">{note}</p>
        <a href={flyPath(locale)} data-track="fly_click" className="btn-primary min-h-12 shrink-0 px-5">
          {label}
        </a>
      </div>
    </aside>
  );
}

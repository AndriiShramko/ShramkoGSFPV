import type { ReactNode } from "react";

/** Server-safe layout primitives. Content is visible with JavaScript off. */
export function Section({ id, index, eyebrow, title, lead, tone = "plain", children }: { id: string; index: string; eyebrow: string; title: ReactNode; lead?: ReactNode; tone?: "plain" | "surface"; children?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-16 border-t border-line ${tone === "surface" ? "bg-surface/50" : ""}`}>
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8 sm:py-24">
        <p className="eyebrow">
          <span className="text-muted">{index}</span>
          <span aria-hidden="true" className="mx-2 text-line-strong">/</span>
          {eyebrow}
        </p>
        <h2 id={`${id}-title`} className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {title}
        </h2>
        {lead ? <p className="mt-4 max-w-2xl text-lg text-muted">{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}

export function ExternalMark() {
  return (
    <span aria-hidden="true" className="ml-1 inline-block text-[0.85em]">
      ↗
    </span>
  );
}

export function Ext({ href, children, className = "", track, p }: { href: string; children: ReactNode; className?: string; track?: string; p?: string }) {
  // Only real attributes: undefined props would end up as "$undefined" in the RSC payload.
  const data = { ...(track ? { "data-track": track } : {}), ...(p ? { "data-p": p } : {}) };
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} {...data}>
      {children}
      <ExternalMark />
    </a>
  );
}

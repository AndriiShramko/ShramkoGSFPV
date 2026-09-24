"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { LEAD_ENDPOINT } from "@/config/site";

/**
 * Collaboration form: choose-one chips, one optional free-text field, email, specific consent.
 * Anti-spam without CAPTCHA: hidden honeypot + time-to-submit (a submit faster than 3 s after
 * render is simply delayed until 3 s have passed, so a human never sees an error).
 * The draft survives a page refresh (localStorage, wrapped in try/catch).
 */
const ROLES = ["pilot", "vendor", "studio", "investor", "developer"] as const;
// "takedown" is only offered when the simulator's "Report this scene" button links here with
// /{locale}/?report=<8 hex scene id>#contact.
const ALL_ROLES = [...ROLES, "takedown"] as const;
type Role = (typeof ALL_ROLES)[number];
const DRAFT_KEY = "gsfpv.lead.draft.v1";
const MAX_MESSAGE = 500;
const MIN_MS = 3000;
const SCENE_ID = /^[0-9a-f]{8}$/;

type Draft = { role: Role | ""; message: string; email: string };

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

function reportedScene(): string | null {
  try {
    const id = new URLSearchParams(window.location.search).get("report");
    return id && SCENE_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export default function LeadForm() {
  const t = useTranslations("contact.form");
  const format = useFormatter();
  const locale = useLocale();
  const [d, setD] = useState<Draft>({ role: "", message: "", email: "" });
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [report, setReport] = useState<string | null>(null);
  const renderedAt = useRef(0);
  const loaded = useRef(false);

  useEffect(() => {
    renderedAt.current = performance.now();
    let draft: Draft = { role: "", message: "", email: "" };
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Draft>;
        draft = {
          role: (ALL_ROLES as readonly string[]).includes(p.role as string) ? (p.role as Role) : "",
          message: typeof p.message === "string" ? p.message.slice(0, MAX_MESSAGE) : "",
          email: typeof p.email === "string" ? p.email : "",
        };
      }
    } catch {
      /* storage blocked or corrupt draft — start empty */
    }
    const scene = reportedScene();
    if (scene) {
      draft = { ...draft, role: "takedown", message: draft.message.trim() ? draft.message : `Scene ${scene}: ` };
      setReport(scene);
    }
    setD(draft);
    loaded.current = true;
    if (scene) {
      // scroll now, and once more when images and fonts above have loaded and shifted the layout
      const toForm = () => document.getElementById("contact")?.scrollIntoView({ block: "start" });
      requestAnimationFrame(toForm);
      if (document.readyState !== "complete") window.addEventListener("load", () => requestAnimationFrame(toForm), { once: true });
    }
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* ignore */
    }
  }, [d]);

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!d.role) m.push(t("missing.role"));
    if (!emailOk(d.email)) m.push(t("missing.email"));
    if (!consent) m.push(t("missing.consent"));
    return m;
  }, [d, consent, t]);
  const valid = missing.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || state === "sending") return;
    setState("sending");
    const elapsed = performance.now() - renderedAt.current;
    if (elapsed < MIN_MS) await new Promise((r) => setTimeout(r, MIN_MS - elapsed));
    const body = {
      role: d.role,
      message: d.message.trim().slice(0, MAX_MESSAGE),
      email: d.email.trim(),
      locale,
      consent: true,
      t: Math.round(performance.now() - renderedAt.current),
      hp,
    };
    try {
      const r = await fetch(LEAD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("not ok");
      setState("done");
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div role="status" data-testid="lead-success" className="rounded-xl border border-accent/40 bg-surface p-6 sm:p-8">
        <p className="text-lg font-semibold text-accent">{t("done.title")}</p>
        <p className="mt-2 text-muted">{t("done.text")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="relative rounded-xl border border-line bg-surface p-5 sm:p-8" aria-describedby="lead-status">
      <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
        </label>
      </div>

      <fieldset>
        <legend className="text-base font-semibold text-ink">{t("role.label")}</legend>
        {report ? (
          <p className="mt-2 text-sm text-muted" data-testid="lead-report">
            {t("reportNotice", { id: report })}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {(report || d.role === "takedown" ? ALL_ROLES : ROLES).map((r) => (
            <label key={r} className="relative">
              <input
                type="radio"
                name="role"
                value={r}
                checked={d.role === r}
                onChange={() => setD((p) => ({ ...p, role: r }))}
                className="peer sr-only"
              />
              <span className="chip peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                {t(`role.${r}`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6">
        <label htmlFor="lead-message" className="block text-base font-semibold text-ink">
          {t("message.label")} <span className="font-normal text-muted">{t("message.optional")}</span>
        </label>
        <textarea
          id="lead-message"
          name="message"
          rows={3}
          maxLength={MAX_MESSAGE}
          placeholder={t("message.placeholder")}
          value={d.message}
          onChange={(e) => setD((p) => ({ ...p, message: e.target.value.slice(0, MAX_MESSAGE) }))}
          className="field mt-2"
          aria-describedby="lead-message-count"
        />
        <p id="lead-message-count" className="mt-1 text-right font-mono text-xs text-muted">
          {d.message.length}/{MAX_MESSAGE}
        </p>
      </div>

      <div className="mt-4">
        <label htmlFor="lead-email" className="block text-base font-semibold text-ink">
          {t("email.label")}
        </label>
        <input
          id="lead-email"
          name="email"
          type="email"
          required
          inputMode="email"
          autoComplete="email"
          placeholder={t("email.placeholder")}
          value={d.email}
          onChange={(e) => setD((p) => ({ ...p, email: e.target.value }))}
          className="field mt-2"
          aria-invalid={d.email.length > 0 && !emailOk(d.email) ? true : undefined}
        />
      </div>

      <label className="mt-6 flex min-h-11 cursor-pointer items-start gap-3 text-sm text-muted">
        <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-accent" />
        <span>
          {t("consent.text")}{" "}
          <a href={`/${locale}/privacy/`} className="link">
            {t("consent.link")}
          </a>
          .
        </span>
      </label>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="submit" disabled={!valid || state === "sending"} className="btn-primary min-h-12 shrink-0 whitespace-nowrap px-6 disabled:cursor-not-allowed disabled:opacity-50">
          {state === "sending" ? t("sending") : t("submit")}
        </button>
        <p id="lead-status" aria-live="polite" className="text-sm text-muted">
          {valid ? t("ready") : `${t("missing.prefix")} ${format.list(missing, { type: "conjunction" })}.`}
        </p>
      </div>
      {state === "error" && (
        <p role="alert" className="mt-4 rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm text-ink">
          {t("error")}
        </p>
      )}
    </form>
  );
}

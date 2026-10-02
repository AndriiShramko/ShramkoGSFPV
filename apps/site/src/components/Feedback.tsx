"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { REPORT_ENDPOINT } from "@/config/site";

/**
 * "Feedback" on every page (bottom left, above the phone's Fly bar): a bug or an idea goes to
 * /api/report (the owner gets a Telegram note with the report's id; the simulator's dialog is the same,
 * apps/fly builtin/feedback.ts), cooperation goes to the contact form on the landing. A bug carries the
 * technical details listed under the consent box only when it is ticked. Anti-spam as the lead form:
 * a hidden honeypot and time-to-submit (a send sooner than 3 s waits, it never fails).
 */
type Kind = "bug" | "idea" | "coop";
const KINDS: readonly Kind[] = ["bug", "idea", "coop"];
const MIN_MS = 3000;
const MESSAGE_MAX = 2000;
const CONTACT_MAX = 200;
const ERRORS_KEPT = 20;

async function releaseSha(): Promise<string> {
  try {
    const r = await fetch("/release.json", { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as { sha?: unknown };
      if (typeof j.sha === "string") return j.sha;
    }
  } catch {
    /* dev server, offline */
  }
  return "dev";
}

export default function Feedback() {
  const t = useTranslations("feedback");
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const openedAt = useRef(0);
  const errors = useRef<string[]>([]);
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "error" | "missing">("idle");
  const [doneId, setDoneId] = useState<string | null>(null);

  // the page's errors from now on, for a bug report whose sender agrees to attach them
  useEffect(() => {
    const keep = (s: string) => {
      errors.current.push(`${new Date().toISOString().slice(11, 19)} ${s.replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, "$1").slice(0, 400)}`);
      if (errors.current.length > ERRORS_KEPT) errors.current.shift();
    };
    const onError = (e: ErrorEvent) => keep(`error: ${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})`);
    const onReject = (e: PromiseRejectionEvent) => keep(`rejection: ${String(e.reason)}`);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onReject);
    };
  }, []);

  function open() {
    openedAt.current = performance.now();
    setDoneId(null);
    setState("idle");
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
  }

  function toContact() {
    close();
    const form = document.getElementById("contact");
    if (form) {
      form.scrollIntoView({ block: "start" });
      form.querySelector<HTMLInputElement>("input[name=role]")?.focus({ preventScroll: true });
    } else {
      window.location.href = `/${locale}/#contact`;
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (kind === "coop" || state === "sending") return;
    if (!message.trim()) {
      setState("missing");
      return;
    }
    setState("sending");
    for (let left = MIN_MS - (performance.now() - openedAt.current); left > 0; left = MIN_MS - (performance.now() - openedAt.current)) {
      await new Promise((r) => setTimeout(r, Math.ceil(left) + 1));
    }
    const release = await releaseSha();
    const withDiag = kind === "bug" && consent;
    const body = {
      kind,
      message: message.trim().slice(0, MESSAGE_MAX),
      contact: contact.trim().slice(0, CONTACT_MAX),
      locale,
      page: "site",
      release,
      t: Math.round(performance.now() - openedAt.current),
      hp,
      diagnosticsConsent: withDiag,
      ...(withDiag
        ? {
            diagnostics: {
              release,
              browser: { userAgent: navigator.userAgent, languages: navigator.languages?.slice(0, 4), screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio }, viewport: { w: innerWidth, h: innerHeight } },
              page: { path: location.pathname, at: new Date().toISOString() },
              errors: [...errors.current],
            },
          }
        : {}),
    };
    try {
      const r = await fetch(REPORT_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as { ok?: boolean; id?: string };
      if (!r.ok || !j.ok || !j.id) throw new Error("not ok");
      setMessage("");
      setDoneId(j.id);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const sending = state === "sending";
  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-label={t("buttonLabel")}
        title={t("buttonLabel")}
        data-testid="feedback-open"
        className="fixed bottom-[84px] left-3 z-40 inline-flex min-h-10 items-center gap-2 rounded-full border border-line-strong bg-surface/90 px-4 text-sm text-ink shadow-lg backdrop-blur hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:bottom-4 md:left-4"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm3 5v2h10V9H7zm0 4v2h7v-2H7z" />
        </svg>
        {t("button")}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="feedback-title"
        data-testid="feedback"
        className="m-auto w-[min(600px,calc(100vw-32px))] rounded-xl border border-line bg-surface p-0 text-ink backdrop:bg-black/70"
        onClick={(e) => {
          if (e.target === dialog.current) close(); // a click on the backdrop
        }}
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id="feedback-title" className="text-xl font-semibold">
              {t("title")}
            </h2>
            <button type="button" onClick={close} aria-label={t("close")} className="-m-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-2xl text-muted hover:text-ink">
              ×
            </button>
          </div>
          {doneId ? (
            <div role="status" data-testid="feedback-done" className="mt-4">
              <p className="text-lg font-semibold text-accent">{t("done.title")}</p>
              <p className="mt-2 text-muted">{t("done.id", { id: doneId })}</p>
              <p className="mt-3">
                <code data-testid="feedback-id" className="rounded-lg border border-line bg-bg px-3 py-1 font-mono text-lg">
                  {doneId}
                </code>
              </p>
              <button type="button" onClick={close} className="btn-primary mt-6 min-h-12 px-6">
                {t("close")}
              </button>
            </div>
          ) : (
            <form onSubmit={send} noValidate className="mt-2">
              <p className="text-sm text-muted">{t("lead")}</p>
              <div role="radiogroup" aria-label={t("kind.label")} className="mt-4 grid grid-cols-3 gap-2">
                {KINDS.map((k) => (
                  <label key={k} className="relative">
                    <input type="radio" name="feedback-kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="peer sr-only" data-testid={`feedback-kind-${k}`} />
                    <span className="chip w-full justify-center peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                      {t(`kind.${k}`)}
                    </span>
                  </label>
                ))}
              </div>
              {kind === "coop" ? (
                <div className="mt-5">
                  <p className="text-muted">{t("coop.text")}</p>
                  <button type="button" onClick={toContact} className="btn-primary mt-4 min-h-12 px-6" data-testid="feedback-coop">
                    {t("coop.go")}
                  </button>
                </div>
              ) : (
                <>
                  <label htmlFor="feedback-message" className="mt-5 block font-semibold">
                    {t(`${kind}.message`)}
                  </label>
                  <textarea
                    id="feedback-message"
                    rows={4}
                    maxLength={MESSAGE_MAX}
                    value={message}
                    placeholder={t(`${kind}.placeholder`)}
                    onChange={(e) => setMessage(e.target.value)}
                    className="field mt-2"
                    data-testid="feedback-message"
                  />
                  <label htmlFor="feedback-contact" className="mt-4 block font-semibold">
                    {t("contact.label")}
                  </label>
                  <input
                    id="feedback-contact"
                    type="text"
                    maxLength={CONTACT_MAX}
                    autoComplete="email"
                    value={contact}
                    placeholder={t("contact.placeholder")}
                    onChange={(e) => setContact(e.target.value)}
                    className="field mt-2"
                  />
                  {kind === "bug" ? (
                    <div className="mt-4">
                      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-describedby="feedback-diag" className="mt-0.5 h-6 w-6 shrink-0 accent-accent" data-testid="feedback-consent" />
                        <span className="font-semibold">{t("diag.consent")}</span>
                      </label>
                      <div id="feedback-diag" className="ml-3 border-l-2 border-line pl-4 text-sm text-muted">
                        <p>{t("diag.what")}</p>
                        <ul className="mt-1 list-disc pl-5">
                          {(t.raw("diag.items") as string[]).map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                        <p className="mt-1">{t("diag.none")}</p>
                      </div>
                    </div>
                  ) : null}
                  <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
                    <label>
                      Website
                      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
                    </label>
                  </div>
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button type="submit" disabled={sending} className="btn-primary min-h-12 shrink-0 px-6 disabled:cursor-not-allowed disabled:opacity-50" data-testid="feedback-send">
                      {sending ? t("sending") : t("send")}
                    </button>
                    <p aria-live="polite" className="text-sm text-muted">
                      {state === "missing" ? t("missing") : state === "error" ? t("error") : ""}
                    </p>
                  </div>
                </>
              )}
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}

// Site analytics — two layers:
//
//  A) First-party cookieless counter: navigator.sendBeacon('/api/e', JSON.stringify({e, p})).
//     No cookie, no device id, no free text; only whitelisted event names and parameter values.
//     Runs for every visitor (no consent needed); the server does not store IP addresses.
//
//  B) Google Analytics 4 — ONLY when NEXT_PUBLIC_GA_ID was set at build time AND the visitor
//     pressed "Accept". Before that no Google script is requested at all. Consent Mode starts
//     with every storage type denied; "Accept" grants analytics_storage only.
import { EVENT_ENDPOINT } from "@/config/site";

type GtagFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
    dataLayer?: unknown[];
    __gsfpvGa?: boolean;
  }
}

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "";

/** Event whitelist with the allowed values of `p` ("" = no parameter). */
export const EVENTS = {
  lang_switch: ["en", "es", "pl", "ru"],
  cta_click: ["github", "calendar", "linkedin", "email"],
  scene_open: ["showcase", "paste"],
  fly_click: [""],
} as const;

export type TrackEvent = keyof typeof EVENTS;

export function isTrackEvent(e: string): e is TrackEvent {
  return Object.prototype.hasOwnProperty.call(EVENTS, e);
}

export function track(e: TrackEvent, p = "") {
  if (typeof window === "undefined") return;
  const allowed = EVENTS[e] as readonly string[];
  const param = allowed.includes(p) ? p : "";
  try {
    const body = JSON.stringify({ e, p: param });
    if (typeof navigator.sendBeacon === "function") navigator.sendBeacon(EVENT_ENDPOINT, body);
    else void fetch(EVENT_ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => undefined);
  } catch {
    /* analytics must never break the page */
  }
  try {
    if (typeof window.gtag === "function") window.gtag("event", e, param ? { p: param } : {});
  } catch {
    /* ignore */
  }
}

/** Loads gtag.js — called only after the visitor accepted analytics cookies. */
export function loadGaWithConsent() {
  if (typeof window === "undefined" || !GA_ID || window.__gsfpvGa) return;
  window.__gsfpvGa = true;
  window.dataLayer = window.dataLayer || [];
  const gtag: GtagFn = function gtag() {
    // gtag.js expects the Arguments object itself
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag = gtag;
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    functionality_storage: "denied",
    personalization_storage: "denied",
    security_storage: "denied",
    wait_for_update: 500,
  });
  gtag("consent", "update", { analytics_storage: "granted" });
  gtag("js", new Date());
  gtag("config", GA_ID, { anonymize_ip: true });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
}

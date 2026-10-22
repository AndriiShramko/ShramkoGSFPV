// Site analytics — two layers:
//
//  A) First-party cookieless counter: navigator.sendBeacon('/api/e', JSON.stringify({e, p})).
//     No cookie, no device id, no free text; only whitelisted event names and parameter values
//     (apps/api/server.py EVENTS; apps/api/tests/test_events.py keeps the two lists together).
//     Runs for every visitor; the server does not store IP addresses. One page_view {locale} per page.
//
//  B) Google Analytics 4 (WEB-TECH-BASELINE T6, Consent Mode basic): gtag.js is requested ONLY after
//     the visitor pressed "Accept" (here or in the simulator: the same localStorage key on the same
//     origin). Consent Mode starts with every storage type denied; "Accept" grants analytics_storage
//     only, then `config` sends this page's GRANTED page_view. Decline later (footer "Cookie settings",
//     the privacy page) withdraws: consent update denied, ga-disable, the _ga cookies deleted.
//     GA event parameters have their own names (the GA4 custom dimensions): site_lang, cta_id,
//     cta_location, lang_to, method, source, scene_id, section_id, form_id, lead_type.
import { EVENT_ENDPOINT } from "@/config/site";

type GtagFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
    dataLayer?: unknown[];
    __gsfpvGa?: boolean;
    [gaDisable: `ga-disable-${string}`]: boolean | undefined;
  }
}

/**
 * GA4 property "ShramkoGSFPV": a public Measurement ID, not a secret. It is committed here on purpose
 * (an ID read from the build environment silently disappears when a release is built without it);
 * scripts/build-release.mjs and deploy/deploy.sh refuse a release whose bundles lack it.
 */
export const GA_ID = "G-E7X0ES0QBE";
/** 14 months (426 days), the property's data retention. */
const GA_COOKIE_SECONDS = 426 * 24 * 3600;
/** "yes" | "no"; the simulator (apps/fly/src/app/analytics.ts) reads and writes the same key. */
export const CONSENT_KEY = "gsfpv_consent";
/** ConsentBanner listens for it: the footer's "Cookie settings" and the privacy page open the banner again. */
export const CONSENT_OPEN_EVENT = "gsfpv:consent-open";

/** Event whitelist with the allowed values of `p` ("" = no parameter); the same names as the API's. */
export const EVENTS = {
  lang_switch: ["en", "es", "pl", "ru"],
  cta_click: ["github", "calendar", "linkedin", "email"],
  scene_open: ["showcase", "paste"],
  fly_click: [""],
  page_view: ["en", "es", "pl", "ru"],
} as const;

export type TrackEvent = keyof typeof EVENTS;

export function isTrackEvent(e: string): e is TrackEvent {
  return Object.prototype.hasOwnProperty.call(EVENTS, e);
}

function send(e: TrackEvent, param: string) {
  try {
    const body = JSON.stringify({ e, p: param });
    if (typeof navigator.sendBeacon === "function") navigator.sendBeacon(EVENT_ENDPOINT, body);
    else void fetch(EVENT_ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => undefined);
  } catch {
    /* analytics must never break the page */
  }
}

function lang(): string {
  return (document.documentElement.lang || "und").slice(0, 5).toLowerCase();
}

/** Where on the page a click happened: the section id, "sticky", "header", "footer" or "page". */
export function ctaLocation(el: Element | null | undefined): string {
  const s = el?.closest<HTMLElement>("section[id],header,footer,aside,[role=dialog]");
  if (!s) return "page";
  if (s.id) return s.id.slice(0, 40);
  if (s.classList.contains("sticky-cta")) return "sticky";
  return s.tagName.toLowerCase();
}

/** A GA4 event, only once the visitor accepted (before that gtag does not exist); never throws. True when sent. */
export function gaEvent(name: string, params: Record<string, string | number | boolean> = {}): boolean {
  if (typeof window === "undefined" || !window.__gsfpvGa || typeof window.gtag !== "function" || window[`ga-disable-${GA_ID}`]) return false;
  try {
    window.gtag("event", name, { site_lang: lang(), ...params });
    return true;
  } catch {
    return false;
  }
}

/** The scene id of a /xx/fly/?scene=<id> link, when it is a plain id (not a pasted address). */
function sceneOf(el: Element | null | undefined): string {
  const href = el?.getAttribute("href") ?? "";
  const m = href.match(/[?&]scene=([0-9a-f]{6,32})(?:&|$)/);
  return m ? m[1] : "";
}

/**
 * The whitelisted counter event and its GA4 twin. `el`: the clicked element (where it was, which scene).
 * A click that navigates this tab right away (language, fly, scene) asks for transport_type "beacon"; GA4
 * hands its batch to a keepalive request when the page goes away in any case (checked 2026-10-21: the
 * lang_switch of a click leaves /en/ before /pl/ loads).
 */
export function track(e: TrackEvent, p = "", el?: Element | null) {
  if (typeof window === "undefined") return;
  const allowed = EVENTS[e] as readonly string[];
  const param = allowed.includes(p) ? p : "";
  send(e, param);
  if (e === "page_view") return; // GA counts its own page_view (config), never twice
  const at = { cta_location: ctaLocation(el) };
  const away = { ...at, transport_type: "beacon" };
  if (e === "lang_switch") gaEvent("lang_switch", { lang_to: param, transport_type: "beacon" });
  else if (e === "cta_click" && param === "email") gaEvent("contact_click", { method: "email", ...at });
  else if (e === "cta_click") gaEvent("cta_click", { cta_id: param || "other", ...at });
  else if (e === "scene_open") {
    const scene = sceneOf(el);
    gaEvent("scene_open", { source: param || "other", ...(scene ? { scene_id: scene } : {}), ...away });
  } else if (e === "fly_click") gaEvent("fly_click", { cta_id: "fly", ...away });
}

/** One server-side page view per page (the counter of layer A; GA's own page_view is layer B). */
export function countPageView(locale: string) {
  if (typeof window === "undefined") return;
  send("page_view", (EVENTS.page_view as readonly string[]).includes(locale) ? locale : "");
}

export function storedConsent(): string | null {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

export function storeConsent(v: "yes" | "no") {
  try {
    localStorage.setItem(CONSENT_KEY, v);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

/** Loads gtag.js — called only after the visitor accepted analytics cookies. */
export function loadGaWithConsent() {
  if (typeof window === "undefined" || !GA_ID) return;
  if (window.__gsfpvGa) {
    // accepted again after a withdrawal on this page: the tag is there, switch it back on
    window[`ga-disable-${GA_ID}`] = false;
    window.gtag?.("consent", "update", { analytics_storage: "granted" });
    return;
  }
  window.__gsfpvGa = true;
  window[`ga-disable-${GA_ID}`] = false;
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
  gtag("set", { allow_google_signals: false, allow_ad_personalization_signals: false });
  // the cookie stays on this host (the default would put _ga on .flyreelstudio.eu, shared by every subdomain)
  // and lives 14 months, as long as the property keeps its data (the privacy notice says both)
  gtag("config", GA_ID, { cookie_domain: location.hostname, cookie_expires: GA_COOKIE_SECONDS, site_lang: lang() });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
}

/** Every _ga / _ga_<suffix> cookie, on this host and on each parent domain (an older tag wrote .flyreelstudio.eu). */
export function dropGaCookies() {
  const names = document.cookie
    .split(";")
    .map((c) => c.split("=")[0].trim())
    .filter((n) => /^_ga(_|$)/.test(n));
  const parts = location.hostname.split(".");
  const domains = [""];
  for (let i = 0; i < parts.length - 1; i++) domains.push(`.${parts.slice(i).join(".")}`);
  for (const n of names) for (const d of domains) document.cookie = `${n}=; Max-Age=0; path=/${d ? `; domain=${d}` : ""}`;
}

/** Decline (also after an Accept): stored, and a tag already on the page stops sending and forgets its cookies. */
export function withdrawConsent() {
  storeConsent("no");
  if (typeof window === "undefined") return;
  try {
    if (window.__gsfpvGa) window.gtag?.("consent", "update", { analytics_storage: "denied" });
  } catch {
    /* ignore */
  }
  window[`ga-disable-${GA_ID}`] = true;
  dropGaCookies();
}

/** Show the consent banner again (footer "Cookie settings", the privacy page's button). */
export function openConsent() {
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}

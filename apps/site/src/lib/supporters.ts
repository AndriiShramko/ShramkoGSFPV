import data from "@gsfpv/i18n/supporters/people.json";
import type { Locale } from "@/i18n/routing";

/**
 * People invited to try the simulator and people who helped it (docs/wip/supporters.md). `invited`: a draft
 * page made before the first message (noindex, off the sitemap and the wall); `joined`: public.
 */
export type SupporterText = { role: string; about: string; why: string; offer: string[] };
export type SupporterLink = { label: string; href: string };
export type SupporterWork = { title: string; href: string; date: string };
/** A review they published; `thumb` is a local copy (the CSP allows images from this site only). */
export type SupporterReview = { kind: "video" | "post"; href: string; title: string; date: string; platform: string; thumb?: string };
export type Supporter = {
  slug: string;
  name: string;
  status: "invited" | "joined";
  since: string;
  lang: Locale;
  photo: string;
  links: SupporterLink[];
  works: SupporterWork[];
  scene?: string;
  review: SupporterReview | null;
  text: Record<Locale, SupporterText>;
};

export const SUPPORTERS = (data as unknown as { people: Supporter[] }).people;

export const joinedSupporters = (): Supporter[] => SUPPORTERS.filter((p) => p.status === "joined");

export const findSupporter = (slug: string): Supporter | undefined => SUPPORTERS.find((p) => p.slug === slug);

export const supporterPath = (locale: string, slug: string) => `/${locale}/supporters/${slug}/`;

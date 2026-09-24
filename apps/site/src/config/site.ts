// Public facts only. Contact values come from the owner's publication rules; no phone, no address.
export const SITE = "https://gsfpv.flyreelstudio.eu";
export const REPO = "https://github.com/AndriiShramko/ShramkoGSFPV";
export const REPO_BLOB = `${REPO}/blob/main`;
export const REPO_TREE = `${REPO}/tree/main`;
export const GOOD_FIRST_ISSUES = `${REPO}/issues?q=is%3Aopen+label%3A%22good+first+issue%22`;
export const EVIDENCE_URL = `${REPO_TREE}/evidence`;

export const AUTHOR = {
  name: "Andrii Shramko",
  linkedin: "https://www.linkedin.com/in/andrii-shramko/",
  calendar: "https://calendar.app.google/Ff729HqGk4RpzPNDA",
  email: "zmei116@gmail.com",
  github: "https://github.com/AndriiShramko",
} as const;

export const LEAD_ENDPOINT = "/api/lead";
export const EVENT_ENDPOINT = "/api/e";

export const AGENT_PROMPT =
  "Set up ShramkoGSFPV for me by following https://github.com/AndriiShramko/ShramkoGSFPV/blob/main/AGENT_SETUP.md exactly. Install, run the checks, start the simulator locally and open it in Chrome. Do not change any system settings; ask me only if a step needs my password or a physical action.";

/** Andrii's showcase scans (CC BY 4.0). Titles are translated in messages under scenes.items.<id>. */
export const SHOWCASE = [
  { id: "39e63ce9", kind: "interior" },
  { id: "7a475d38", kind: "interior" },
  { id: "887f27aa", kind: "exterior" },
] as const;

export type ShowcaseId = (typeof SHOWCASE)[number]["id"];

export const posterUrl = (id: string, size: "m" | "l" | "xl" = "m") =>
  `https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/${id}/v1/${size}.webp`;
export const superSplatUrl = (id: string) => `https://superspl.at/scene/${id}`;

export const flyPath = (locale: string) => `/${locale}/fly/`;

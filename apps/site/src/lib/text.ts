/** Typography only: a range such as "8–30 ms" never breaks after its dash, a dash never starts a line. */
export const keepTogether = (s: string): string => s.replace(/(\d)–(?=\d)/g, "$1–⁠").replace(/ — /g, " — ");

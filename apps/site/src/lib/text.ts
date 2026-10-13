/** Typography only: a range such as "8\u201330 ms" never breaks after its dash, a dash never starts a line. */
export const keepTogether = (s: string): string => s.replace(/(\d)\u2013(?=\d)/g, "$1\u2013\u2060").replace(/ \u2014 /g, "\u00a0\u2014 ");

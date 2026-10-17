"""An offline guess of the language of a short text, for the one moment it is needed: the owner's reply must go
to a pilot and the translation service (translate.py) has no key or did not answer. Then a text may go as
written only if the pilot can surely read it, so this module says what a text is, never more than it knows.

classify(text) returns one of
  "en" "es" "pl" "ru"  the language the words and letters point to (the four languages of the site),
  "other"              a language that is none of those (another script, Ukrainian letters, accents no
                       known language of ours uses) or letters that tell nothing and are not ASCII,
  "unknown"            ASCII letters, digits or symbols with no sign of any language (a name, "OK", "42").

How: Cyrillic letters make Russian (unless a letter only Ukrainian, Belarusian or Serbian use is in it);
other scripts are "other"; Latin text is scored by function words (the most frequent words of each
language, accents folded away) plus the letters only one language uses. A language wins with two hits and
a lead, or with one hit and no rival in a text of at most four words ("Thanks!", "Gracias!"). The word
lists are short on purpose: they are a safety net for an outage, not a language detector. The honest
limit: Latin text of another language written without accents ("Danke fuer deine Idee") is "unknown".

Source stays ASCII (B18): letters outside ASCII are written as \\u escapes.
"""
from __future__ import annotations

import re
import unicodedata

LANGS = ("en", "es", "pl", "ru")

# function words, lower case, accents folded (see _fold); words two languages share are left out
# ("to", "do", "on", "no", "me", "a", "i", "so": English and Polish or Spanish both have them)
_WORDS = {
    "en": frozenset("""the and is are was were be been of in it that this for with you your we our not but have has had
        will would can could thanks thank please hello dear yes ok okay done fixed added now soon next when what how why
        there here from just also about which they their at as or if does did an all more some new""".split()),
    "es": frozenset("""el la los las un una unos unas del que y en es son por para con sin se su sus lo al como pero muy
        gracias hola esto esta este ya mas tambien estan ser hay fue sera tiene puede nuestro vuestro usted te le mi tu nos
        ahora pronto cuando porque donde""".split()),
    "pl": frozenset("""nie jest sie na ze ale dla jak tak czy juz tez bardzo dziekuje dzieki prosze czesc pozdrawiam wam
        ten ta te tego jestem bedzie sa mozna moze oraz przez przy po od gdy ktory ktora ktore tym teraz wkrotce kiedy
        poniewaz""".split()),
}
# letters (written as escapes) that point to one language
_HINTS = {
    "pl": "\u0105\u0107\u0119\u0142\u0144\u015b\u017a\u017c\u0104\u0106\u0118\u0141\u0143\u015a\u0179\u017b",
    "es": "\u00f1\u00bf\u00a1\u00e1\u00e9\u00ed\u00fa\u00d1\u00c1\u00c9\u00cd\u00da",
}
# Ukrainian, Belarusian, Serbian and Macedonian letters Russian does not have
_NOT_RUSSIAN = set("\u0456\u0457\u0454\u0491\u0406\u0407\u0404\u0490\u045e\u040e\u0452\u045b\u0458\u0459\u045a\u0453\u045c\u0455")
_TOKEN = re.compile(r"[^\W\d_]+")


def _fold(word: str) -> str:
    """Lower case without accents ("Dzi\u0119kuj\u0119" -> "dziekuje"); the Polish l with a stroke has no decomposition."""
    w = word.lower().replace("\u0142", "l")
    return "".join(c for c in unicodedata.normalize("NFD", w) if not unicodedata.combining(c))


def _cyrillic(c: str) -> bool:
    return "\u0400" <= c <= "\u052f"


def classify(text: str) -> str:
    """The language of `text` as far as the four languages of the site and ASCII can tell (see the module's docstring)."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return "unknown"
    cyr = [c for c in letters if _cyrillic(c)]
    if len(cyr) * 2 >= len(letters):
        return "other" if any(c in _NOT_RUSSIAN for c in cyr) else "ru"
    foreign_script = [c for c in letters if ord(c) > 0x24f and not _cyrillic(c)]   # beyond Latin-1 and Latin Extended: Greek, CJK, Arabic...
    if len(foreign_script) * 10 >= len(letters) * 3:
        return "other"
    tokens = [_fold(t) for t in _TOKEN.findall(text)]
    score = {lang: sum(t in words for t in tokens) for lang, words in _WORDS.items()}
    for lang, marks in _HINTS.items():
        score[lang] += sum(c in marks for c in letters)
    ranked = sorted(score.items(), key=lambda kv: kv[1], reverse=True)
    (best, top), (_, second) = ranked[0], ranked[1]
    if top >= 2 and top > second or (top >= 1 and second == 0 and len(tokens) <= 4):
        return best
    return "other" if any(ord(c) > 127 for c in letters) else "unknown"

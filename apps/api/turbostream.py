"""A decoder for the turbo-stream format superspl.at's React Router pages send their loader data in
(`https://superspl.at/scene/<id>.data`, read 2026-10-13). Stdlib only, no network.

The format: the first line is a JSON array of values; the value at index 0 is the root. A dict
`{"_<k>": <i>}` is an object whose key is the string at index k and whose value is the value at index i
(or a negative constant). A plain list is a list of value indexes. A list starting with a type string
is a special value: `["D", <ms>]` a date, `["P", <id>]` a promise resolved in a later line (comments,
which we never need). Shared values (one string used for a title and a description) are stored once
and referenced twice. Later lines (`P<id>:...`) carry the promises; they are ignored.

Only what superspl.at's scene loader uses is decoded; anything else (sets, maps, errors, regular
expressions...) becomes None, never an exception, so a new kind of value elsewhere in their data does
not break the facts we read.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

# turbo-stream's constants for values that JSON cannot hold
_CONSTANTS = {-1: None, -2: None, -3: None, -4: 0.0, -5: None, -6: None, -7: None}  # hole, NaN, -inf, -0, null, +inf, undefined
MAX_VALUES = 20000


@dataclass(frozen=True)
class Date:
    """A date of the stream: milliseconds since 1970 (UTC)."""
    ms: int


class BadStream(ValueError):
    pass


def decode(text: str):
    """The root value of the stream's first line; BadStream when it is not a turbo-stream."""
    first = text.split("\n", 1)[0]
    try:
        values = json.loads(first)
    except ValueError as e:
        raise BadStream("not JSON") from e
    if not isinstance(values, list) or not values or len(values) > MAX_VALUES:
        raise BadStream("not a value list")
    memo: dict[int, object] = {}
    busy: set[int] = set()

    def ref(i):
        if isinstance(i, bool) or not isinstance(i, int):
            raise BadStream("a reference is not an index")
        if i < 0:
            return _CONSTANTS.get(i)
        if i >= len(values):
            raise BadStream("a reference points past the end")
        if i in memo:
            return memo[i]
        if i in busy:  # a value that contains itself: cut the loop
            return None
        busy.add(i)
        try:
            v = values[i]
            if isinstance(v, dict):
                out: dict = {}
                memo[i] = out
                for k, j in v.items():
                    if not (k.startswith("_") and k[1:].isdigit()):
                        raise BadStream("an object key is not a reference")
                    key = values[int(k[1:])] if int(k[1:]) < len(values) else None
                    if isinstance(key, str):
                        out[key] = ref(j)
                return out
            if isinstance(v, list):
                if v and isinstance(v[0], str):
                    if v[0] == "D" and len(v) == 2 and isinstance(v[1], (int, float)) and not isinstance(v[1], bool):
                        return Date(int(v[1]))
                    return None  # a promise or a kind of value the scene facts never use
                lst: list = []
                memo[i] = lst
                lst.extend(ref(j) for j in v)
                return lst
            return v
        finally:
            busy.discard(i)

    try:
        return ref(0)
    except RecursionError as e:
        raise BadStream("nested too deep") from e


def find_route(root, route: str) -> dict | None:
    """The loader data of one route ("routes/scene") from a decoded single-fetch answer."""
    if not isinstance(root, dict):
        return None
    r = root.get(route)
    if isinstance(r, dict) and isinstance(r.get("data"), dict):
        return r["data"]
    return None

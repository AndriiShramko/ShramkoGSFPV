"""The room's course and its live board of best laps (lane race, decisions L1 and L2; docs/wip/race.md).

L1: the course is the room's. A member who makes a course (Shift+G) sends its id ('g1.<seed>': the generator repeats the
same gates from the seed on the same scan, or '<id>.v<n>': a course the scan keeps on the server). The id is 12 to 20
bytes; the course itself (gates as centre, quaternion and kind) is about 60 bytes a gate, so the id is sent, not the
gates. A new course replaces the old one for everyone and clears the board. A member who joins later gets the course
and the board in the welcome.

L2: while a course is in the room every finished lap of every member goes to the others: the course id, the lap's number
and its ms. Nothing else: no sticks, no positions, the nick is the one the service already holds for the slot.

Limits: one Board per room, one row per member present (a row leaves with its member), so a room holds at most CAP rows.
A lap can not end sooner than its own length after the course came or after the member's previous lap (LATE_MS of slack),
so the rate of lap messages a member can make count is one per MIN_LAP_MS.

Pure logic with the server's ms passed in: rooms.py keeps one Board per room (tests/test_board.py).
"""
from __future__ import annotations

MIN_LAP_MS = 3_000       # estimate, the same bound as race.py MIN_LAP_MS (review RM-8)
MAX_LAP_MS = 3_600_000   # estimate: no lap of a generated course takes an hour
MAX_LAP_N = 100_000      # estimate: laps a member flies on one course
LATE_MS = 500            # estimate, as race.py LATE_MS: the clocks' offset and the message's way


class Board:
    def __init__(self, course: str, by: int, now_ms: int):
        self.course, self.by, self.at = course, by, now_ms
        self.rows: dict[int, dict] = {}  # slot -> {"nick", "best", "laps", "last", "seq"}
        self._seq = 0

    @staticmethod
    def _int(v) -> bool:
        return isinstance(v, int) and not isinstance(v, bool)

    def lap(self, slot: int, nick: str, members, course, n, ms, now_ms: int) -> dict | None:
        """A finished lap of member `slot`: lap n (1-based, the next one) of ms on `course`. None when refused."""
        if slot not in members or course != self.course:
            return None
        if not self._int(n) or not self._int(ms) or not MIN_LAP_MS <= ms <= MAX_LAP_MS or not 1 <= n <= MAX_LAP_N:
            return None
        row = self.rows.get(slot)
        laps = row["laps"] if row else 0
        since = row["last"] if row else self.at
        if n != laps + 1 or ms > now_ms - since + LATE_MS:
            return None
        best_before = self.best()
        self._seq += 1
        if row is None:
            row = self.rows[slot] = {"nick": nick, "best": ms, "laps": 0, "last": now_ms, "seq": self._seq}
        row["nick"], row["laps"], row["last"] = nick, n, now_ms
        if ms < row["best"]:
            row["best"], row["seq"] = ms, self._seq
        lead = best_before is None or ms < best_before  # an equal time keeps the first pilot
        return {"type": "blap", "course": self.course, "slot": slot, "nick": nick, "n": n, "ms": ms,
                "best": row["best"], "lead": lead}

    def best(self) -> int | None:
        return min((r["best"] for r in self.rows.values()), default=None)

    def drop(self, slot: int) -> bool:
        return self.rows.pop(slot, None) is not None

    def table(self) -> list[dict]:
        """Rows ordered by the best lap; an equal best keeps the one who flew it first."""
        rows = sorted(self.rows.items(), key=lambda kv: (kv[1]["best"], kv[1]["seq"]))
        return [{"slot": s, "nick": r["nick"], "best": r["best"], "laps": r["laps"]} for s, r in rows]

    def message(self) -> dict:
        return {"type": "board", "course": self.course, "by": self.by, "rows": self.table()}

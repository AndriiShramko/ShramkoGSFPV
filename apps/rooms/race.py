"""A race on time in a room (rooms-plan.md 2.4 and 4D; docs/rooms-protocol.md "Races").

Every page flies the same course (a course id: 'g1.<seed>', the generator's deterministic course, or '<id>.v<n>', a course
the scan keeps on the server) and times itself with the course's own lap timer; the server only orders what the pages
report. Steps of one race:

  prep     a member proposed it; every member present then is a racer; each page builds the course and says 'ready'
  count    every racer is ready (or PREP_MS passed): startAt = now + COUNT_MS on the server's clock, said to all
  run      from startAt: laps are taken (a lap reported before the start, out of order, or longer than the time since the
           start is refused); a racer whose laps reach the course's laps has finished
  results  the first finisher + AFTER_FIRST_MS, every racer finished or gone, or RUN_MS without a finisher: the table goes
           to everyone and the room has no race again

Pure logic with the server's ms passed in: rooms.py keeps one Race per room (tests/test_race.py).
"""
from __future__ import annotations

COUNT_MS = 10_000        # rooms-plan.md 2.4: the countdown 10, 3, 2, 1, go
PREP_MS = 45_000         # estimate: a page generated a course in 15-31 s (apps/fly/src/app/builtin/course.ts, estimate)
AFTER_FIRST_MS = 60_000  # rooms-plan.md 2.4: the race closes at the first finisher + 60 s
RUN_MS = 900_000         # estimate: a race nobody finishes ends after 15 minutes
MAX_LAPS = 10            # estimate: the generator makes 1 to 3 laps (packages/tracks)
LATE_MS = 500            # estimate: a lap may end this much after the server's now (the clocks' offset, the message's way)


def order(rows: list[dict]) -> list[dict]:
    """The table: finished first by total time; then more laps, less time flown; then the best lap; then the slot."""
    def key(r: dict):
        best = r["bestMs"] if r["bestMs"] is not None else 1 << 40
        return (0 if r["done"] else 1, -r["laps"], r["totalMs"], best, r["slot"])
    out = sorted(rows, key=key)
    lead = out[0] if out else None
    for i, r in enumerate(out):
        r["place"] = i + 1
        same = lead is not None and r["laps"] == lead["laps"] and r["laps"] > 0
        r["gapMs"] = r["totalMs"] - lead["totalMs"] if same and i > 0 else None
    return out


class Race:
    def __init__(self, course: str, laps: int, by: int, racers: set[int], now_ms: int):
        self.course, self.laps_per_run, self.by = course, laps, by
        self.racers = set(racers) | {by}
        self.ready: set[int] = set()
        self.state = "prep"
        self.since = now_ms
        self.start_at: int | None = None
        self.first_done: int | None = None
        self.times: dict[int, list[int]] = {}
        self.nicks: dict[int, str] = {}

    # ---------------------------------------------------------------- steps
    def mark_ready(self, slot: int, now_ms: int) -> bool:
        """A page built the course. True when this made the countdown start."""
        if self.state != "prep" or slot not in self.racers:
            return False
        self.ready.add(slot)
        return self._count_if(now_ms)

    def _count_if(self, now_ms: int) -> bool:
        if self.state == "prep" and self.racers and (self.racers <= self.ready or now_ms - self.since >= PREP_MS):
            self.state = "count"
            self.start_at = now_ms + COUNT_MS
            return True
        return False

    def lap(self, slot: int, n, ms, now_ms: int) -> bool:
        """A finished lap of `slot`: lap number n (1-based, the next one) of ms milliseconds. False when refused."""
        if self.state not in ("count", "run") or self.start_at is None or slot not in self.racers:
            return False
        if isinstance(n, bool) or isinstance(ms, bool) or not isinstance(n, int) or not isinstance(ms, int):
            return False
        have = self.times.setdefault(slot, [])
        if self.done(slot) or n != len(have) + 1 or ms <= 0:
            return False
        if now_ms < self.start_at or sum(have) + ms > now_ms - self.start_at + LATE_MS:
            return False  # before the start, or a lap longer than the time since the start
        have.append(ms)
        self.state = "run"
        if self.done(slot) and self.first_done is None:
            self.first_done = now_ms
        return True

    def done(self, slot: int) -> bool:
        return len(self.times.get(slot, ())) >= self.laps_per_run

    def drop(self, slot: int, now_ms: int) -> bool:
        """A member left: he is no racer any more (his laps stay in the table). True when the countdown started now."""
        self.racers.discard(slot)
        self.ready.discard(slot)
        return self._count_if(now_ms)

    def due(self, now_ms: int) -> str | None:
        """'count' when the wait for pages ended, 'results' when the race is over, else None."""
        if self.state == "prep":
            return "count" if self._count_if(now_ms) else None
        if self.start_at is None or now_ms < self.start_at:
            return None
        if self.state == "count":
            self.state = "run"
        racing = [s for s in self.racers if not self.done(s)]
        if (self.first_done is not None and (now_ms - self.first_done >= AFTER_FIRST_MS or not racing)) \
                or not self.racers or now_ms - self.start_at >= RUN_MS:
            self.state = "results"
            return "results"
        return None

    # ---------------------------------------------------------------- what is said
    def table(self) -> list[dict]:
        rows = []
        for slot in sorted(self.racers | set(self.times)):
            t = self.times.get(slot, [])
            rows.append({"slot": slot, "nick": self.nicks.get(slot, f"#{slot + 1}"), "laps": len(t), "totalMs": sum(t),
                         "bestMs": min(t) if t else None, "lastMs": t[-1] if t else None, "done": self.done(slot)})
        return order(rows)

    def message(self, state: str | None = None) -> dict:
        return {"type": "race", "state": state or self.state, "course": self.course, "laps": self.laps_per_run, "by": self.by,
                "racers": sorted(self.racers), "ready": sorted(self.ready), "startAt": self.start_at, "table": self.table()}

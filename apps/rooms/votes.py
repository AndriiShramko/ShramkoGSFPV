"""Votes for the next scan of a room (rooms-plan.md 2.3, requirement R27; docs/rooms-protocol.md "Votes").

Any member proposes a scan; the proposer counts yes; the vote passes as soon as the yes votes are MORE than half of the
members present, and fails when its window ends without that. One vote at a time per room. Pure logic with an injected
clock: rooms.py keeps one Ballot per room and says what happened to everyone (tests/test_open_vote.py).
"""
from __future__ import annotations

import time

VOTE_S = 30.0          # rooms-plan.md 2.3: a vote is open 30 s
PRESENT_S = 120.0      # rooms-plan.md 2.3: a member idle longer than 2 minutes is not counted as present
PROPOSALS = 5          # rooms-plan.md 2.5: 5 proposals per 10 minutes per member
PROPOSALS_WINDOW_S = 600.0


def need(present: int) -> int:
    """Yes votes that pass a vote among `present` members: more than half (1 of 1, 2 of 2, 2 of 3, 3 of 4)."""
    return max(1, present) // 2 + 1


class Vote:
    def __init__(self, scene: dict, by: int, now: float, window: float):
        self.scene, self.by, self.started, self.ends = scene, by, now, now + window
        self.yes: set[int] = {by}


class Ballot:
    """The vote of one room. `present` is the set of slots counted (rooms.py: connected and active within PRESENT_S);
    a yes voter always counts as present (he just acted)."""

    def __init__(self, window: float = VOTE_S, clock=time.monotonic):
        self.window, self.clock = window, clock
        self.vote: Vote | None = None

    def _count(self, present: set[int]) -> tuple[int, int]:
        v = self.vote
        assert v is not None
        n = len(present | v.yes)
        return len(v.yes), need(n)

    def state(self, present: set[int], kind: str = "open") -> dict:
        v = self.vote
        assert v is not None
        yes, k = self._count(present)
        return {"type": "vote", "state": kind, "scene": v.scene, "by": v.by, "yes": sorted(v.yes), "need": k,
                "present": len(present | v.yes), "leftMs": max(0, int((v.ends - self.clock()) * 1000))}

    def propose(self, scene: dict, slot: int, current: str, present: set[int]) -> str:
        """'same' (the room flies that scan), 'busy' (another scan's vote is open: the proposal is not a vote for it),
        'passed' or 'open'. A proposal of the scan already voted on counts as a yes."""
        if scene["id"] == current:
            return "same"
        if self.vote is not None:
            if self.vote.scene["id"] != scene["id"]:
                return "busy"
            return self.agree(slot, present)
        self.vote = Vote(scene, slot, self.clock(), self.window)
        return self.check(present) or "open"

    def agree(self, slot: int, present: set[int]) -> str:
        """'none' (no vote open), 'passed' or 'open' (counted, still short)."""
        if self.vote is None:
            return "none"
        self.vote.yes.add(slot)
        return self.check(present) or "open"

    def drop(self, slot: int) -> None:
        """A member left: his yes goes with him (the proposer's too; the vote stays open for the others)."""
        if self.vote is not None:
            self.vote.yes.discard(slot)

    def check(self, present: set[int]) -> str | None:
        """'passed' when the yes votes are more than half of the present, 'failed' when the window ended (or every yes
        voter left), else None. The vote stays in self.vote for the caller to report; close() ends it."""
        v = self.vote
        if v is None:
            return None
        yes, k = self._count(present)
        if yes >= k and yes > 0:
            return "passed"
        if self.clock() >= v.ends or yes == 0:
            return "failed"
        return None

    def close(self) -> Vote | None:
        v, self.vote = self.vote, None
        return v

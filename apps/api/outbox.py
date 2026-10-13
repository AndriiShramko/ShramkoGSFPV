"""The outbox worker: one thread in the API process that hands due e-mails to SMTP, one at a time.

An e-mail is due when it is `queued` and its undo window (notBefore) has passed, or `failed` with a
retry time (nextAt) that has passed. For each: service.claim() marks it `sending` on disk, mailer.send()
talks to SMTP, service.finish() records sent / failed / unknown. Because the claim is written before the
send and checked inside one transaction, a cancel that won the race leaves nothing to send, and an
e-mail is never handed to SMTP twice by the worker itself. At start, recover() turns a `sending` left by a
restart into `unknown` (the owner decides whether to send it again).

The worker polls the store every POLL_S seconds (the agents' CLI writes the same file from another
process); wake() makes it look at once.
"""
from __future__ import annotations

import threading

from mailer import Mailer, MailError
from service import IdeasService

POLL_S = 2.0


class OutboxWorker:
    def __init__(self, service: IdeasService, mailer: Mailer, poll_s: float = POLL_S):
        self.service, self.mailer, self.poll_s = service, mailer, poll_s
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def run_once(self) -> int:
        """Send every e-mail that is due now; the number handed to SMTP."""
        n = 0
        for mid in self.service.due_mails():
            claimed = self.service.claim(mid)
            if claimed is None:
                continue
            _, mail = claimed
            err = None
            try:
                self.mailer.send(mail)
            except MailError as e:
                err = e
            except Exception as e:  # noqa: BLE001  an unexpected failure is not proof that nothing went
                err = MailError("internal", transient=False, ambiguous=True, detail=type(e).__name__)
            self.service.finish(mid, err)
            n += 1
        return n

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.run_once()
            except Exception:  # noqa: BLE001  the store unreadable for a moment: try again next round
                pass
            self._wake.wait(self.poll_s)
            self._wake.clear()

    def start(self) -> None:
        self.service.recover()
        self._thread = threading.Thread(target=self._loop, name="outbox", daemon=True)
        self._thread.start()

    def wake(self) -> None:
        self._wake.set()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

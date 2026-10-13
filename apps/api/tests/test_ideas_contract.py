"""The admin ideas API the kanban relies on, as one file both sides are held to: ideas-admin-contract.json
(next to this test). Here it is replayed against the real handler (server.Handler -> admin.AdminApi ->
ideas_admin.IdeasAdmin -> service.IdeasService, through HTTP with the admin's session and CSRF);
tools/bench/test/ideas-contract.test.ts replays the same file against the kanban's mock
(tools/bench/src/ideas-mock.ts). So the mock cannot drift from the server again: a change on either side
fails one of the two replays until the file, the server and the mock agree.

Run: python -m unittest discover -s apps/api/tests -v   (stdlib only; fake Telegram and SMTP from fakes.py;
nothing is sent: the outbox worker never runs here). Controls: an expectation changed in a copy of the file
is reported, and a handler that still took the old send-done body {id} (no draft named) fails the replay.
"""
from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import service  # noqa: E402
from test_ideas_admin import IdeasAdminTest  # noqa: E402

CONTRACT = HERE / "ideas-admin-contract.json"


def load() -> dict:
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def pick(obj, path: str):
    """The value at a dotted path; '*' maps the rest of the path over a list. A missing step gives the
    marker '<missing>' (so an absent field never equals null)."""
    parts = path.split(".")

    def go(o, i):
        if i == len(parts):
            return o
        p = parts[i]
        if p == "*":
            return [go(x, i + 1) for x in o] if isinstance(o, list) else "<missing>"
        if isinstance(o, dict) and p in o:
            return go(o[p], i + 1)
        return "<missing>"
    return go(obj, 0)


def subst(v, names: dict):
    """$name -> its value, inside strings, lists and objects."""
    if isinstance(v, str) and v.startswith("$"):
        return names.get(v[1:], v)
    if isinstance(v, str) and "/$" in v:
        head, _, name = v.partition("/$")
        return f"{head}/{names.get(name, '$' + name)}"
    if isinstance(v, list):
        return [subst(x, names) for x in v]
    if isinstance(v, dict):
        return {k: subst(x, names) for k, x in v.items()}
    return v


def replay(contract: dict, call, world) -> list[str]:
    """Every step through `call(method, route, body) -> (status, doc)`; `world(change)` applies a world step.
    Returns what did not match (empty: the server answers as the contract says)."""
    names = {k: v["id"] for k, v in contract["ideas"].items()}
    bad: list[str] = []
    for n, s in enumerate(contract["steps"], 1):
        where = f"step {n} ({s['say']})"
        if "world" in s:
            world(s["world"])
            continue
        method = "GET" if "get" in s else "POST"
        route = subst(s["get"] if "get" in s else s["post"], names)
        status, doc = call(method, route, subst(s.get("body"), names))
        if "status" in s and status != s["status"]:
            bad.append(f"{where}: status {status}, want {s['status']} ({doc})")
            continue
        if "keys" in s and sorted(doc) != sorted(s["keys"]):
            bad.append(f"{where}: keys {sorted(doc)}, want {sorted(s['keys'])}")
        for path, want in (s.get("expect") or {}).items():
            got, want = pick(doc, path), subst(want, names)
            if got != want:
                bad.append(f"{where}: {path} = {json.dumps(got)}, want {json.dumps(want)}")
        for name, path in (s.get("save") or {}).items():
            names[name] = pick(doc, path)
    return bad


class Contract(IdeasAdminTest):
    def run_contract(self, contract: dict) -> list[str]:
        for key in ("pilot", "other"):
            i = contract["ideas"][key]
            self.w.report(rid=i["id"], kind=i["kind"], message=i["text"], contact=i["contact"], lang=i["lang"])
        cookie, csrf = self.login()

        def call(method: str, route: str, body):
            st, _, raw = self.req(method, f"/api/admin/{route}", body, cookie=cookie, csrf=csrf if method == "POST" else None)
            return st, json.loads(raw)

        def world(change: dict) -> None:
            if change.get("mail") is False:
                self.w.env.pop("GMAIL_USER", None)
                self.w.env.pop("GMAIL_APP_PASSWORD", None)
            if change.get("store") == "broken":
                (Path(self.tmp.name) / "ideas.json").write_bytes(b"{not json")
        return replay(contract, call, world)

    def test_the_real_handler_answers_as_the_contract_says(self):
        c = load()
        self.assertGreaterEqual(len(c["steps"]), 30)
        self.assertEqual(self.run_contract(c), [])
        self.assertEqual(self.w.smtp.messages, [])  # nothing left this machine


class ContractControls(IdeasAdminTest):
    run_contract = Contract.run_contract

    def test_a_changed_expectation_is_reported(self):
        c = load()
        step = next(s for s in c["steps"] if s.get("post") == "ideas/send-done" and s.get("body") == {"id": "$pilot"})
        step["status"] = 200  # as if Send without naming the draft were still fine
        bad = self.run_contract(c)
        self.assertEqual(len(bad), 1, bad)
        self.assertIn("Send without naming the draft", bad[0])

    def test_a_handler_that_takes_the_old_send_done_body_fails(self):
        """The old contract: send-done {id} sends whatever draft is newest. The replay must catch it."""
        real = service.IdeasService.send_done

        def old(svc, rid, mail_id, by):
            if mail_id is None:
                rec = svc.get(rid)
                drafts = [m for m in (rec or {}).get("thread", []) if m["kind"] == "done" and m["state"] == "draft"]
                mail_id = drafts[-1]["id"] if drafts else "M-0"
            return real(svc, rid, mail_id, by)
        service.IdeasService.send_done = old
        try:
            bad = self.run_contract(copy.deepcopy(load()))
        finally:
            service.IdeasService.send_done = real
        self.assertTrue(any("Send without naming the draft" in b for b in bad), bad)


if __name__ == "__main__":
    unittest.main()

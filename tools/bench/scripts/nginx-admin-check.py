"""v0.6 admin through the production nginx.conf (no browser). Needs three containers on one Docker network,
started as written in the evidence it produces (run from the repo root, Docker running):

  gsfpv-w6-api    python:3.12-alpine, read-only, 64 MB, apps/api mounted at /app like compose.yml, DATA_DIR on
                  a host folder (--data), ADMIN_PASSWORD_HASH from .cache/admin-test.json (a TEST password)
  gsfpv-w6-smoke  nginx:1.29-alpine with deploy/nginx.conf and the built dist/ (port 18080)
  gsfpv-w6-front  nginx:1.29-alpine playing the hub's nginx-proxy (port 18081): appends the visitor's address
                  to X-Forwarded-For; every local address is private, so it appends a fixed public test one

Checks: /api/catalog 200 + ETag, 304 on If-None-Match; /admin/ 200; PUT refused; no session 401; five wrong
passwords with a different forged X-Forwarded-For each lock the ONE real client out (the right password is
then refused, 429). Control: the same forgery sent straight to gsfpv-web (no front proxy, a private trusted
peer) or to the API itself is taken at face value, so the protection is the front proxy + the real-IP rule.
Usage: python tools/bench/scripts/nginx-admin-check.py --data D:/gsfpv-tmp/nginx-data
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
data = Path(sys.argv[sys.argv.index("--data") + 1])
secret = json.loads((REPO / ".cache" / "admin-test.json").read_text())
WEB, FRONT = "http://localhost:18080", "http://localhost:18081"


def req(base: str, method: str, path: str, body=None, headers=None) -> tuple[int, dict]:
    r = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                               headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers)


def fresh_api() -> None:
    for f in data.glob("*"):
        if f.is_file():
            f.unlink()
    subprocess.run(["docker", "restart", "gsfpv-w6-api"], check=True, capture_output=True)
    for _ in range(40):
        try:
            if req(WEB, "GET", "/api/health")[0] == 200:
                return
        except OSError:
            pass
        time.sleep(0.5)
    raise SystemExit("the API did not come back")


def clients() -> int:
    audit = [json.loads(x) for x in (data / "admin-audit.jsonl").read_text(encoding="utf-8").splitlines()]
    return len({a["ip"] for a in audit if a["action"] == "login"})


def forged_lockout(base: str) -> dict:
    wrong = [req(base, "POST", "/api/admin/login", {"password": "nope-nope"}, {"X-Forwarded-For": f"203.0.113.{i}"})[0] for i in range(5)]
    right = req(base, "POST", "/api/admin/login", {"password": secret["password"]}, {"X-Forwarded-For": "203.0.113.99"})[0]
    return {"wrong": wrong, "rightPasswordAfter": right, "clientsInAudit": clients()}


out: dict = {}
fresh_api()
st, h = req(WEB, "GET", "/api/catalog")
out["catalog"] = {"status": st, "etag": h.get("ETag"), "cacheControl": h.get("Cache-Control"),
                  "revalidated": req(WEB, "GET", "/api/catalog", headers={"If-None-Match": h.get("ETag", "")})[0]}
out["adminPage"] = req(WEB, "GET", "/admin/")[0]
out["putRefused"] = req(WEB, "PUT", "/api/admin/session")[0]
out["noSession"] = req(WEB, "GET", "/api/admin/catalog")[0]
out["viaFrontProxy"] = forged_lockout(FRONT)
fresh_api()
out["controlStraightToWeb"] = forged_lockout(WEB)
mem = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", "gsfpv-w6-api"], capture_output=True, text=True).stdout.strip()
out["apiMemoryAfterLogins"] = mem
f = out["viaFrontProxy"]
c = out["controlStraightToWeb"]
out["pass"] = (out["catalog"]["status"] == 200 and out["catalog"]["revalidated"] == 304 and out["adminPage"] == 200
               and out["putRefused"] in (403, 405) and out["noSession"] == 401
               and f["wrong"] == [401] * 5 and f["rightPasswordAfter"] == 429 and f["clientsInAudit"] == 1
               and c["rightPasswordAfter"] == 200 and c["clientsInAudit"] > 1)  # the control must fire
day = time.strftime("%Y-%m-%d")
(REPO / "evidence" / day).mkdir(parents=True, exist_ok=True)
path = REPO / "evidence" / day / "v06-admin-nginx.json"
path.write_text(json.dumps({"name": "v06-admin-nginx", "nginxConf": "deploy/nginx.conf", **out}, indent=2) + "\n")
print(json.dumps(out, indent=1))
print(("PASS " if out["pass"] else "FAIL ") + str(path))
sys.exit(0 if out["pass"] else 1)

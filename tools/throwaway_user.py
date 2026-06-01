"""Create/delete a THROWAWAY auth user via the Supabase admin API (service role).

Used only to safely verify B4 admin user-edit writes without touching the 13 real
users. The on_auth_user_created trigger auto-creates the profile + employee role;
deleting the auth user cascades the profile away (profiles.id FK ON DELETE CASCADE).

Usage:
  python throwaway_user.py create "ZZZ Throwaway User" zzz.throwaway@example.com
  python throwaway_user.py delete <user_id>
"""
import json
import os
import sys
import urllib.request

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

BASE = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def _req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=HEADERS, method=method)
    with urllib.request.urlopen(req) as r:
        txt = r.read().decode()
        return json.loads(txt) if txt else {}


def create(name, email):
    out = _req("POST", "/auth/v1/admin/users", {
        "email": email,
        "password": "ZzThrowaway!2026",
        "email_confirm": True,
        "user_metadata": {"name": name},
    })
    print(out.get("id"))


def delete(uid):
    _req("DELETE", f"/auth/v1/admin/users/{uid}", {"should_soft_delete": False})
    print("deleted", uid)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "create":
        create(sys.argv[2], sys.argv[3])
    elif cmd == "delete":
        delete(sys.argv[2])
    else:
        sys.exit("unknown command")

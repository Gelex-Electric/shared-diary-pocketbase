#!/usr/bin/env python3
"""Helper dung chung cho pipeline ghi/doc PocketBase (thay dan cho CSV).

Muc tieu: pipeline khong con commit CSV vao repo -> khong kich hoat rebuild Railway.
Auth bang superuser (PB_EMAIL/PB_PASS trong GitHub Secrets, giong fetch_meter_info.py).

Ham chinh:
  pb = PBClient()                         # tu login khi can (lazy)
  pb.upsert_batch("tloss_daily", rows, ("code","date"))
  pb.query_all("tloss_daily", filter='date="2026-07-14"')
  pb.prune_older_than("tloss_30min", "ts", cutoff_iso)

Thiet ke idempotent: upsert dua tren khoa duy nhat (key_fields) -> chay lai an toan.
Cac collection MOI deu co createRule/updateRule/deleteRule = null (chi superuser ghi).
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

PB_URL = os.environ.get("PB_URL", "").rstrip("/")
PB_EMAIL = os.environ.get("PB_EMAIL", "")
PB_PASS = os.environ.get("PB_PASS", "")

BATCH_SIZE = int(os.environ.get("PB_BATCH_SIZE", "200"))
TIMEOUT = int(os.environ.get("PB_TIMEOUT", "60"))


class PBError(RuntimeError):
    pass


def _request(method, url, token=None, payload=None, attempts=3):
    """HTTP co retry cho loi mang/5xx (Railway cold start hay tra 502)."""
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                body = r.read().decode()
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:500]
            if e.code < 500:  # loi client (4xx) -> khong retry
                raise PBError(f"{e.code} {method} {url}: {body}")
            last = f"{e.code} {body}"
        except Exception as e:  # noqa: BLE001
            last = str(e)
        if i < attempts - 1:
            time.sleep(5 * (i + 1))
    raise PBError(f"{method} {url} that bai sau {attempts} lan: {last}")


class PBClient:
    def __init__(self, url=None, email=None, password=None):
        self.url = (url or PB_URL).rstrip("/")
        self.email = email or PB_EMAIL
        self.password = password or PB_PASS
        self._token = None

    # ---- auth ----
    def login(self):
        """Login superuser (fallback users). Tra ve token, cache lai."""
        if not (self.url and self.email and self.password):
            raise PBError("Thieu PB_URL/PB_EMAIL/PB_PASS.")
        last = None
        for coll in ("_superusers", "users"):
            try:
                d = _request(
                    "POST",
                    f"{self.url}/api/collections/{coll}/auth-with-password",
                    payload={"identity": self.email, "password": self.password},
                )
                tok = d.get("token")
                if tok:
                    self._token = tok
                    return tok
            except PBError as e:
                last = str(e)
        raise PBError(f"Khong dang nhap duoc PocketBase: {last}")

    @property
    def token(self):
        return self._token or self.login()

    # ---- doc ----
    def query_all(self, collection, filter=None, sort=None, fields=None, per_page=500):
        """Doc TOAN BO record (tu dong phan trang). Tra ve list[dict]."""
        items, page = [], 1
        while True:
            q = {"perPage": per_page, "page": page}
            if filter:
                q["filter"] = filter
            if sort:
                q["sort"] = sort
            if fields:
                q["fields"] = fields
            url = f"{self.url}/api/collections/{collection}/records?" + urllib.parse.urlencode(q)
            d = _request("GET", url, token=self.token)
            items.extend(d.get("items", []))
            if page >= d.get("totalPages", 1):
                break
            page += 1
        return items

    def _existing_map(self, collection, key_fields):
        """{tuple(key_values): record_id} cho toan bo collection (de upsert)."""
        out = {}
        for r in self.query_all(collection, fields="id," + ",".join(key_fields)):
            out[tuple(str(r.get(k, "")) for k in key_fields)] = r["id"]
        return out

    # ---- ghi ----
    def upsert_batch(self, collection, rows, key_fields):
        """Upsert theo khoa key_fields (ghi tung record POST/PATCH).

        rows: list[dict] da map ten field dung voi schema PB.
        Tra ve (created, updated). Idempotent: chay lai chi update.
        Ghi tung record (khong dung /api/batch — nhieu instance tat tinh nang nay).
        """
        if not rows:
            return (0, 0)
        existing = self._existing_map(collection, key_fields)
        base = f"{self.url}/api/collections/{collection}/records"
        created = updated = 0
        for row in rows:
            key = tuple(str(row.get(k, "")) for k in key_fields)
            rid = existing.get(key)
            if rid:
                _request("PATCH", f"{base}/{rid}", token=self.token, payload=row)
                updated += 1
            else:
                _request("POST", base, token=self.token, payload=row)
                created += 1
        return (created, updated)

    # ---- prune ----
    def prune_older_than(self, collection, ts_field, cutoff):
        """Xoa record co ts_field < cutoff (so sanh chuoi ISO). Tra ve so ban da xoa."""
        old = self.query_all(collection, filter=f'{ts_field} < "{cutoff}"',
                             fields="id")
        base = f"{self.url}/api/collections/{collection}/records"
        for r in old:
            _request("DELETE", f"{base}/{r['id']}", token=self.token)
        return len(old)

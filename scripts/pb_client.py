"""Client PocketBase dung chung cho cac script danh muc / vat tu.

Bien moi truong (giong cac script san co trong repo):
  PB_URL   : vd https://getc.up.railway.app/pb
  PB_EMAIL : email superuser
  PB_PASS  : mat khau superuser

KHONG hardcode credential trong file nay - repo dang PUBLIC.
"""

import os
import sys
import time

import requests

PB_URL = os.environ.get("PB_URL", "").rstrip("/")
PB_EMAIL = os.environ.get("PB_EMAIL", "")
PB_PASS = os.environ.get("PB_PASS", "")

TIMEOUT = 60

# Mang cong ty co proxy SSL tu ky, thinh thoang chen vao giua -> requests bao
# CERTIFICATE_VERIFY_FAILED mot cach NGAU NHIEN (da gap 03/08/2026: lan 1 loi,
# lan 2 that bai, 5 lan sau OK). Hai cach xu ly, uu tien cach dau:
#   PB_CA_BUNDLE=<duong dan CA cua cong ty>  -> verify dung chuan
#   PB_INSECURE=1                            -> tat verify (chi khi bi ket)
CA_BUNDLE = os.environ.get("PB_CA_BUNDLE", "")
INSECURE = os.environ.get("PB_INSECURE", "") == "1"
RETRIES = int(os.environ.get("PB_RETRIES", "4"))

_verify = False if INSECURE else (CA_BUNDLE or True)


def req(method: str, url: str, **kw):
    """requests.<method> co retry cho loi SSL/ket noi.

    KHONG retry loi HTTP 4xx/5xx - do la loi logic, retry chi che mat van de.
    """
    kw.setdefault("timeout", TIMEOUT)
    kw.setdefault("verify", _verify)
    last = None
    for attempt in range(1, RETRIES + 1):
        try:
            return requests.request(method, url, **kw)
        except (requests.exceptions.SSLError, requests.exceptions.ConnectionError) as e:
            last = e
            if attempt < RETRIES:
                wait = 2 ** (attempt - 1)
                print(f"  [RETRY {attempt}/{RETRIES}] {type(e).__name__} -> cho {wait}s")
                time.sleep(wait)
    raise last

# Cac collection cua he thong dang chay - KHONG BAO GIO duoc xoa bang script.
# Chot chan cung: moi thao tac xoa deu phai di qua danh sach nay.
PROTECTED = {
    "users",
    "invoice",
    "handovers",
    "Electric_shift",
    "PowerOutage",
    "AccountHes",
    "New_update",
    "notifications",
}


def require_env():
    """Dung ngay neu thieu bien moi truong, thay vi bao loi 401 kho hieu."""
    missing = [k for k, v in (("PB_URL", PB_URL), ("PB_EMAIL", PB_EMAIL), ("PB_PASS", PB_PASS)) if not v]
    if missing:
        sys.exit(
            "Thieu bien moi truong: " + ", ".join(missing) + "\n"
            "Vi du (PowerShell):\n"
            '  $env:PB_URL="https://getc.up.railway.app/pb"\n'
            '  $env:PB_EMAIL="<email superuser>"\n'
            '  $env:PB_PASS="<mat khau>"'
        )


def login() -> str:
    """Dang nhap, tra ve token. Thu _superusers truoc roi den users.

    Cung cach lam voi scripts/fetch_meter_info.py::pb_login de khong sinh
    them mot kieu xac thuc thu hai trong repo.
    """
    require_env()
    # Gom loi cua CA HAI lan thu. Neu chi giu loi cuoi thi loi that o _superusers
    # bi loi 400 cua users che mat -> khong doan duoc nguyen nhan goc.
    errors = []
    for coll in ("_superusers", "users"):
        try:
            r = req("POST",
                f"{PB_URL}/api/collections/{coll}/auth-with-password",
                json={"identity": PB_EMAIL, "password": PB_PASS},
                timeout=TIMEOUT,
            )
            if r.ok:
                token = r.json().get("token", "")
                if token:
                    return token
                errors.append(f"{coll}: HTTP 200 nhung khong co token")
            else:
                errors.append(f"{coll}: HTTP {r.status_code} {r.text[:200]}")
        except Exception as e:  # noqa: BLE001 - in ra de con doan duoc tang nao loi
            errors.append(f"{coll}: {type(e).__name__}: {e}")
    sys.exit("Dang nhap PocketBase that bai:\n  " + "\n  ".join(errors))


def headers(token: str) -> dict:
    return {"Authorization": token}


def list_collections(token: str) -> list:
    """Toan bo collection, ke ca collection he thong (ten bat dau bang _)."""
    out = []
    page = 1
    while True:
        r = req("GET",
            f"{PB_URL}/api/collections",
            params={"page": page, "perPage": 200},
            headers=headers(token),
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        data = r.json()
        out.extend(data.get("items", []))
        if page >= data.get("totalPages", 1):
            break
        page += 1
    return out


def list_records(token: str, name: str, per_page: int = 500) -> list:
    """Toan bo record cua mot collection (phan trang het)."""
    out = []
    page = 1
    while True:
        r = req("GET",
            f"{PB_URL}/api/collections/{name}/records",
            params={"page": page, "perPage": per_page, "skipTotal": "false"},
            headers=headers(token),
            timeout=TIMEOUT,
        )
        if not r.ok:
            # Collection view / auth dac biet co the tu choi - ghi nhan, khong dung ca script
            print(f"  [WARN] khong doc duoc record cua '{name}': HTTP {r.status_code}")
            return out
        data = r.json()
        out.extend(data.get("items", []))
        if page >= data.get("totalPages", 1):
            break
        page += 1
        time.sleep(0.05)
    return out


def count_records(token: str, name: str) -> int:
    """Dem nhanh: lay 1 dong, doc totalItems."""
    r = req("GET",
        f"{PB_URL}/api/collections/{name}/records",
        params={"page": 1, "perPage": 1},
        headers=headers(token),
        timeout=TIMEOUT,
    )
    if not r.ok:
        return -1
    return int(r.json().get("totalItems", 0))


def delete_collection(token: str, name: str):
    """Xoa mot collection. Chan cung cac collection dang duoc he thong dung."""
    if name in PROTECTED or name.startswith("_"):
        sys.exit(f"TU CHOI xoa '{name}' - nam trong danh sach bao ve.")
    r = req("DELETE",
        f"{PB_URL}/api/collections/{name}",
        headers=headers(token),
        timeout=TIMEOUT,
    )
    r.raise_for_status()

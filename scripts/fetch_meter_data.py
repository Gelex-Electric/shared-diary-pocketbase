#!/usr/bin/env python3
"""Goi GetInstantByDate cho tat ca cong to lay tu PocketBase (collection "Metter",
truong "MeterNo") va append du lieu vao public/datametter.csv.

Flow: doc MeterNo tu PocketBase -> Login API dien -> GetInstantByDate tung cong to.
Luu: METER_NO, DATE_TIME, PHASE_A_VOLTS, PHASE_B_VOLTS, PHASE_C_VOLTS, TOTAL_KW
"""
import csv
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

BASE_URL = "http://14.225.244.63:8899/api"
CSV_PATH = "public/datametter.csv"
FIELDS = ["METER_NO", "DATE_TIME", "PHASE_A_VOLTS", "PHASE_B_VOLTS", "PHASE_C_VOLTS", "TOTAL_KW"]

USER_ACCOUNT = os.environ.get("API_USER", "GETC")
PASSWORD = os.environ.get("API_PASS", "GETC@123")

# PocketBase
PB_URL = os.environ.get("PB_URL", "https://getc.up.railway.app/pb").rstrip("/")
PB_COLLECTION = os.environ.get("PB_COLLECTION", "Meter")
PB_FIELD = os.environ.get("PB_FIELD", "MeterNo")
PB_HSN_FIELD = os.environ.get("PB_HSN_FIELD", "HSN")
PB_ADMIN_EMAIL = os.environ.get("PB_ADMIN_EMAIL", "")       # de trong neu collection cho phep doc public
PB_ADMIN_PASS = os.environ.get("PB_ADMIN_PASS", "")

VN_TZ = timezone(timedelta(hours=7))


def pb_auth_header(base):
    if not (PB_ADMIN_EMAIL and PB_ADMIN_PASS):
        return {}
    # PocketBase >= 0.23 dung _superusers; ban cu dung /api/admins
    for path in ("/api/collections/_superusers/auth-with-password", "/api/admins/auth-with-password"):
        try:
            r = requests.post(f"{base}{path}",
                              json={"identity": PB_ADMIN_EMAIL, "password": PB_ADMIN_PASS},
                              timeout=30)
            if r.ok:
                return {"Authorization": r.json()["token"]}
        except Exception:
            pass
    print("[WARN] Khong dang nhap duoc PocketBase admin, thu doc public.")
    return {}


def load_meter_list():
    bases = [PB_URL] if os.environ.get("PB_URL") else [
        "https://getc.up.railway.app/pb",
        "https://getc.up.railway.app",
    ]
    collections = [PB_COLLECTION, "Meter", "pbc_1418108225"]

    base = coll = None
    headers = {}
    last_err = ""
    for b in bases:
        h = pb_auth_header(b)
        for c in collections:
            try:
                r = requests.get(f"{b}/api/collections/{c}/records",
                                 params={"perPage": 1}, headers=h, timeout=30)
                if r.ok:
                    base, coll, headers = b, c, h
                    break
                last_err = f"{r.status_code} tai {r.url}"
            except Exception as e:
                last_err = str(e)
        if base:
            break
    if not base:
        sys.exit(f"Khong tim thay collection tren PocketBase. Loi cuoi: {last_err}")
    print(f"PocketBase OK: {base} / collection '{coll}'")

    meters, page = {}, 1
    while True:
        r = requests.get(
            f"{base}/api/collections/{coll}/records",
            params={"page": page, "perPage": 200,
                    "fields": f"{PB_FIELD},{PB_HSN_FIELD}"},
            headers=headers, timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        for item in data.get("items", []):
            no = str(item.get(PB_FIELD) or "").strip()
            if not no:
                continue
            try:
                hsn = float(item.get(PB_HSN_FIELD) or 1) or 1.0
            except (TypeError, ValueError):
                hsn = 1.0
            meters[no] = hsn
    # het trang?
        if page >= data.get("totalPages", 1):
            break
        page += 1
    return meters


def login() -> str:
    r = requests.get(
        f"{BASE_URL}/Login",
        params={"UserAccount": USER_ACCOUNT, "Password": PASSWORD},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    if isinstance(data, list):
        data = data[0] if data else {}
    if str(data.get("CODE")) != "1":
        sys.exit(f"Login failed: {data.get('MESSAGE')}")
    return data["TOKEN"]


def fetch_instant(token: str, meter_no: str):
    now = datetime.now(VN_TZ)
    start = now - timedelta(hours=1)
    fmt = "%Y%m%d%H%M%S"
    try:
        r = requests.get(
            f"{BASE_URL}/GetInstantByDate",
            params={
                "MeterNo": meter_no,
                "StartDate": start.strftime(fmt),
                "EndDate": now.strftime(fmt),
                "Token": token,
            },
            timeout=60,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"[WARN] {meter_no}: loi khi goi API ({e}), bo qua.")
        return []
    if isinstance(data, dict):
        data = data.get("DATA", data.get("data", []))
    return data or []


def scale(value, hsn):
    """Nhan he so nhan; giu nguyen neu khong phai so."""
    try:
        return f"{float(value) * hsn:g}"
    except (TypeError, ValueError):
        return value if value is not None else ""


def append_csv(rows):
    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    exists = os.path.isfile(CSV_PATH)

    existing = set()
    if exists:
        with open(CSV_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                existing.add((row.get("METER_NO"), row.get("DATE_TIME")))

    new = 0
    with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if not exists:
            w.writeheader()
        for rec in rows:
            key = (rec.get("METER_NO", ""), rec.get("DATE_TIME") or rec.get("DATA_TIME", ""))
            if key in existing:
                continue
            w.writerow({
                "METER_NO": key[0],
                "DATE_TIME": key[1],
                "PHASE_A_VOLTS": rec.get("PHASE_A_VOLTS", ""),
                "PHASE_B_VOLTS": rec.get("PHASE_B_VOLTS", ""),
                "PHASE_C_VOLTS": rec.get("PHASE_C_VOLTS", ""),
                "TOTAL_KW": rec.get("TOTAL_KW", ""),
            })
            existing.add(key)
            new += 1
    print(f"Appended {new} new row(s) to {CSV_PATH}")


def main():
    meters = load_meter_list()
    print(f"PocketBase tra ve {len(meters)} cong to tu collection '{PB_COLLECTION}'")
    if not meters:
        sys.exit("Khong co cong to nao trong PocketBase.")
    token = login()

    all_rows = []
    for no, hsn in meters.items():
        rows = fetch_instant(token, no)
        for rec in rows:
            rec.setdefault("METER_NO", no)
            for f in ("PHASE_A_VOLTS", "PHASE_B_VOLTS", "PHASE_C_VOLTS", "TOTAL_KW"):
                rec[f] = scale(rec.get(f), hsn)
        print(f"  {no} (HSN={hsn:g}): {len(rows)} ban ghi")
        all_rows.extend(rows)

    if not all_rows:
        print("Khong co du lieu moi trong khung gio nay.")
        return
    append_csv(all_rows)


if __name__ == "__main__":
    main()

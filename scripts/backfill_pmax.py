#!/usr/bin/env python3
"""Backfill public/pmax_daily.csv tu API lich su.

Goi GetInstantByDate cho tung cong to (doc tu scripts/meters_backfill.txt) trong
khoang [START_DATE, hom qua], nhom theo ngay va lay max(TOTAL_KW) -> Pmax/ngay.
TOTAL_KW duoc nhan he so HSN (lay tu PocketBase) de dong bo voi pipeline hang ngay.

Ghi de theo khoa (METER_NO, DATE) nen chay lai an toan, va luu sau MOI cong to nen
neu job bi ngat van giu duoc tien do (chay lai se tiep tuc).

Bien moi truong:
  START_DATE   mac dinh 2026-01-01
  END_DATE     mac dinh = hom qua (gio VN)
  METERS_FILE  mac dinh scripts/meters_backfill.txt
Yeu cau secrets: API_USER, API_PASS (va PB_ADMIN_* neu muon lay HSN).
"""
import csv
import os
import sys
from datetime import date, datetime, timedelta

import requests

from fetch_meter_data import BASE_URL, VN_TZ, get_retry, load_meter_list, login, scale

OUT_PATH = "public/pmax_daily.csv"
OUT_FIELDS = ["METER_NO", "DATE", "PMAX_KW"]

START_DATE = os.environ.get("START_DATE", "2026-01-01").strip()
METERS_FILE = os.environ.get("METERS_FILE", "scripts/meters_backfill.txt")


def read_meters():
    with open(METERS_FILE, encoding="utf-8") as f:
        return [ln.strip() for ln in f if ln.strip()]


def month_chunks(start_d, end_d):
    """Sinh tung cap (dau_thang, cuoi_chunk) theo thang de tranh timeout/gioi han."""
    cur = start_d
    while cur <= end_d:
        nxt = date(cur.year + 1, 1, 1) if cur.month == 12 else date(cur.year, cur.month + 1, 1)
        yield cur, min(nxt - timedelta(days=1), end_d)
        cur = nxt


def fetch_range(token, meter, d0, d1):
    fmt = "%Y%m%d%H%M%S"
    start = datetime(d0.year, d0.month, d0.day, 0, 0, 0)
    end = datetime(d1.year, d1.month, d1.day, 23, 59, 59)
    try:
        r = get_retry(
            f"{BASE_URL}/GetInstantByDate",
            params={
                "MeterNo": meter,
                "StartDate": start.strftime(fmt),
                "EndDate": end.strftime(fmt),
                "Token": token,
            },
            timeout=120,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"    [WARN] {meter} {d0}..{d1}: loi API ({e}), bo qua chunk.")
        return []
    if isinstance(data, dict):
        data = data.get("DATA", data.get("data", []))
    return data or []


def load_existing():
    all_data = {}
    if os.path.isfile(OUT_PATH):
        with open(OUT_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                all_data[(row.get("METER_NO", ""), row.get("DATE", ""))] = row
    return all_data


def write_out(all_data):
    rows = sorted(all_data.values(), key=lambda r: (r["DATE"], r["METER_NO"]))
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=OUT_FIELDS)
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def main():
    meters = read_meters()
    if not meters:
        sys.exit(f"Khong co cong to nao trong {METERS_FILE}")

    start_d = date.fromisoformat(START_DATE)
    end_env = os.environ.get("END_DATE", "").strip()
    end_d = date.fromisoformat(end_env) if end_env else (datetime.now(VN_TZ).date() - timedelta(days=1))
    print(f"Backfill Pmax tu {start_d} den {end_d} cho {len(meters)} cong to.")

    # He so HSN tu PocketBase (neu lay duoc), mac dinh 1.0
    try:
        hsn_map = load_meter_list()
    except SystemExit:
        hsn_map = {}
    except Exception as e:
        print(f"[WARN] Khong lay duoc HSN tu PocketBase ({e}), dung HSN=1.0 cho tat ca.")
        hsn_map = {}
    missing_hsn = sum(1 for m in meters if m not in hsn_map)
    if missing_hsn:
        print(f"[WARN] {missing_hsn}/{len(meters)} cong to khong co HSN trong PocketBase -> dung 1.0.")

    token = login()
    all_data = load_existing()
    chunks = list(month_chunks(start_d, end_d))

    for idx, meter in enumerate(meters, 1):
        hsn = hsn_map.get(meter, 1.0)
        pmax_by_day = {}
        for c0, c1 in chunks:
            for rec in fetch_range(token, meter, c0, c1):
                day = str(rec.get("DATE_TIME", ""))[:10]
                if len(day) != 10:
                    continue
                try:
                    kw = float(scale(rec.get("TOTAL_KW"), hsn))
                except (TypeError, ValueError):
                    continue
                if day not in pmax_by_day or kw > pmax_by_day[day]:
                    pmax_by_day[day] = kw
        for day, kw in pmax_by_day.items():
            all_data[(meter, day)] = {"METER_NO": meter, "DATE": day, "PMAX_KW": f"{kw:g}"}
        total = write_out(all_data)  # luu tien do sau moi cong to
        print(f"[{idx}/{len(meters)}] {meter} (HSN={hsn:g}): {len(pmax_by_day)} ngay. Tong file: {total} dong")

    print(f"Hoan tat. {OUT_PATH}")


if __name__ == "__main__":
    main()

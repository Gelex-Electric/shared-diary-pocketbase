#!/usr/bin/env python3
"""Goi GetMeterAccount(UserID, Token) va cap nhat public/metterinfo.csv.

Cot luu: METER_NO, METER_NAME (dung lam HSN), METER_MODEL_DESC, CUSTOMER_CODE,
CUSTOMER_NAME, ADDRESS, LINE_NAME, STATUS.

- Che do MERGE: chi them moi va cap nhat, KHONG xoa cong to cu da co trong file.
- STATUS (Yes/No): xet Pmax trong INACTIVE_DAYS ngay gan nhat (tinh tu hom truoc,
  lui ve qua khu) trong public/pmax_daily.csv.
    + Co BAT KY ngay nao Pmax > 0 trong khoang do -> "Yes".
    + TAT CA ngay trong khoang deu Pmax = 0 hoac khong co du lieu -> "No".
  Vi vay mat du lieu 1-2 ngay (do job loi) khong lam cong to bi gan nham "No".

File nay la nguon danh sach cong to + HSN cho fetch_meter_data.py (chay moi gio).
"""
import csv
import os
import sys
from datetime import datetime, timedelta

import requests

from fetch_meter_data import BASE_URL, VN_TZ, login_data

CSV_PATH = "public/metterinfo.csv"
PMAX_PATH = "public/pmax_daily.csv"
API_FIELDS = ["METER_NO", "METER_NAME", "METER_MODEL_DESC", "CUSTOMER_CODE",
              "CUSTOMER_NAME", "ADDRESS", "LINE_NAME"]
FIELDS = API_FIELDS + ["STATUS"]
USER_ID = os.environ.get("USER_ID", "1")   # tai khoan luon dung UserID = 1
INACTIVE_DAYS = int(os.environ.get("INACTIVE_DAYS", "3"))  # so ngay lien tiep Pmax=0 moi gan No


def fetch_accounts(user_id: str, token: str):
    r = requests.get(
        f"{BASE_URL}/GetMeterAccount",
        params={"UserID": user_id, "Token": token},
        timeout=60,
    )
    r.raise_for_status()
    raw = r.json()
    data = raw
    if isinstance(data, dict):
        data = data.get("DATA", data.get("data", []))
    if not data:
        print(f"[DEBUG] GetMeterAccount tra ve rong. UserID={user_id}. Raw response: {raw}")
    return data or []


def load_existing():
    meters = {}
    if os.path.isfile(CSV_PATH):
        with open(CSV_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                no = str(row.get("METER_NO") or "").strip()
                if no:
                    meters[no] = {k: row.get(k, "") for k in FIELDS}
                    meters[no]["METER_NO"] = no
    return meters


def pmax_status_map(last_day: str, num_days: int):
    """Tra ve {METER_NO: "Yes"/"No"} dua tren `num_days` ngay gan nhat ket thuc
    tai `last_day` trong pmax_daily.csv. "Yes" neu co it nhat 1 ngay Pmax > 0."""
    end = datetime.fromisoformat(last_day).date()
    days = {(end - timedelta(days=i)).isoformat() for i in range(num_days)}

    has_positive = set()
    seen_any = set()
    if os.path.isfile(PMAX_PATH):
        with open(PMAX_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("DATE", "") not in days:
                    continue
                no = str(row.get("METER_NO") or "").strip()
                if not no:
                    continue
                try:
                    pmax = float(row.get("PMAX_KW", "") or 0)
                except (TypeError, ValueError):
                    pmax = 0.0
                seen_any.add(no)
                if pmax > 0:
                    has_positive.add(no)
    return has_positive  # chi can biet cong to nao co Pmax>0 trong khoang


def main():
    info = login_data()
    token = info.get("TOKEN")
    print(f"[DEBUG] Login OK. USER_ID dung de goi GetMeterAccount = {USER_ID} "
          f"(USER_ID tra ve tu Login = {info.get('USER_ID')}).")
    rows = fetch_accounts(USER_ID, token)
    if not rows:
        sys.exit("GetMeterAccount khong tra ve cong to nao.")

    # MERGE: giu cong to cu, them/sua tu API
    meters = load_existing()
    added = updated = 0
    for rec in rows:
        no = str(rec.get("METER_NO") or "").strip()
        if not no:
            continue
        if no not in meters:
            meters[no] = {k: "" for k in FIELDS}
            added += 1
        else:
            updated += 1
        for k in API_FIELDS:
            meters[no][k] = rec.get(k) if rec.get(k) is not None else ""
        meters[no]["METER_NO"] = no

    # STATUS: "Yes" neu co Pmax > 0 trong INACTIVE_DAYS ngay gan nhat
    last_day = os.environ.get("TARGET_DATE", "").strip() or (datetime.now(VN_TZ).date() - timedelta(days=1)).isoformat()
    active_meters = pmax_status_map(last_day, INACTIVE_DAYS)
    active = 0
    for no, m in meters.items():
        m["STATUS"] = "Yes" if no in active_meters else "No"
        if m["STATUS"] == "Yes":
            active += 1

    out = sorted(meters.values(), key=lambda r: r["METER_NO"])
    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(out)
    print(f"metterinfo.csv: tong {len(out)} cong to (+{added} moi, {updated} cap nhat). "
          f"STATUS xet {INACTIVE_DAYS} ngay gan {last_day}: {active} Yes / {len(out) - active} No.")


if __name__ == "__main__":
    main()

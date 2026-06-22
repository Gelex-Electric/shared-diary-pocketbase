#!/usr/bin/env python3
"""Goi GetMeterAccount(UserID, Token) va cap nhat public/metterinfo.csv.

Cot luu: METER_NO, METER_NAME (dung lam HSN), METER_MODEL_DESC, CUSTOMER_CODE,
CUSTOMER_NAME, ADDRESS, LINE_NAME, STATUS.

- Che do MERGE: chi them moi va cap nhat, KHONG xoa cong to cu da co trong file.
- STATUS (Yes/No): xet dien ap 3 pha (PHASE_A_VOLTS, PHASE_B_VOLTS, PHASE_C_VOLTS)
  cua INACTIVE_DAYS ngay lien tiep gan nhat trong public/datametter.csv.
    + Co BAT KY ban ghi nao trong khoang do co U_A/U_B/U_C > 0 -> "Yes".
    + TAT CA ban ghi trong khoang (hoac khong co du lieu) deu U_A=U_B=U_C=0 -> "No".
  (datametter.csv chi giu ~7 ngay gan nhat nen INACTIVE_DAYS mac dinh = 7.)

File nay la nguon danh sach cong to + HSN cho fetch_meter_data.py (chay moi gio).
"""
import csv
import os
import sys
from datetime import datetime, timedelta

import requests

from fetch_meter_data import BASE_URL, VN_TZ, login_data

CSV_PATH = "public/metterinfo.csv"
DATAMETTER_PATH = "public/datametter.csv"
API_FIELDS = ["METER_NO", "METER_NAME", "METER_MODEL_DESC", "CUSTOMER_CODE",
              "CUSTOMER_NAME", "ADDRESS", "LINE_NAME"]
FIELDS = API_FIELDS + ["STATUS"]
USER_ID = os.environ.get("USER_ID", "2")   # tai khoan luon dung UserID = 2
INACTIVE_DAYS = int(os.environ.get("INACTIVE_DAYS", "7"))  # so ngay lien tiep U=0 moi gan No


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


def _to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def phase_active_meters(last_day: str, num_days: int):
    """Tra ve tap cong to co U_A/U_B/U_C > 0 it nhat 1 ban ghi trong `num_days`
    ngay gan nhat ket thuc tai `last_day`, doc tu datametter.csv."""
    end = datetime.fromisoformat(last_day).date()
    days = {(end - timedelta(days=i)).isoformat() for i in range(num_days)}

    active = set()
    if os.path.isfile(DATAMETTER_PATH):
        with open(DATAMETTER_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("DATE_TIME", "")[:10] not in days:
                    continue
                no = str(row.get("METER_NO") or "").strip()
                if not no or no in active:
                    continue
                a = _to_float(row.get("PHASE_A_VOLTS"))
                b = _to_float(row.get("PHASE_B_VOLTS"))
                c = _to_float(row.get("PHASE_C_VOLTS"))
                if a > 0 or b > 0 or c > 0:
                    active.add(no)
    return active


def main():
    info = login_data()
    token = info.get("TOKEN")
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

    # STATUS: "Yes" neu co dien ap pha > 0 trong INACTIVE_DAYS ngay gan nhat
    last_day = os.environ.get("TARGET_DATE", "").strip() or (datetime.now(VN_TZ).date() - timedelta(days=1)).isoformat()
    active_meters = phase_active_meters(last_day, INACTIVE_DAYS)
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
          f"STATUS xet U pha {INACTIVE_DAYS} ngay gan {last_day}: {active} Yes / {len(out) - active} No.")


if __name__ == "__main__":
    main()

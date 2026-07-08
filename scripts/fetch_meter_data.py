#!/usr/bin/env python3
"""Goi GetInstantByDate cho tat ca cong to lay tu PocketBase (collection "Metter",
truong "MeterNo") va append du lieu vao public/datametter.csv.

Flow: doc MeterNo tu PocketBase -> Login API dien -> GetInstantByDate tung cong to.
Luu: METER_NO, DATE_TIME, PHASE_A_VOLTS, PHASE_B_VOLTS, PHASE_C_VOLTS, TOTAL_KW
"""
import csv
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests


def get_retry(url, *, attempts=4, **kwargs):
    """GET co retry cho loi mang/5xx (Railway cold start hay tra 502)."""
    last = None
    for i in range(attempts):
        try:
            r = requests.get(url, **kwargs)
            if r.status_code < 500:
                return r
            last = f"{r.status_code} tai {r.url}"
        except Exception as e:
            last = str(e)
        if i < attempts - 1:
            time.sleep(10 * (i + 1))
    raise RuntimeError(last)

BASE_URL = "http://14.225.244.63:8899/api"
CSV_PATH = "public/datametter.csv"
# Giữ 6 cột đầu ĐÚNG THỨ TỰ CŨ (frontend VoltagePowerDashboard đọc theo vị trí:
# TOTAL_KW ở index 5). Cột mới chỉ được NỐI VÀO CUỐI để không phá tương thích.
FIELDS = ["METER_NO", "DATE_TIME", "PHASE_A_VOLTS", "PHASE_B_VOLTS", "PHASE_C_VOLTS", "TOTAL_KW",
          "PHASE_A_AMPERE", "PHASE_B_AMPERE", "PHASE_C_AMPERE", "TOTAL_KVAR"]
# Các trường phải nhân hệ số nhân (HSN) khi lưu — công suất & dòng điện.
SCALED_FIELDS = ["TOTAL_KW", "PHASE_A_AMPERE", "PHASE_B_AMPERE", "PHASE_C_AMPERE", "TOTAL_KVAR"]
KEEP_RECORDS = int(os.environ.get("KEEP_RECORDS", "336"))  # 7 ngay x 48 ban ghi/ngay moi cong to
FETCH_HOURS = int(os.environ.get("FETCH_HOURS", "6"))       # cua so lay du lieu, rong de vot ban ghi ve tre

USER_ACCOUNT = os.environ.get("API_USER", "")
PASSWORD = os.environ.get("API_PASS", "")

# Danh sach cong to + HSN doc tu file metterinfo.csv (sinh boi fetch_meter_info.py).
# Cot METER_NAME duoc dung lam HSN (he so nhan).
METTERINFO_PATH = os.environ.get("METTERINFO_PATH", "public/metterinfo.csv")

VN_TZ = timezone(timedelta(hours=7))


def load_meter_list():
    """Doc {METER_NO: HSN} tu metterinfo.csv. HSN lay tu cot METER_NAME."""
    if not os.path.isfile(METTERINFO_PATH):
        sys.exit(f"Khong tim thay {METTERINFO_PATH}. Hay chay fetch_meter_info.py truoc.")
    meters = {}
    with open(METTERINFO_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            no = str(row.get("METER_NO") or "").strip()
            if not no:
                continue
            try:
                hsn = float(row.get("METER_NAME") or 1) or 1.0
            except (TypeError, ValueError):
                hsn = 1.0
            meters[no] = hsn
    return meters


def login_data() -> dict:
    """Dang nhap API dien, tra ve toan bo object (gom USER_ID, TOKEN)."""
    if not (USER_ACCOUNT and PASSWORD):
        sys.exit("Thieu API_USER/API_PASS. Hay them vao GitHub Secrets.")
    r = get_retry(
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
    return data


def login() -> str:
    return login_data()["TOKEN"]


def fetch_instant(token: str, meter_no: str):
    now = datetime.now(VN_TZ)
    start = now - timedelta(hours=FETCH_HOURS)
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

    # Doc toan bo du lieu cu
    all_data = {}
    if os.path.isfile(CSV_PATH):
        with open(CSV_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                key = (row.get("METER_NO", ""), row.get("DATE_TIME", ""))
                all_data[key] = row

    # Them ban ghi moi (ghi de neu trung key)
    new = 0
    for rec in rows:
        key = (str(rec.get("METER_NO", "")),
               rec.get("DATE_TIME") or rec.get("DATA_TIME", ""))
        if key not in all_data:
            new += 1
        all_data[key] = {
            "METER_NO": key[0],
            "DATE_TIME": key[1],
            "PHASE_A_VOLTS": rec.get("PHASE_A_VOLTS", ""),
            "PHASE_B_VOLTS": rec.get("PHASE_B_VOLTS", ""),
            "PHASE_C_VOLTS": rec.get("PHASE_C_VOLTS", ""),
            "TOTAL_KW": rec.get("TOTAL_KW", ""),
            "PHASE_A_AMPERE": rec.get("PHASE_A_AMPERE", ""),
            "PHASE_B_AMPERE": rec.get("PHASE_B_AMPERE", ""),
            "PHASE_C_AMPERE": rec.get("PHASE_C_AMPERE", ""),
            "TOTAL_KVAR": rec.get("TOTAL_KVAR", ""),
        }

    # Gom theo cong to, chi giu KEEP_RECORDS ban ghi moi nhat moi cong to
    by_meter = {}
    for (no, _), row in all_data.items():
        by_meter.setdefault(no, []).append(row)

    kept = []
    pruned = 0
    for no, recs in by_meter.items():
        recs.sort(key=lambda r: r.get("DATE_TIME", ""))
        if len(recs) > KEEP_RECORDS:
            pruned += len(recs) - KEEP_RECORDS
            recs = recs[-KEEP_RECORDS:]
        kept.extend(recs)

    # Sap xep on dinh: theo cong to roi thoi gian
    kept.sort(key=lambda r: (r.get("METER_NO", ""), r.get("DATE_TIME", "")))

    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(kept)
    print(f"Them {new} ban ghi moi, xoa {pruned} ban ghi cu. "
          f"Tong: {len(kept)} dong trong {CSV_PATH}")


def main():
    meters = load_meter_list()
    print(f"Doc {len(meters)} cong to tu {METTERINFO_PATH}")
    if not meters:
        sys.exit(f"Khong co cong to nao trong {METTERINFO_PATH}.")
    token = login()

    all_rows = []
    for no, hsn in meters.items():
        rows = fetch_instant(token, no)
        for rec in rows:
            rec.setdefault("METER_NO", no)
            for fld in SCALED_FIELDS:  # công suất + dòng điện đều ×HSN; điện áp giữ nguyên
                rec[fld] = scale(rec.get(fld), hsn)
        print(f"  {no} (HSN={hsn:g}): {len(rows)} ban ghi")
        all_rows.extend(rows)

    if not all_rows:
        print("Khong co du lieu moi trong khung gio nay.")
        return
    append_csv(all_rows)


if __name__ == "__main__":
    main()

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

# ==================== CANH BAO HSN BAT THUONG ====================
# HSN (cot METER_NAME) coi la SAI khi > nguong hoac trung so cong to
# (loi nhap so serial vao o TEN CONG TO tren HES, vd cong to 2510203126).
HSN_MAX = float(os.environ.get("HSN_MAX", "100000"))
# PocketBase de gui thong bao vao collection `notifications` (bo trong = khong gui)
PB_URL = os.environ.get("PB_URL", "").rstrip("/")
PB_EMAIL = os.environ.get("PB_EMAIL", "")
PB_PASS = os.environ.get("PB_PASS", "")
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


def find_bad_hsn(meters: dict) -> list:
    """Tra ve danh sach cong to co HSN (METER_NAME) bat thuong:
    HSN > HSN_MAX hoac HSN trung so cong to (nhap serial vao o TEN CONG TO)."""
    bad = []
    for no, m in meters.items():
        try:
            hsn = float(m.get("METER_NAME") or 0)
        except (TypeError, ValueError):
            continue
        if hsn <= 0:
            continue
        try:
            same_as_serial = abs(hsn - float(no)) < 1
        except (TypeError, ValueError):
            same_as_serial = False
        if hsn > HSN_MAX or same_as_serial:
            bad.append({
                "no": no,
                "hsn": hsn,
                "customer": (m.get("CUSTOMER_NAME") or "").strip() or "(chua ro)",
                "area": (m.get("ADDRESS") or "").strip(),
            })
    return bad


def pb_login():
    """Dang nhap PocketBase, tra ve token (thu superusers truoc, roi users)."""
    for coll in ("_superusers", "users"):
        try:
            r = requests.post(
                f"{PB_URL}/api/collections/{coll}/auth-with-password",
                json={"identity": PB_EMAIL, "password": PB_PASS},
                timeout=30,
            )
            if r.ok:
                return r.json().get("token", "")
        except Exception:
            pass
    return ""


def notify_bad_hsn(bad: list):
    """Gui canh bao vao collection `notifications` (khop schema NotificationBell:
    title, message, type, mkh, area). Gui cho ca khu vuc Van hanh cua KCN va
    khoi Kinh doanh (area=''). Bo qua neu da co thong bao cung noi dung."""
    if not bad:
        return
    if not (PB_URL and PB_EMAIL and PB_PASS):
        print("[WARN] Phat hien HSN bat thuong nhung thieu PB_URL/PB_EMAIL/PB_PASS -> khong gui thong bao.")
        return
    token = pb_login()
    if not token:
        print("[WARN] Khong dang nhap duoc PocketBase -> khong gui thong bao.")
        return
    headers = {"Authorization": token}
    api = f"{PB_URL}/api/collections/notifications/records"
    sent = 0
    for b in bad:
        message = (f"Công tơ khách hàng {b['customer']} số {b['no']} "
                   f"nhập sai vào ô TÊN CÔNG TƠ trên Hes (HSN={b['hsn']:g})")
        for area in {b["area"], ""}:
            try:
                # Chong trung: bo qua neu thong bao cung message + area da ton tai
                dup = requests.get(
                    api,
                    params={"filter": f'message="{message}" && area="{area}"', "perPage": 1},
                    headers=headers, timeout=30,
                )
                if dup.ok and dup.json().get("totalItems", 0) > 0:
                    continue
                r = requests.post(
                    api,
                    json={
                        "title": "Cảnh báo hệ số nhân (HSN) sai",
                        "message": message,
                        "type": "info",
                        "mkh": "",
                        "area": area,
                    },
                    headers=headers, timeout=30,
                )
                if r.ok:
                    sent += 1
                else:
                    print(f"[WARN] Gui thong bao that bai ({r.status_code}): {r.text[:200]}")
            except Exception as e:
                print(f"[WARN] Loi gui thong bao PocketBase: {e}")
    print(f"Canh bao HSN: {len(bad)} cong to bat thuong, da gui {sent} thong bao.")


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

    # Canh bao HSN bat thuong (chi xet cong to dang hoat dong)
    bad = find_bad_hsn({no: m for no, m in meters.items() if m.get("STATUS") == "Yes"})
    for b in bad:
        print(f"[ALERT] {b['no']} ({b['customer']}): HSN={b['hsn']:g} bat thuong "
              f"(> {HSN_MAX:g} hoac trung so cong to).")
    notify_bad_hsn(bad)


if __name__ == "__main__":
    main()

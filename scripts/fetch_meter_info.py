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
import re
import sys
import time
from datetime import datetime, timedelta

import requests

from fetch_meter_data import BASE_URL, VN_TZ, get_retry, login_data

CSV_PATH = "public/metterinfo.csv"
DATAMETTER_PATH = "public/datametter.csv"
LINE_INFO_PATH = "public/line_info.csv"
MBA_PATH = "public/mba_info.csv"

# ==================== CANH BAO HSN BAT THUONG ====================
# HSN (cot METER_NAME) coi la SAI khi > nguong hoac trung so cong to
# (loi nhap so serial vao o TEN CONG TO tren HES, vd cong to 2510203126).
HSN_MAX = float(os.environ.get("HSN_MAX", "1000000"))
# PocketBase de gui thong bao vao collection `notifications` (bo trong = khong gui)
PB_URL = os.environ.get("PB_URL", "").rstrip("/")
PB_EMAIL = os.environ.get("PB_EMAIL", "")
PB_PASS = os.environ.get("PB_PASS", "")
API_FIELDS = ["METER_NO", "METER_NAME", "METER_MODEL_DESC", "CUSTOMER_CODE",
              "CUSTOMER_NAME", "ADDRESS", "LINE_NAME"]
# LINE_ID/CODE/ROLE bo sung tu GetLineList + GetMeter (anh xa cong to -> tram).
#   ROLE = "chinh" khi line co CODE != rong  -> diem do dem chinh (cong P, Q)
#   ROLE = "phu"   khi CODE rong             -> diem do phu (bo qua khi tinh ton that)
STATION_FIELDS = ["LINE_ID", "CODE", "ROLE"]
FIELDS = API_FIELDS + STATION_FIELDS + ["STATUS"]
BATCH_SLEEP = float(os.environ.get("BATCH_SLEEP", "0.15"))  # nghi giua cac lan goi GetMeter
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


def fetch_line_list(user_id: str, token: str) -> dict:
    """GetLineList -> {LINE_ID: {"LINE_NAME":..., "ADDRESS":..., "CODE":...}}."""
    r = get_retry(
        f"{BASE_URL}/GetLineList",
        params={"UserID": user_id, "Token": token},
        timeout=60,
    )
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict):
        data = data.get("DATA", data.get("data", []))
    lines = {}
    for rec in data or []:
        lid = str(rec.get("LINE_ID") or "").strip()
        if not lid:
            continue
        lines[lid] = {
            "LINE_NAME": (rec.get("LINE_NAME") or "").strip(),
            "ADDRESS": (rec.get("ADDRESS") or "").strip(),
            "CODE": (rec.get("CODE") or "").strip(),
        }
    return lines


def fetch_meter_line(meter_no: str, token: str):
    """GetMeter(No) -> (LINE_ID, LINE_NAME) cua cong to (rong neu loi/khong co)."""
    try:
        r = get_retry(
            f"{BASE_URL}/GetMeter",
            params={"No": meter_no, "Token": token},
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] GetMeter {meter_no}: {e}")
        return "", ""
    if isinstance(data, list):
        data = data[0] if data else {}
    if isinstance(data, dict):
        return str(data.get("LINE_ID") or "").strip(), str(data.get("LINE_NAME") or "").strip()
    return "", ""


def write_line_info(lines: dict):
    """Ghi public/line_info.csv (nguon GetLineList): LINE_ID, LINE_NAME, ADDRESS, CODE."""
    fields = ["LINE_ID", "LINE_NAME", "ADDRESS", "CODE"]
    rows = [{"LINE_ID": lid, **{k: v.get(k, "") for k in ("LINE_NAME", "ADDRESS", "CODE")}}
            for lid, v in sorted(lines.items(), key=lambda kv: kv[0])]
    os.makedirs(os.path.dirname(LINE_INFO_PATH), exist_ok=True)
    with open(LINE_INFO_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    print(f"line_info.csv: {len(rows)} tram -> {LINE_INFO_PATH}")


def _norm_code(s) -> str:
    return re.sub(r"\s+", "", str(s or "").strip().upper())


def sync_mba_info(meters: dict):
    """Tu sinh cot TBA cho mba_info.csv: THEM dong moi cho tram chinh chua co,
    Sdm/P0/PK de TRONG cho nguoi dung nhap tay. KHONG dung cac dong da co (giu
    nguyen format + gia tri tay). Khop theo ma chuan hoa + tien to (CODE viet gon van khop)."""
    codes = sorted({(m.get("CODE") or "").strip()
                    for m in meters.values()
                    if str(m.get("ROLE") or "").strip() == "chinh" and (m.get("CODE") or "").strip()})
    # Doc mba_info hien co (giu nguyen text)
    if os.path.isfile(MBA_PATH):
        with open(MBA_PATH, encoding="utf-8-sig") as f:
            text = f.read()
        header = text.splitlines()[0] if text.strip() else "TBA;Sdm(kVA);DEP0(W);DEPK(W)"
        delim = ";" if ";" in header else ","
        existing = set()
        for ln in text.splitlines()[1:]:
            if not ln.strip():
                continue
            tba = ln.split(delim)[0].strip()
            if tba:
                existing.add(_norm_code(tba))
    else:
        header = "TBA;Sdm(kVA);DEP0(W);DEPK(W)"
        delim = ";"
        text = header + "\n"
        existing = set()

    def matched(nc):
        return any(nc == e or nc.startswith(e) or e.startswith(nc) for e in existing)

    new = [c for c in codes if not matched(_norm_code(c))]
    if not new:
        print("mba_info.csv: khong co tram chinh moi.")
        return
    ncol = len(header.split(delim))
    blanks = delim.join([""] * (ncol - 1))   # Sdm;P0;PK de trong
    if not text.endswith("\n"):
        text += "\n"
    text += "".join(f"{c}{delim}{blanks}\n" for c in new)
    with open(MBA_PATH, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"mba_info.csv: them {len(new)} tram chinh moi (TBA), Sdm/P0/PK de trong: {new}")


def enrich_stations(meters: dict, token: str, lines: dict) -> list:
    """Gan LINE_ID/LINE_NAME (tu GetMeter) + CODE/ROLE (tu GetLineList) cho tung cong to.
    Tra ve danh sach tram bat thuong (CODE != rong nhung KHONG phai tien to LINE_NAME)."""
    bad_stations = []          # tram co CODE nhung LINE_NAME khong bat dau bang CODE
    seen_bad = set()
    for no, m in meters.items():
        lid, lname = fetch_meter_line(no, token)   # GetMeter: LINE_ID + LINE_NAME
        line = lines.get(lid, {})
        code = line.get("CODE", "")
        if lname:
            m["LINE_NAME"] = lname                 # uu tien ten tram tu GetMeter
        line_name = m.get("LINE_NAME") or line.get("LINE_NAME") or ""
        m["LINE_ID"] = lid
        m["CODE"] = code
        if code:
            m["ROLE"] = "chinh"
            if not line_name.startswith(code) and lid not in seen_bad:
                seen_bad.add(lid)
                bad_stations.append({"line_id": lid, "code": code, "line_name": line_name})
        else:
            m["ROLE"] = "phu"
        if BATCH_SLEEP:
            time.sleep(BATCH_SLEEP)
    return bad_stations


def notify_bad_stations(bad_stations: list):
    """Canh bao tram: CODE khong phai tien to cua LINE_NAME -> collection notifications."""
    if not bad_stations:
        return
    if not (PB_URL and PB_EMAIL and PB_PASS):
        print("[WARN] Phat hien tram bat thuong nhung thieu PB_URL/PB_EMAIL/PB_PASS -> khong gui thong bao.")
        return
    token = pb_login()
    if not token:
        print("[WARN] Khong dang nhap duoc PocketBase -> khong gui thong bao tram.")
        return
    headers = {"Authorization": token}
    api = f"{PB_URL}/api/collections/notifications/records"
    sent = 0
    for s in bad_stations:
        message = (f"Trạm mã CODE \"{s['code']}\" không khớp tên trạm "
                   f"\"{s['line_name']}\" (CODE phải là tiền tố của LINE_NAME) — kiểm tra lại HES.")
        try:
            dup = requests.get(
                api,
                params={"filter": f'message="{message}" && area=""', "perPage": 1},
                headers=headers, timeout=30,
            )
            if dup.ok and dup.json().get("totalItems", 0) > 0:
                continue
            r = requests.post(
                api,
                json={"title": "Cảnh báo dữ liệu trạm (CODE/LINE_NAME)",
                      "message": message, "type": "info", "mkh": "", "area": ""},
                headers=headers, timeout=30,
            )
            if r.ok:
                sent += 1
            else:
                print(f"[WARN] Gui canh bao tram that bai ({r.status_code}): {r.text[:200]}")
        except Exception as e:  # noqa: BLE001
            print(f"[WARN] Loi gui canh bao tram: {e}")
    print(f"Canh bao tram: {len(bad_stations)} tram bat thuong, da gui {sent} thong bao.")


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

    # Anh xa cong to -> tram (LINE_ID/LINE_NAME tu GetMeter; CODE/ROLE tu GetLineList)
    lines = fetch_line_list(USER_ID, token)
    print(f"GetLineList: {len(lines)} tram.")
    write_line_info(lines)                       # public/line_info.csv
    bad_stations = enrich_stations(meters, token, lines)
    n_chinh = sum(1 for m in meters.values() if m.get("ROLE") == "chinh")
    print(f"Phan loai diem do: {n_chinh} chinh / {len(meters) - n_chinh} phu.")

    # Tu sinh TBA cho mba_info.csv (them tram chinh moi; Sdm/P0/PK nhap tay)
    sync_mba_info(meters)

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

    # Canh bao tram: CODE khong phai tien to cua LINE_NAME
    for s in bad_stations:
        print(f"[ALERT] Tram {s['line_id']}: CODE='{s['code']}' khong la tien to cua LINE_NAME='{s['line_name']}'.")
    notify_bad_stations(bad_stations)


if __name__ == "__main__":
    main()

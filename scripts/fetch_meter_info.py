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


PREFIX_ZONE = {"TH": "KCNTH", "PD": "KCNPĐ", "03": "KCN03", "YM": "KCNYM", "TTI": "KCNTTI"}
# notifications.area la select field, gia tri phai la TEN DAY DU (khop AREAS trong pocketbase.ts).
ZONE_NAME = {
    "KCNTH": "KCN Tiền Hải", "KCNPĐ": "KCN Phong Điền", "KCNTTI": "KCN Thuận Thành I",
    "KCNYM": "KCN Yên Mỹ", "KCN03": "KCN Số 3",
}


def _zone_of(code: str) -> str:
    pre = (code.split(".")[0] or "").strip().upper().replace("Đ", "D")
    return PREFIX_ZONE.get(pre, "")


def sync_mba_stations(meters: dict) -> list:
    """Phat hien tram CHINH moi chua co trong collection PB `mba_info` -> tao record
    RONG (Sdm/P0/PK de trong, cho nguoi dung nhap qua UI) + canh bao. KHONG dong den
    tram da co (giu nguyen gia tri da nhap). Khop theo ma chuan hoa + tien to.

    Tra ve list canh bao [{title, message, area}]. Bat/tat qua WRITE_PB."""
    codes = sorted({(m.get("CODE") or "").strip()
                    for m in meters.values()
                    if str(m.get("ROLE") or "").strip() == "chinh" and (m.get("CODE") or "").strip()})
    if os.environ.get("WRITE_PB", "1") == "0" or not PB_URL:
        return []
    try:
        from pb_client import PBClient, PBError, _request
    except ImportError as e:  # noqa: BLE001
        print(f"[PB] Khong import duoc pb_client: {e}")
        return []
    pb = PBClient()
    try:
        tok = pb.token
        existing = {_norm_code(r["code"]) for r in pb.query_all("mba_info", fields="code")}
    except PBError as e:
        print(f"[PB][WARN] Doc mba_info that bai: {e}")
        return []

    def matched(nc):
        return any(nc == e or nc.startswith(e) or e.startswith(nc) for e in existing)

    new = [c for c in codes if not matched(_norm_code(c))]
    if not new:
        print("mba_info: khong co tram chinh moi.")
        return []
    base = f"{pb.url}/api/collections/mba_info/records"
    warns = []
    for code in new:
        zone = _zone_of(code)
        try:
            _request("POST", base, token=tok,
                     payload={"code": code, "zone": zone, "sdm_kva": None, "p0_w": None, "pk_w": None})
        except PBError as e:
            print(f"[PB][WARN] Tao mba_info cho tram moi {code} that bai: {e}")
            continue
        warns.append({
            "title": "Trạm mới cần nhập thông số MBA",
            "message": f"Trạm {code} là điểm đo chính mới — cần nhập Sdm/P0/PK để tính tổn thất.",
            "area": ZONE_NAME.get(zone, "")})
    print(f"mba_info: them {len(new)} tram chinh moi (Sdm/P0/PK de trong): {new}")
    return warns


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


def upsert_station_map(meters: dict) -> list:
    """Cap nhat topology (line/code/role/customer/status) vao `station_map` tu HES —
    duoc phep GHI DE hang ngay (topology HES la nguon dung). KHONG dong den `hsn` o day
    (HSN khong con lay tu HES nua — xem sync_hsn_from_invoice).

    - Cong to da co: PATCH topology (khong co `hsn` trong payload -> giu nguyen).
    - Cong to moi: them voi hsn de TRONG (None) — cho sync_hsn_from_invoice dien tiep,
      hoac nguoi dung nhap tay neu chua co hoa don.

    Tra ve list canh bao [{title, message, area}] cho cong to MOI. Bat/tat qua WRITE_PB."""
    if os.environ.get("WRITE_PB", "1") == "0" or not PB_URL:
        if not PB_URL:
            print("[PB] Bo qua station_map: thieu PB_URL.")
        return []
    try:
        from pb_client import PBClient, PBError, _request
    except ImportError as e:  # noqa: BLE001
        print(f"[PB] Khong import duoc pb_client: {e}")
        return []

    pb = PBClient()
    try:
        tok = pb.token
        existing = {r["meter_no"]: r["id"] for r in pb.query_all("station_map", fields="id,meter_no")}
    except PBError as e:
        print(f"[PB][WARN] Doc station_map that bai: {e}")
        return []

    base = f"{pb.url}/api/collections/station_map/records"
    warns = []
    created = updated = 0
    for no, m in meters.items():
        if not no:
            continue
        cust = (m.get("CUSTOMER_NAME") or "").strip()
        area = (m.get("ADDRESS") or "").strip()
        common = {
            "line_id": m.get("LINE_ID", ""), "line_name": m.get("LINE_NAME", ""),
            "code": m.get("CODE", ""), "role": m.get("ROLE", ""),
            "meter_model": m.get("METER_MODEL_DESC", ""),
            "customer_code": m.get("CUSTOMER_CODE", ""), "customer_name": cust,
            "address": area, "status": m.get("STATUS", ""),
        }
        rid = existing.get(no)
        try:
            if rid:
                _request("PATCH", f"{base}/{rid}", token=tok, payload=common)  # KHONG co hsn
                updated += 1
            else:
                _request("POST", base, token=tok, payload={**common, "meter_no": no, "hsn": None})
                created += 1
                warns.append({
                    "title": "Công tơ mới trên HES",
                    "message": f"Công tơ mới {no} ({cust}) xuất hiện trên HES — cần đối chiếu/nhập hệ số nhân.",
                    "area": area})
        except PBError as e:
            print(f"[PB][WARN] station_map {no} that bai: {e}")
    print(f"[PB] station_map: {created} moi, {updated} cap nhat topology (tu HES, ghi de).")
    return warns


def sync_hsn_from_invoice() -> list:
    """HSN = gia tri tu HOA DON (invoice), KHONG con lay tu HES nua (loai sai xot HES).

    - Cong to CO hoa don (lay ban ghi MOI NHAT theo SCT, moi thoi diem — khong gioi han
      30 ngay): GHI DE station_map.hsn = invoice_hsn truc tiep (khong can canh bao lech,
      da tu sua dung).
    - Cong to CHUA TUNG co hoa don (moi tren HES) VA station_map.hsn dang trong/0:
      KHONG dong hsn -> canh bao "can nhap he so nhan". Cong to nay se bi loai khoi
      tinh toan (xem fetch_meter_data.py / TASK note) cho toi khi co hsn.

    Tra ve list canh bao [{title, message, area}]."""
    if not PB_URL:
        return []
    try:
        from pb_client import PBClient, PBError, _request
    except ImportError:
        return []
    pb = PBClient()
    try:
        tok = pb.token
        inv = pb.query_all("invoice", fields="SCT,HSN,EndDate", sort="-EndDate")
        sm = pb.query_all("station_map", fields="id,meter_no,hsn,customer_name,address")
    except PBError as e:
        print(f"[PB][WARN] Doc invoice/station_map that bai: {e}")
        return []

    latest = {}
    for r in inv:
        s = str(r.get("SCT") or "").strip()
        if s and s not in latest:  # da sort -EndDate -> ban ghi dau = moi nhat
            latest[s] = r

    base = f"{pb.url}/api/collections/station_map/records"
    warns = []
    synced = 0
    for r in sm:
        no = str(r.get("meter_no") or "").strip()
        if not no:
            continue
        cust = (r.get("customer_name") or "").strip()
        area = (r.get("address") or "").strip()
        iv = latest.get(no)
        if iv:
            ihsn = _to_float(iv.get("HSN"))
            cur = r.get("hsn")
            if cur is None or abs(_to_float(cur) - ihsn) > 0.5:
                try:
                    _request("PATCH", f"{base}/{r['id']}", token=tok, payload={"hsn": ihsn})
                    synced += 1
                except PBError as e:
                    print(f"[PB][WARN] Cap nhat hsn tu hoa don {no} that bai: {e}")
        else:
            cur = r.get("hsn")
            if cur is None or _to_float(cur) <= 0:
                warns.append({
                    "title": "Cần nhập hệ số nhân",
                    "message": f"Công tơ {no} ({cust}) chưa có hóa đơn — cần nhập hệ số nhân thủ công. "
                               f"Chưa tính vào tổn thất/công suất cho đến khi nhập HSN.",
                    "area": area})
    print(f"[PB] station_map: dong bo hsn tu hoa don cho {synced} cong to.")
    return warns


def send_notifications(entries: list):
    """Gui danh sach canh bao vao collection `notifications`, dedup theo message+area.
    Moi canh bao gui cho ca `area` (KCN cua cong to) va '' (khoi kinh doanh)."""
    if not entries:
        print("Khong co canh bao HSN.")
        return
    if not (PB_URL and PB_EMAIL and PB_PASS):
        print(f"[WARN] Co {len(entries)} canh bao nhung thieu PB creds -> khong gui.")
        return
    token = pb_login()
    if not token:
        print("[WARN] Khong dang nhap duoc PocketBase -> khong gui canh bao.")
        return
    headers = {"Authorization": token}
    api = f"{PB_URL}/api/collections/notifications/records"
    sent = 0
    for e in entries:
        for area in {e.get("area", ""), ""}:
            try:
                dup = requests.get(api, params={"filter": f'message="{e["message"]}" && area="{area}"', "perPage": 1},
                                   headers=headers, timeout=30)
                if dup.ok and dup.json().get("totalItems", 0) > 0:
                    continue
                r = requests.post(api, json={"title": e["title"], "message": e["message"],
                                             "type": "info", "mkh": "", "area": area},
                                  headers=headers, timeout=30)
                if r.ok:
                    sent += 1
                else:
                    print(f"[WARN] Gui canh bao that bai ({r.status_code}): {r.text[:150]}")
            except Exception as ex:  # noqa: BLE001
                print(f"[WARN] Loi gui canh bao: {ex}")
    print(f"Canh bao HSN: {len(entries)} muc, da gui {sent} thong bao.")


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

    # station_map: cap nhat topology (line/code/role/customer/status) tu HES, ghi de hang ngay.
    # HSN dong bo rieng tu hoa don (sync_hsn_from_invoice), KHONG con tu HES.
    warns = upsert_station_map(meters)
    warns += sync_hsn_from_invoice()
    warns += sync_mba_stations(meters)  # tram chinh moi -> record mba_info rong + canh bao
    for w in warns:
        print(f"[ALERT] {w['title']}: {w['message']}")
    send_notifications(warns)

    # Canh bao tram: CODE khong phai tien to cua LINE_NAME
    for s in bad_stations:
        print(f"[ALERT] Tram {s['line_id']}: CODE='{s['code']}' khong la tien to cua LINE_NAME='{s['line_name']}'.")
    notify_bad_stations(bad_stations)


if __name__ == "__main__":
    main()

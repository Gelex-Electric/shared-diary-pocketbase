#!/usr/bin/env python3
"""Lay chi so cong to dau/cuoi ky theo NGAY tu API GetMeterDataByDate va luu vao
public/hes_index_daily.csv.

Quy uoc ky:
    dau ky  = 00:00 ngay D      (mac dinh D = hom qua theo gio VN)
    cuoi ky = 00:00 ngay D+1    (= 00:00 hom nay)
San luong ngay D (do reader/app tinh) = (chi_so_cuoi - chi_so_dau) * HSN.

Voi moi cong to, script goi GetMeterDataByDate trong mot CUA SO nho quanh tung moc
00:00, loc ban ghi hop le (ACTIVE_KW_INDICATE_TOTAL > 0) va chon ban ghi co thoi
diem GAN moc nhat. Neu cua so dau rong thi noi rong dan (fallback).

Chi giu lai 2 ban ghi (dau + cuoi) moi cong to nen RAM ~ O(so cong to), khong phu
thuoc do dai chuoi. Khu trung lap theo khoa (METER_NO, DATE) -> chay lai an toan.
"""
import csv
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

BASE_URL = "http://14.225.244.63:8899/api"
OUT_PATH = "public/hes_index_daily.csv"
METTERINFO_PATH = os.environ.get("METTERINFO_PATH", "public/metterinfo.csv")

# Cac truong chi so luy ke can luu (raw, chua nhan HSN).
FIELD_MAP = {
    "PG": "ACTIVE_KW_INDICATE_TOTAL",     # huu cong tong
    "BT": "ACTIVE_KW_INDICATE_RATE1",     # bieu 1 (binh thuong)
    "CD": "ACTIVE_KW_INDICATE_RATE2",     # bieu 2 (cao diem)
    "TD": "ACTIVE_KW_INDICATE_RATE3",     # bieu 3 (thap diem)
    "VC": "REACTIVE_KVAR_INDICATE_TOTAL", # vo cong tong
}

OUT_FIELDS = (
    ["METER_NO", "DATE", "HSN", "START_TIME", "END_TIME"]
    + [f"{k}_START" for k in FIELD_MAP]
    + [f"{k}_END" for k in FIELD_MAP]
)

# Cac buoc noi rong cua so (phut) de tim ban ghi quanh moc 00:00.
WINDOW_STEPS = [int(x) for x in os.environ.get("WINDOW_STEPS", "60,180,1440").split(",")]
BATCH_SLEEP = float(os.environ.get("BATCH_SLEEP", "0.2"))   # nghi giua cac cong to
KEEP_DAYS = int(os.environ.get("KEEP_DAYS", "0"))           # 0 = giu toan bo lich su

VN_TZ = timezone(timedelta(hours=7))
HES_FMT = "%Y%m%d%H%M%S"
REC_FMT = "%Y-%m-%d %H:%M:%S"


def get_retry(url, *, attempts=4, **kwargs):
    """GET co retry cho loi mang/5xx (server cold-start hay tra 5xx)."""
    last = None
    for i in range(attempts):
        try:
            r = requests.get(url, **kwargs)
            if r.status_code < 500:
                return r
            last = f"{r.status_code} tai {r.url}"
        except Exception as e:  # noqa: BLE001
            last = str(e)
        if i < attempts - 1:
            time.sleep(5 * (i + 1))
    raise RuntimeError(last)


def target_day() -> datetime:
    """Ngay D can tinh (00:00 gio VN). Uu tien TARGET_DATE=YYYY-MM-DD, mac dinh hom qua."""
    override = os.environ.get("TARGET_DATE", "").strip()
    if override:
        d = datetime.strptime(override, "%Y-%m-%d").date()
    else:
        d = datetime.now(VN_TZ).date() - timedelta(days=1)
    return datetime(d.year, d.month, d.day)  # naive = gio VN local


def login() -> str:
    user = os.environ.get("API_USER", "")
    pw = os.environ.get("API_PASS", "")
    if not (user and pw):
        sys.exit("Thieu API_USER/API_PASS. Hay them vao GitHub Secrets.")
    r = get_retry(f"{BASE_URL}/Login", params={"UserAccount": user, "Password": pw}, timeout=30)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, list):
        data = data[0] if data else {}
    if str(data.get("CODE")) != "1":
        sys.exit(f"Login failed: {data.get('MESSAGE')}")
    return data["TOKEN"]


def load_meters():
    """Doc [(METER_NO, HSN)] tu metterinfo.csv, chi lay cong to STATUS == 'Yes'."""
    if not os.path.isfile(METTERINFO_PATH):
        sys.exit(f"Khong tim thay {METTERINFO_PATH}. Hay chay fetch_meter_info.py truoc.")
    meters = []
    with open(METTERINFO_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if str(row.get("STATUS") or "").strip().lower() != "yes":
                continue
            no = str(row.get("METER_NO") or "").strip()
            if not no:
                continue
            try:
                hsn = float(row.get("METER_NAME") or 1) or 1.0
            except (TypeError, ValueError):
                hsn = 1.0
            meters.append((no, hsn))
    return meters


def _rec_time(rec) -> str:
    return rec.get("DATE_TIME") or rec.get("DATA_TIME") or ""


def _parse_time(s: str):
    try:
        return datetime.strptime(s, REC_FMT)
    except (TypeError, ValueError):
        return None


def fetch_boundary(token: str, meter_no: str, boundary: datetime):
    """Tra ve ban ghi hop le gan `boundary` (00:00) nhat, noi rong cua so dan.

    None neu khong tim thay trong tat ca cac buoc cua so.
    """
    start_str = boundary.strftime(HES_FMT)
    for win in WINDOW_STEPS:
        end_str = (boundary + timedelta(minutes=win)).strftime(HES_FMT)
        try:
            r = get_retry(
                f"{BASE_URL}/GetMeterDataByDate",
                params={"MeterNo": meter_no, "StartDate": start_str, "EndDate": end_str, "Token": token},
                timeout=60,
            )
            r.raise_for_status()
            data = r.json()
        except Exception as e:  # noqa: BLE001
            print(f"[WARN] {meter_no} @ {start_str}: loi API ({e})")
            return None

        if isinstance(data, dict):
            if str(data.get("MESSAGE", "")).lower() == "invalid token":
                raise RuntimeError("invalid token")
            data = data.get("DATA") or data.get("data") or []
        if not isinstance(data, list) or not data:
            continue

        valid = [r_ for r_ in data if _to_float(r_.get("ACTIVE_KW_INDICATE_TOTAL")) > 0]
        if not valid:
            continue
        valid.sort(key=lambda r_: abs(((_parse_time(_rec_time(r_)) or boundary) - boundary).total_seconds()))
        return valid[0]
    return None


def _to_float(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def build_row(meter_no, hsn, day, start_rec, end_rec) -> dict:
    row = {
        "METER_NO": meter_no,
        "DATE": day.strftime("%Y-%m-%d"),
        "HSN": f"{hsn:g}",
        "START_TIME": _rec_time(start_rec),
        "END_TIME": _rec_time(end_rec),
    }
    for key, src in FIELD_MAP.items():
        row[f"{key}_START"] = start_rec.get(src, "")
        row[f"{key}_END"] = end_rec.get(src, "")
    return row


def write_out(new_rows):
    """Append + khu trung theo (METER_NO, DATE), prune theo KEEP_DAYS neu can."""
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    merged = {}
    if os.path.isfile(OUT_PATH):
        with open(OUT_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                merged[(row.get("METER_NO", ""), row.get("DATE", ""))] = row
    for row in new_rows:
        merged[(row["METER_NO"], row["DATE"])] = row

    rows = list(merged.values())
    if KEEP_DAYS > 0:
        cutoff = (datetime.now(VN_TZ).date() - timedelta(days=KEEP_DAYS)).isoformat()
        rows = [r for r in rows if r.get("DATE", "") >= cutoff]
    rows.sort(key=lambda r: (r.get("DATE", ""), r.get("METER_NO", "")))

    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=OUT_FIELDS)
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def main():
    day = target_day()
    start_boundary = day                       # hom qua 00:00
    end_boundary = day + timedelta(days=1)      # hom nay 00:00
    print(f"Ky ngay {day:%Y-%m-%d}: dau={start_boundary:%Y-%m-%d %H:%M}, cuoi={end_boundary:%Y-%m-%d %H:%M}")

    meters = load_meters()
    print(f"Doc {len(meters)} cong to (STATUS=Yes) tu {METTERINFO_PATH}")
    if not meters:
        sys.exit("Khong co cong to nao.")

    token = login()
    new_rows, missing = [], 0
    for i, (no, hsn) in enumerate(meters):
        try:
            start_rec = fetch_boundary(token, no, start_boundary)
            end_rec = fetch_boundary(token, no, end_boundary)
        except RuntimeError as e:
            if str(e) == "invalid token":
                sys.exit("Token het han giua chung - dung lai (khong ghi de CSV cu).")
            raise
        if start_rec and end_rec:
            new_rows.append(build_row(no, hsn, day, start_rec, end_rec))
        else:
            missing += 1
            print(f"  [skip] {no}: thieu chi so ({'dau' if not start_rec else ''}{'/cuoi' if not end_rec else ''})")
        if BATCH_SLEEP:
            time.sleep(BATCH_SLEEP)

    if not new_rows:
        print("Khong lay duoc chi so cho cong to nao - giu nguyen CSV cu.")
        return
    total = write_out(new_rows)
    print(f"Ghi {len(new_rows)} cong to (thieu {missing}). Tong file: {total} dong -> {OUT_PATH}")


if __name__ == "__main__":
    main()

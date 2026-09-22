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
# DATAMETTER_PATH: cung ten bien voi daily_transformer_loss.py (doc file nay) — cho
# phep backfill tro toi file tam, khong dung public/datametter.csv (rolling 7 ngay
# cho dashboard Dien ap).
CSV_PATH = os.environ.get("DATAMETTER_PATH", "public/datametter.csv")
# Giữ 6 cột đầu ĐÚNG THỨ TỰ CŨ (frontend VoltagePowerDashboard đọc theo vị trí:
# TOTAL_KW ở index 5). Cột mới chỉ được NỐI VÀO CUỐI để không phá tương thích.
FIELDS = ["METER_NO", "DATE_TIME", "PHASE_A_VOLTS", "PHASE_B_VOLTS", "PHASE_C_VOLTS", "TOTAL_KW",
          "PHASE_A_AMPERE", "PHASE_B_AMPERE", "PHASE_C_AMPERE", "TOTAL_KVAR"]
# Các trường phải nhân hệ số nhân (HSN) khi lưu — công suất & dòng điện.
SCALED_FIELDS = ["TOTAL_KW", "PHASE_A_AMPERE", "PHASE_B_AMPERE", "PHASE_C_AMPERE", "TOTAL_KVAR"]
KEEP_RECORDS = int(os.environ.get("KEEP_RECORDS", "336"))  # 7 ngay x 48 ban ghi/ngay moi cong to
FETCH_HOURS = int(os.environ.get("FETCH_HOURS", "6"))       # cua so lay du lieu, rong de vot ban ghi ve tre
# TARGET_DATE (YYYY-MM-DD): backfill 1 ngay qua khu (00:00->24:00) thay vi now-FETCH_HOURS->now.
TARGET_DATE = os.environ.get("TARGET_DATE", "").strip()
# ROLE_FILTER: chi lay cong to co ROLE nay trong metterinfo.csv (vd "chinh"). Rong = lay tat ca.
ROLE_FILTER = os.environ.get("ROLE_FILTER", "").strip()
# Sleep nho giua cac cong to khi backfill (TARGET_DATE) de khong don tai server HES.
FETCH_SLEEP = float(os.environ.get("FETCH_SLEEP", "0"))

USER_ACCOUNT = os.environ.get("API_USER", "")
PASSWORD = os.environ.get("API_PASS", "")

# Danh sach cong to doc tu metterinfo.csv (sinh boi fetch_meter_info.py).
METTERINFO_PATH = os.environ.get("METTERINFO_PATH", "public/metterinfo.csv")

# HSN LAY TU DANH MUC (dm_point.hsn), KHONG lay tu METER_NAME cua HES
# (user chot 22/09/2026).
#
# Vi sao: METER_NAME cua HES la ban khai ben do, con nguon dung la HSN suy tu bo
# TI/TU dang treo tai diem do trong Danh muc. Day chinh la cho sai da lam phan
# ton that phai dung ngay 16/09/2026. Doi chieu 106 cong to ngay 22/09 thi co 1
# cai lech: 2510203134 (HES 320, Danh muc 200) — moi so cong suat cua no trong
# datametter.csv va pmax_daily.csv deu VONG 60% ke tu 01/01.
#
# Cong to KHONG co trong Danh muc thi van dung HSN cua HES: khong co nguon nao
# tot hon, va bo han chung di thi mat du lieu. So luong se duoc in ra de biet.
# Nguong HSN vo ly. Cung y nghia voi HSN_MAX ben fetch_meter_info.py: HSN thuc
# te cao nhat trong he thong la vai nghin, nen vuot nguong nay chac chan la loi
# nhap lieu ben HES chu khong phai he so that.
HSN_MAX = float(os.environ.get("HSN_MAX", "100000"))

PB_URL = os.environ.get("PB_URL", "https://getc.up.railway.app/pb").rstrip("/")
PB_EMAIL = os.environ.get("PB_EMAIL", "") or os.environ.get("PB_ADMIN_EMAIL", "")
PB_PASS = os.environ.get("PB_PASS", "") or os.environ.get("PB_ADMIN_PASSWORD", "")

VN_TZ = timezone(timedelta(hours=7))


def hsn_from_catalog() -> dict:
    """{so_cong_to: HSN} tu Danh muc: dm_asset (CONGTO, dang treo) -> dm_point.hsn.

    "Dang treo" = co ngay treo va CHUA co ngay thao — chat hon co `active`.
    Tra dict rong neu thieu tai khoan PB hoac goi that bai; khi do goi ben tren
    tu lui ve HSN cua HES va IN RA canh bao, chu khong im lang dung so sai.
    """
    if not (PB_URL and PB_EMAIL and PB_PASS):
        print("[WARN] Thieu PB_EMAIL/PB_PASS -> HSN van lay tu METER_NAME cua HES.")
        return {}
    try:
        auth = requests.post(
            f"{PB_URL}/api/collections/_superusers/auth-with-password",
            json={"identity": PB_EMAIL, "password": PB_PASS}, timeout=30)
        if not auth.ok:
            auth = requests.post(
                f"{PB_URL}/api/collections/users/auth-with-password",
                json={"identity": PB_EMAIL, "password": PB_PASS}, timeout=30)
        auth.raise_for_status()
        head = {"Authorization": auth.json().get("token", "")}

        def rows(coll):
            out, page = [], 1
            while True:
                r = requests.get(f"{PB_URL}/api/collections/{coll}/records",
                                 params={"perPage": 500, "page": page},
                                 headers=head, timeout=60)
                r.raise_for_status()
                j = r.json()
                out.extend(j.get("items", []))
                if page >= (j.get("totalPages") or 1):
                    return out
                page += 1

        points = {p["id"]: p for p in rows("dm_point")}
        out = {}
        for a in rows("dm_asset"):
            if a.get("type") != "CONGTO" or not a.get("point"):
                continue
            if not (a.get("date_on") or "")[:10] or (a.get("date_off") or "")[:10]:
                continue
            p = points.get(a["point"])
            if not p or p.get("hsn") is None:
                continue
            out[str(a.get("serial") or "").strip()] = float(p["hsn"])
        return out
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] Khong doc duoc HSN tu Danh muc ({e}) -> lui ve HSN cua HES.")
        return {}


def load_meter_list():
    """Doc {METER_NO: HSN}. Danh sach cong to tu metterinfo.csv, HSN tu Danh muc.
    ROLE_FILTER (neu co) chi lay cong to dung ROLE do."""
    if not os.path.isfile(METTERINFO_PATH):
        sys.exit(f"Khong tim thay {METTERINFO_PATH}. Hay chay fetch_meter_info.py truoc.")
    meters = {}
    with open(METTERINFO_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            no = str(row.get("METER_NO") or "").strip()
            if not no:
                continue
            if ROLE_FILTER and (row.get("ROLE") or "").strip() != ROLE_FILTER:
                continue
            try:
                hsn = float(row.get("METER_NAME") or 1) or 1.0
            except (TypeError, ValueError):
                hsn = 1.0
            meters[no] = hsn

    catalog = hsn_from_catalog()
    if catalog:
        changed = [no for no, h in meters.items()
                   if no in catalog and catalog[no] != h]
        for no in changed:
            print(f"[HSN] {no}: HES {meters[no]:g} -> Danh muc {catalog[no]:g}")
        for no in catalog:
            if no in meters:
                meters[no] = catalog[no]

    # BO HAN cong to co HSN cua HES vo ly va KHONG co trong Danh muc.
    #
    # Vi sao phai chan (them 22/09/2026): `METER_NAME` ben HES doi khi bi nhap
    # chinh SO CONG TO vao — 2610159558 co METER_NAME = 2610159558. Cong to do
    # dang im lang nen chua gay hai, nhung ngay nao no phat du lieu thi cong
    # suat se nhan len 2,6 TY lan va con so do chay thang vao datametter.csv roi
    # pmax_daily.csv (file luu vinh vien).
    #
    # Bo qua han, KHONG doan bang 1: doan 1 thi ra mot con so nho trong co ve
    # hop ly, khong ai phat hien. Thieu han du lieu thi con nhin ra ma di khai
    # ngay treo cho no trong Danh muc.
    bogus = {}
    for no in list(meters):
        if no in catalog:
            continue                      # Danh muc da quyet, khong can xet HES
        h = meters[no]
        if h > HSN_MAX or f"{h:g}" == no:
            bogus[no] = h
            del meters[no]
    for no, h in bogus.items():
        print(f"[BO QUA] {no}: HSN ben HES la {h:g} - vo ly, ma Danh muc chua khai "
              f"cong to nay. Khai ngay treo cho no de dung HSN cua Danh muc.")

    if catalog:
        missing = [no for no in meters if no not in catalog]
        print(f"HSN: {len(meters) - len(missing)} cong to lay tu Danh muc "
              f"({len(changed)} lech so voi HES), {len(missing)} cong to khong co "
              f"trong Danh muc nen giu HSN cua HES"
              f"{f', {len(bogus)} cong to bi bo qua vi HSN rac' if bogus else ''}.")
    return meters


def login_data() -> dict:
    """Tra ve object dang nhap (gom USER_ID, TOKEN).

    Neu co API_TOKEN (token da lay san) thi dung luon, KHONG goi Login — theo luu y
    trong API_HES.md: chi login khi cac ham khac loi. USER_ID mac dinh '2' (GETC).
    """
    token = os.environ.get("API_TOKEN", "").strip()
    if token:
        return {"CODE": "1", "TOKEN": token, "USER_ID": os.environ.get("USER_ID", "2")}
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


class InvalidToken(Exception):
    """Token het han giua chung — KHONG duoc coi la '0 ban ghi', phai dung lai va relogin."""


def fetch_instant(token: str, meter_no: str):
    fmt = "%Y%m%d%H%M%S"
    if TARGET_DATE:
        day = datetime.strptime(TARGET_DATE, "%Y-%m-%d")
        start, end = day, day + timedelta(days=1)
    else:
        end = datetime.now(VN_TZ)
        start = end - timedelta(hours=FETCH_HOURS)
    try:
        r = requests.get(
            f"{BASE_URL}/GetInstantByDate",
            params={
                "MeterNo": meter_no,
                "StartDate": start.strftime(fmt),
                "EndDate": end.strftime(fmt),
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
        # Token het han tra ve {"CODE":"0","MESSAGE":"invalid token"} — KHONG duoc
        # nuot thanh "khong co du lieu" (se lam sai backfill: ghi nham ngay co du
        # lieu thanh ngay trong).
        if str(data.get("MESSAGE", "")).strip().lower() == "invalid token":
            raise InvalidToken(meter_no)
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
    print(f"Doc {len(meters)} cong to tu {METTERINFO_PATH}"
          f"{f' (ROLE={ROLE_FILTER})' if ROLE_FILTER else ''}"
          f"{f' — TARGET_DATE={TARGET_DATE}' if TARGET_DATE else ''}")
    if not meters:
        sys.exit(f"Khong co cong to nao trong {METTERINFO_PATH}.")
    token = login()

    all_rows = []
    for no, hsn in meters.items():
        try:
            rows = fetch_instant(token, no)
        except InvalidToken:
            # Thoat voi ma loi rieng de driver backfill nhan biet va relogin roi
            # chay lai DUNG ngay nay (khong ghi gi ca — an toan, idempotent).
            sys.exit("TOKEN_EXPIRED")
        for rec in rows:
            rec.setdefault("METER_NO", no)
            for fld in SCALED_FIELDS:  # công suất + dòng điện đều ×HSN; điện áp giữ nguyên
                rec[fld] = scale(rec.get(fld), hsn)
        print(f"  {no} (HSN={hsn:g}): {len(rows)} ban ghi")
        all_rows.extend(rows)
        if FETCH_SLEEP:
            time.sleep(FETCH_SLEEP)

    if not all_rows:
        print("Khong co du lieu moi trong khung gio nay.")
        return
    append_csv(all_rows)


if __name__ == "__main__":
    main()

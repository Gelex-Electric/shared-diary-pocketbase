#!/usr/bin/env python3
"""Sua du lieu sai cho 1 hoac nhieu cong to trong mot khoang ngay cu the.

Dung khi phat hien HSN (he so nhan) sai tai thoi diem fetch lam TOTAL_KW bi luu
sai trong mot khoang thoi gian da qua (vd HSN sai tu ngay X den nay, da duoc sua
lai dung trong public/metterinfo.csv).

Script goi lai GetInstantByDate (du lieu THO, chua nhan he so) cho dung cong to +
khoang ngay, nhan lai voi HSN HIEN TAI (da sua) doc tu metterinfo.csv, roi ghi de:
  - public/pmax_daily.csv   theo khoa (METER_NO, DATE)      -> Pmax tinh lai tu dau
  - public/datametter.csv  theo khoa (METER_NO, DATE_TIME)  -> chi co tac dung voi
    cac ban ghi con nam trong cua so giu lai (KEEP_RECORDS, mac dinh 7 ngay); ban
    ghi ngoai cua so nay khong con trong file nen khong can/khong the sua.

An toan de chay lai nhieu lan (idempotent) - ghi de theo khoa, khong tao trung lap.

Bien moi truong:
  METERS       bat buoc. Danh sach so cong to, cach nhau boi dau phay.
               Vd: "2510203126" hoac "2510203126,2610159557"
  START_DATE   bat buoc, YYYY-MM-DD (ngay dau cua khoang bi sai)
  END_DATE     mac dinh = hom qua (gio VN)
Yeu cau secrets: API_USER, API_PASS.
"""
import os
import sys
from datetime import date, datetime, timedelta

from fetch_meter_data import VN_TZ, load_meter_list, login, scale, append_csv
from backfill_pmax import month_chunks, fetch_range, load_existing as load_pmax, write_out as write_pmax


def parse_meters():
    raw = os.environ.get("METERS", "").strip()
    if not raw:
        sys.exit("Thieu METERS (danh sach so cong to, cach nhau boi dau phay).")
    meters = [m.strip() for m in raw.split(",") if m.strip()]
    if not meters:
        sys.exit("METERS rong sau khi parse.")
    return meters


def parse_dates():
    start_raw = os.environ.get("START_DATE", "").strip()
    if not start_raw:
        sys.exit("Thieu START_DATE (YYYY-MM-DD).")
    start_d = date.fromisoformat(start_raw)
    end_raw = os.environ.get("END_DATE", "").strip()
    end_d = date.fromisoformat(end_raw) if end_raw else (datetime.now(VN_TZ).date() - timedelta(days=1))
    if end_d < start_d:
        sys.exit(f"END_DATE ({end_d}) phai >= START_DATE ({start_d}).")
    return start_d, end_d


def main():
    meters = parse_meters()
    start_d, end_d = parse_dates()
    print(f"Sua lai du lieu cho {len(meters)} cong to, tu {start_d} den {end_d}: {meters}")

    hsn_map = load_meter_list()  # HSN HIEN TAI (da sua) tu metterinfo.csv
    token = login()
    chunks = list(month_chunks(start_d, end_d))

    pmax_all = load_pmax()
    datametter_rows = []

    for meter in meters:
        hsn = hsn_map.get(meter)
        if hsn is None:
            print(f"[WARN] {meter}: khong co trong metterinfo.csv (STATUS=Yes?) -> dung HSN=1.0")
            hsn = 1.0

        pmax_by_day = {}
        meter_records = 0
        for c0, c1 in chunks:
            for rec in fetch_range(token, meter, c0, c1):
                rec.setdefault("METER_NO", meter)
                day = str(rec.get("DATE_TIME", ""))[:10]
                if len(day) != 10:
                    continue
                kw_str = scale(rec.get("TOTAL_KW"), hsn)
                try:
                    kw = float(kw_str)
                except (TypeError, ValueError):
                    continue
                if day not in pmax_by_day or kw > pmax_by_day[day]:
                    pmax_by_day[day] = kw
                rec["TOTAL_KW"] = kw_str
                datametter_rows.append(rec)
                meter_records += 1

        for day, kw in pmax_by_day.items():
            pmax_all[(meter, day)] = {"METER_NO": meter, "DATE": day, "PMAX_KW": f"{kw:g}"}
        print(f"  {meter} (HSN={hsn:g}): {len(pmax_by_day)} ngay co du lieu, {meter_records} ban ghi tho")

    if not datametter_rows:
        sys.exit("Khong lay duoc ban ghi nao tu API - kiem tra lai METERS/khoang ngay.")

    pmax_total = write_pmax(pmax_all)
    print(f"pmax_daily.csv: da ghi de, tong {pmax_total} dong.")

    append_csv(datametter_rows)
    print(
        "datametter.csv: da merge/ghi de theo khoa (METER_NO, DATE_TIME). "
        "Chi co hieu luc voi cac ban ghi con trong cua so giu lai (KEEP_RECORDS)."
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Doc public/datametter.csv, tinh Pmax (gia tri lon nhat cua TOTAL_KW) cua tung
cong to trong MOT NGAY, roi append vao public/pmax_daily.csv.

Mac dinh tinh cho "hom qua" (theo gio VN). Co the ghi de bang TARGET_DATE=YYYY-MM-DD
de tinh lai/backfill mot ngay cu the.

Khu trung lap theo khoa (METER_NO, DATE) nen chay lai khong tao ban ghi nhan doi.
"""
import csv
import os
import sys
from datetime import datetime, timedelta, timezone

SRC_PATH = "public/datametter.csv"
OUT_PATH = "public/pmax_daily.csv"
OUT_FIELDS = ["METER_NO", "DATE", "PMAX_KW"]

VN_TZ = timezone(timedelta(hours=7))


def target_date() -> str:
    """Ngay can tinh (YYYY-MM-DD). Uu tien TARGET_DATE, mac dinh la hom qua VN."""
    override = os.environ.get("TARGET_DATE", "").strip()
    if override:
        return override
    yesterday = datetime.now(VN_TZ).date() - timedelta(days=1)
    return yesterday.isoformat()


def compute_pmax(day: str) -> dict:
    """Tra ve {METER_NO: pmax} cho cac dong co DATE_TIME bat dau bang `day`."""
    if not os.path.isfile(SRC_PATH):
        sys.exit(f"Khong tim thay {SRC_PATH}")

    pmax = {}
    with open(SRC_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if (row.get("DATE_TIME", "")[:10]) != day:
                continue
            try:
                kw = float(row.get("TOTAL_KW", ""))
            except (TypeError, ValueError):
                continue
            no = row.get("METER_NO", "")
            if not no:
                continue
            if no not in pmax or kw > pmax[no]:
                pmax[no] = kw
    return pmax


def append_out(day: str, pmax: dict):
    # Doc ket qua cu, khu trung theo (METER_NO, DATE)
    all_data = {}
    if os.path.isfile(OUT_PATH):
        with open(OUT_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                key = (row.get("METER_NO", ""), row.get("DATE", ""))
                all_data[key] = row

    for no, kw in pmax.items():
        all_data[(no, day)] = {
            "METER_NO": no,
            "DATE": day,
            "PMAX_KW": f"{kw:g}",
        }

    rows = sorted(all_data.values(), key=lambda r: (r["DATE"], r["METER_NO"]))
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=OUT_FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"Pmax ngay {day}: {len(pmax)} cong to. Tong file: {len(rows)} dong -> {OUT_PATH}")


def main():
    day = target_date()
    pmax = compute_pmax(day)
    if not pmax:
        print(f"Khong co du lieu cho ngay {day} trong {SRC_PATH} (co the da bi cat khoi vong giu 7 ngay).")
        return
    append_out(day, pmax)


if __name__ == "__main__":
    main()

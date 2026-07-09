#!/usr/bin/env python3
"""Tong hop ton that MBA theo THANG cho tung tram, luu vinh vien vao
public/transformer_loss_monthly.csv.

Doc public/transformer_loss_30min.csv (chi giu ~40 ngay) -> cong cac thanh phan
ton that theo (CODE, MONTH). Vi file 30 phut chi con ~2 thang gan nhat nen moi lan
chay chi cap nhat lai cac thang do; cac thang cu hon da chot trong file thang duoc
GIU NGUYEN (khu trung theo (CODE, MONTH)).

KHONG tu commit (daily-pipeline.yml commit chung).
"""
import csv
import os
import sys

SRC_PATH = os.environ.get("LOSS30_PATH", "public/transformer_loss_30min.csv")
OUT_PATH = "public/transformer_loss_monthly.csv"

OUT_FIELDS = ["CODE", "LINE_NAME", "MONTH", "N_INTERVALS", "OUTPUT_KWH",
              "LOSS_NOLOAD_KWH", "LOSS_LOAD_KWH", "LOSS_TOTAL_KWH"]


def _to_float(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def aggregate() -> dict:
    """Tra ve {(code, month): {LINE_NAME, n, noload, load, total}} tu file 30 phut."""
    if not os.path.isfile(SRC_PATH):
        print(f"Chua co {SRC_PATH} -> khong co gi de tong hop thang.")
        return {}
    agg = {}
    with open(SRC_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            code = str(row.get("CODE") or "").strip()
            dt = str(row.get("DATE_TIME") or "").strip()
            month = dt[:7]  # YYYY-MM
            if not code or len(month) != 7:
                continue
            key = (code, month)
            slot = agg.setdefault(key, {
                "LINE_NAME": (row.get("LINE_NAME") or "").strip(),
                "n": 0, "output": 0.0, "noload": 0.0, "load": 0.0, "total": 0.0,
            })
            slot["n"] += 1
            slot["output"] += _to_float(row.get("OUTPUT_KWH"))
            slot["noload"] += _to_float(row.get("LOSS_NOLOAD_KWH"))
            slot["load"] += _to_float(row.get("LOSS_LOAD_KWH"))
            slot["total"] += _to_float(row.get("LOSS_KWH"))
    return agg


def load_existing() -> dict:
    merged = {}
    if os.path.isfile(OUT_PATH):
        with open(OUT_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                merged[(row.get("CODE", ""), row.get("MONTH", ""))] = row
    return merged


def main():
    agg = aggregate()
    if not agg:
        return
    merged = load_existing()
    for (code, month), s in agg.items():
        merged[(code, month)] = {
            "CODE": code,
            "LINE_NAME": s["LINE_NAME"],
            "MONTH": month,
            "N_INTERVALS": s["n"],
            "OUTPUT_KWH": f"{s['output']:g}",
            "LOSS_NOLOAD_KWH": f"{s['noload']:g}",
            "LOSS_LOAD_KWH": f"{s['load']:g}",
            "LOSS_TOTAL_KWH": f"{s['total']:g}",
        }

    rows = sorted(merged.values(), key=lambda r: (r.get("MONTH", ""), r.get("CODE", "")))
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=OUT_FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"Cap nhat {len(agg)} (tram,thang). Tong file thang: {len(rows)} dong -> {OUT_PATH}")


if __name__ == "__main__":
    main()

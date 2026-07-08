#!/usr/bin/env python3
"""Tinh ton that ky thuat may bien ap (theo TRAM) o do phan giai 30 phut cho ngay
hom qua, luu vao public/transformer_loss_30min.csv.

Mo hinh:
  - 1 tram (CODE) = 1 MBA. Tram gom cac cong to CHINH (ROLE=chinh trong
    metterinfo.csv) -> cong P, Q cua chung tai tung moc 30 phut = phu tai MBA.
  - Cong thuc: S = sqrt(P^2 + Q^2); tai = S/Sdm; dP = P0 + Pk*(S/Sdm)^2 (kW).
    LOSS_NOLOAD = P0*0.5 kWh; LOSS_LOAD = Pk*tai^2*0.5 kWh; LOSS = dP*0.5 kWh.

Nguon du lieu:
  - metterinfo.csv : CODE, ROLE, STATUS cho tung cong to (do fetch_meter_info.py sinh).
  - mba_info.csv   : thong so nhan MBA theo CODE (nhap tay).
  - datametter.csv : TOTAL_KW, TOTAL_KVAR DA nhan HSN (do fetch_meter_data.py sinh) ->
                     KHONG nhan lai HSN o day.

Khu trung theo khoa (CODE, DATE_TIME) nen chay lai an toan. Prune giu KEEP_DAYS ngay
gan nhat. KHONG tu commit (daily-pipeline.yml commit chung).
"""
import csv
import math
import os
import sys
from datetime import datetime, timedelta, timezone

VN_TZ = timezone(timedelta(hours=7))

METTERINFO_PATH = os.environ.get("METTERINFO_PATH", "public/metterinfo.csv")
MBA_PATH = os.environ.get("MBA_PATH", "public/mba_info.csv")
DATAMETTER_PATH = os.environ.get("DATAMETTER_PATH", "public/datametter.csv")
OUT_PATH = "public/transformer_loss_30min.csv"

KEEP_DAYS = int(os.environ.get("KEEP_DAYS", "40"))  # giu 40 ngay gan nhat/tram

OUT_FIELDS = ["CODE", "LINE_NAME", "DATE_TIME", "N_METERS", "P_KW", "Q_KVAR",
              "S_KVA", "LOAD_PCT", "DELTA_P_KW", "LOSS_NOLOAD_KWH",
              "LOSS_LOAD_KWH", "LOSS_KWH"]


def target_date() -> str:
    override = os.environ.get("TARGET_DATE", "").strip()
    if override:
        return override
    return (datetime.now(VN_TZ).date() - timedelta(days=1)).isoformat()


def _to_float(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load_main_meters() -> dict:
    """{METER_NO: CODE} cho cac cong to ROLE=chinh + STATUS=Yes co CODE."""
    if not os.path.isfile(METTERINFO_PATH):
        sys.exit(f"Khong tim thay {METTERINFO_PATH}. Hay chay fetch_meter_info.py truoc.")
    meter2code = {}
    with open(METTERINFO_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if str(row.get("ROLE") or "").strip() != "chinh":
                continue
            if str(row.get("STATUS") or "").strip().lower() != "yes":
                continue
            code = str(row.get("CODE") or "").strip()
            no = str(row.get("METER_NO") or "").strip()
            if code and no:
                meter2code[no] = code
    return meter2code


def load_mba() -> dict:
    """{CODE: {LINE_NAME, SDM_KVA, P0_KW, PK_KW}} tu mba_info.csv (nhap tay)."""
    if not os.path.isfile(MBA_PATH):
        sys.exit(f"Khong tim thay {MBA_PATH}. Hay tao va nhap thong so MBA.")
    mba = {}
    with open(MBA_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            code = str(row.get("CODE") or "").strip()
            if not code or code.startswith("#"):
                continue
            sdm = _to_float(row.get("SDM_KVA"))
            if sdm <= 0:
                print(f"[WARN] Tram {code}: SDM_KVA khong hop le ({row.get('SDM_KVA')!r}) -> bo qua.")
                continue
            mba[code] = {
                "LINE_NAME": (row.get("LINE_NAME") or "").strip(),
                "SDM_KVA": sdm,
                "P0_KW": _to_float(row.get("P0_KW")),
                "PK_KW": _to_float(row.get("PK_KW")),
            }
    return mba


def accumulate(day: str, meter2code: dict, valid_codes: set) -> dict:
    """Doc datametter.csv, cong P/Q cac cong to chinh theo (CODE, DATE_TIME).
    Tra ve {(code, dt): {"P":.., "Q":.., "n":..}}."""
    if not os.path.isfile(DATAMETTER_PATH):
        sys.exit(f"Khong tim thay {DATAMETTER_PATH}.")
    agg = {}
    with open(DATAMETTER_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            dt = str(row.get("DATE_TIME") or "").strip()
            if dt[:10] != day:
                continue
            no = str(row.get("METER_NO") or "").strip()
            code = meter2code.get(no)
            if not code or code not in valid_codes:
                continue
            key = (code, dt)
            slot = agg.setdefault(key, {"P": 0.0, "Q": 0.0, "n": 0})
            slot["P"] += _to_float(row.get("TOTAL_KW"))
            slot["Q"] += _to_float(row.get("TOTAL_KVAR"))
            slot["n"] += 1
    return agg


def build_rows(agg: dict, mba: dict) -> list:
    rows = []
    for (code, dt), slot in agg.items():
        m = mba[code]
        sdm, p0, pk = m["SDM_KVA"], m["P0_KW"], m["PK_KW"]
        p, q = slot["P"], slot["Q"]
        s = math.sqrt(p * p + q * q)
        load = s / sdm if sdm else 0.0
        loss_noload = p0 * 0.5
        loss_load = pk * load * load * 0.5
        delta_p = p0 + pk * load * load
        rows.append({
            "CODE": code,
            "LINE_NAME": m["LINE_NAME"],
            "DATE_TIME": dt,
            "N_METERS": slot["n"],
            "P_KW": f"{p:g}",
            "Q_KVAR": f"{q:g}",
            "S_KVA": f"{s:g}",
            "LOAD_PCT": f"{load * 100:g}",
            "DELTA_P_KW": f"{delta_p:g}",
            "LOSS_NOLOAD_KWH": f"{loss_noload:g}",
            "LOSS_LOAD_KWH": f"{loss_load:g}",
            "LOSS_KWH": f"{loss_noload + loss_load:g}",
        })
    return rows


def write_out(new_rows: list):
    merged = {}
    if os.path.isfile(OUT_PATH):
        with open(OUT_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                merged[(row.get("CODE", ""), row.get("DATE_TIME", ""))] = row
    for row in new_rows:
        merged[(row["CODE"], row["DATE_TIME"])] = row

    rows = list(merged.values())
    if KEEP_DAYS > 0:
        cutoff = (datetime.now(VN_TZ).date() - timedelta(days=KEEP_DAYS)).isoformat()
        rows = [r for r in rows if str(r.get("DATE_TIME", ""))[:10] >= cutoff]
    rows.sort(key=lambda r: (r.get("DATE_TIME", ""), r.get("CODE", "")))

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=OUT_FIELDS)
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def main():
    day = target_date()
    meter2code = load_main_meters()
    mba = load_mba()
    codes = set(meter2code.values()) & set(mba.keys())
    print(f"Ngay {day}: {len(meter2code)} cong to chinh, {len(mba)} tram co thong so MBA, "
          f"{len(codes)} tram se tinh ton that.")
    if not codes:
        print("Khong co tram nao du dieu kien (can ca cong to chinh lan thong so MBA). Bo qua.")
        return

    agg = accumulate(day, meter2code, codes)
    if not agg:
        print(f"Khong co du lieu datametter cho ngay {day}. Bo qua.")
        return
    new_rows = build_rows(agg, mba)
    total = write_out(new_rows)
    print(f"Ghi {len(new_rows)} moc 30 phut (ngay {day}). Tong file: {total} dong -> {OUT_PATH}")


if __name__ == "__main__":
    main()

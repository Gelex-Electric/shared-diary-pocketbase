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
import io
import math
import os
import re
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


def _norm_code(s) -> str:
    """Chuan hoa CODE de so khop: bo khoang trang, viet hoa."""
    return re.sub(r"\s+", "", str(s or "").strip().upper())


def load_main_meters():
    """Tra ve (meter2code, code2line):
      meter2code {METER_NO: CODE} cho cong to ROLE=chinh + STATUS=Yes co CODE.
      code2line  {CODE: LINE_NAME} lay ten tram tu metterinfo."""
    if not os.path.isfile(METTERINFO_PATH):
        sys.exit(f"Khong tim thay {METTERINFO_PATH}. Hay chay fetch_meter_info.py truoc.")
    meter2code, code2line = {}, {}
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
                code2line.setdefault(code, (row.get("LINE_NAME") or "").strip())
    return meter2code, code2line


def _parse_num(s, vi: bool):
    """Parse so. vi=True: kieu vi-VN ('.'=ngan nghin, ','=thap phan). None neu rong."""
    s = str(s or "").strip()
    if not s:
        return None
    s = s.replace(".", "").replace(",", ".") if vi else s.replace(",", "")
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _find_col(cols, *keys):
    """Tim ten cot chua tat ca `keys` (khong phan biet hoa/thuong)."""
    for c in cols:
        cu = c.upper()
        if all(k in cu for k in keys):
            return c
    return None


def load_mba() -> dict:
    """{norm_code: {RAW_CODE, SDM_KVA, P0_KW, PK_KW}} tu mba_info.csv (nhap tay).

    Ho tro linh hoat:
      - Phan cach ';' (Excel vi-VN) hoac ','.
      - Ten cot linh hoat: CODE (TBA/CODE), SDM (Sdm(kVA)/SDM_KVA),
        P0 (DEP0(W)/P0_W/P0_KW), PK (DEPK(W)/PK_W/PK_KW).
      - Don vi W -> tu dong /1000 ra kW (dua vao ten cot co 'W' ma khong co 'KW').
      - So kieu vi-VN khi dung ';' (',' = thap phan).
      - O TRONG P0/PK => tram khong hoat dong -> BO QUA.
    Key theo CODE chuan hoa de so khop voi metterinfo.
    """
    if not os.path.isfile(MBA_PATH):
        sys.exit(f"Khong tim thay {MBA_PATH}. Hay tao va nhap thong so MBA.")
    with open(MBA_PATH, encoding="utf-8-sig") as f:
        text = f.read()
    header = text.splitlines()[0] if text.strip() else ""
    delim = ";" if ";" in header else ","
    vi = (delim == ";")

    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    cols = [c.strip() for c in (reader.fieldnames or [])]
    code_col = _find_col(cols, "CODE") or _find_col(cols, "TBA") or (cols[0] if cols else "")
    sdm_col = _find_col(cols, "SDM") or _find_col(cols, "KVA")
    p0_col = _find_col(cols, "P0")
    pk_col = _find_col(cols, "PK")
    if not (code_col and sdm_col and p0_col and pk_col):
        sys.exit(f"mba_info.csv thieu cot (CODE/SDM/P0/PK). Header: {cols}")
    # Don vi: co 'W' nhung khong co 'KW' -> watt
    p0u = p0_col.upper()
    to_kw = 1000.0 if ("W" in p0u and "KW" not in p0u) else 1.0

    mba = {}
    inactive = 0
    for row in reader:
        row = {(k or "").strip(): v for k, v in row.items()}
        code = str(row.get(code_col) or "").strip()
        if not code or code.startswith("#"):
            continue
        p0 = _parse_num(row.get(p0_col), vi)
        pk = _parse_num(row.get(pk_col), vi)
        if p0 is None or pk is None:      # o trong -> tram khong hoat dong
            inactive += 1
            continue
        sdm = _parse_num(row.get(sdm_col), vi)
        if not sdm or sdm <= 0:
            print(f"[WARN] Tram {code}: SDM khong hop le ({row.get(sdm_col)!r}) -> bo qua.")
            continue
        mba[_norm_code(code)] = {
            "RAW_CODE": code,
            "SDM_KVA": sdm,
            "P0_KW": p0 / to_kw,
            "PK_KW": pk / to_kw,
        }
    if inactive:
        print(f"Bo qua {inactive} tram khong co P0/PK (khong hoat dong).")
    return mba


def resolve_params(code: str, mba: dict):
    """Khop CODE metterinfo voi mba: chuan hoa chinh xac, roi tien to
    (mba viet gon la tien to cua CODE metterinfo, vd bo hau to 'XLNT')."""
    n = _norm_code(code)
    if n in mba:
        return mba[n]
    cands = [k for k in mba if n.startswith(k) or k.startswith(n)]
    if cands:
        return mba[max(cands, key=len)]  # khop dai nhat cho chac
    return None


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


def build_rows(agg: dict, params_by_code: dict, code2line: dict) -> list:
    rows = []
    for (code, dt), slot in agg.items():
        m = params_by_code[code]
        sdm, p0, pk = m["SDM_KVA"], m["P0_KW"], m["PK_KW"]
        p, q = slot["P"], slot["Q"]
        s = math.sqrt(p * p + q * q)
        load = s / sdm if sdm else 0.0
        loss_noload = p0 * 0.5
        loss_load = pk * load * load * 0.5
        delta_p = p0 + pk * load * load
        rows.append({
            "CODE": code,
            "LINE_NAME": code2line.get(code, m.get("RAW_CODE", code)),
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
    meter2code, code2line = load_main_meters()
    mba = load_mba()
    # Khop tung CODE metterinfo (co cong to chinh) voi thong so MBA
    params_by_code = {}
    for code in set(meter2code.values()):
        p = resolve_params(code, mba)
        if p:
            params_by_code[code] = p
    codes = set(params_by_code.keys())
    print(f"Ngay {day}: {len(meter2code)} cong to chinh, {len(mba)} tram co thong so MBA, "
          f"{len(codes)} tram se tinh ton that.")
    if not codes:
        print("Khong co tram nao du dieu kien (can ca cong to chinh lan thong so MBA). Bo qua.")
        return

    agg = accumulate(day, meter2code, codes)
    if not agg:
        print(f"Khong co du lieu datametter cho ngay {day}. Bo qua.")
        return
    new_rows = build_rows(agg, params_by_code, code2line)
    total = write_out(new_rows)
    print(f"Ghi {len(new_rows)} moc 30 phut (ngay {day}). Tong file: {total} dong -> {OUT_PATH}")


if __name__ == "__main__":
    main()

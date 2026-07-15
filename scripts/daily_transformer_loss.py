#!/usr/bin/env python3
"""Tinh ton that ky thuat may bien ap (theo TRAM) o do phan giai 30 phut cho ngay
hom qua, luu vao public/transformer_loss_30min.csv.

Mo hinh:
  - 1 tram (CODE) = 1 MBA. Tram gom cac cong to CHINH (ROLE=chinh).
  - Timeline HOP NHAT theo tram: gop moc thoi gian cua MOI cong to chinh, forward-fill
    gia tri (P,Q) cua tung cong to -> cong lai = phu tai MBA tai tung moc.
  - Khoang thoi gian dt = HIEU DATE_TIME giua 2 moc lien tiep (khong co dinh 0.5h),
    chan tren DT_MAX_H de tranh khoang trong lon; moc cuoi dung DT_NOMINAL_H.
  - CHI tinh khi con dien: cong to co dien ap pha U>0. U=0 (mat dien) -> bo qua.
    Neu ca tram khong con cong to nao U>0 tai moc do -> khong tinh ton that (0).
  - Cong thuc: S = sqrt(P^2 + Q^2); tai = S/Sdm; dP = P0 + Pk*(S/Sdm)^2 (kW).
    LOSS_NOLOAD = P0*dt; LOSS_LOAD = Pk*tai^2*dt; LOSS = dP*dt (tich phan 30 phut).
  - Tram nhieu cong to lech gio: van cong san luong; thoi gian trai tu min->max moc.

Xuat 2 file:
  - transformer_loss_30min.csv : moc 30 phut (OUTPUT=P*dt) -> ve BIEU DO trong ngay.
  - transformer_loss_daily.csv : mot dong/tram/ngay. OUTPUT lay theo HIEU CHI SO cong to
    x HSN tu hes_index_daily.csv (chinh xac); LOSS van tich phan dP. Day la nguon SO LIEU
    bao cao (bang ngay/thang, %TT). Thieu chi so ngay do -> fallback OUTPUT=Sum(P*dt).

Nguon du lieu:
  - metterinfo.csv : CODE, ROLE, STATUS cho tung cong to (do fetch_meter_info.py sinh).
  - mba_info.csv   : thong so nhan MBA theo CODE (nhap tay).
  - datametter.csv : TOTAL_KW, TOTAL_KVAR DA nhan HSN (do fetch_meter_data.py sinh) ->
                     KHONG nhan lai HSN o day.

Khu trung theo khoa (CODE, DATE_TIME) nen chay lai an toan. Prune giu KEEP_DAYS ngay
gan nhat. KHONG tu commit (daily-pipeline.yml commit chung).
"""
import bisect
import csv
import io
import math
import os
import re
import sys
from datetime import datetime, timedelta, timezone

VN_TZ = timezone(timedelta(hours=7))
REC_FMT = "%Y-%m-%d %H:%M:%S"
DT_MAX_H = float(os.environ.get("DT_MAX_H", "1.0"))       # chan tren dt (gio) khi co khoang trong
DT_NOMINAL_H = float(os.environ.get("DT_NOMINAL_H", "0.5"))  # dt cho moc ghi cuoi cung

METTERINFO_PATH = os.environ.get("METTERINFO_PATH", "public/metterinfo.csv")
MBA_PATH = os.environ.get("MBA_PATH", "public/mba_info.csv")
DATAMETTER_PATH = os.environ.get("DATAMETTER_PATH", "public/datametter.csv")
HES_INDEX_PATH = os.environ.get("HES_INDEX_PATH", "public/hes_index_daily.csv")
OUT_PATH = "public/transformer_loss_30min.csv"
DAILY_OUT_PATH = "public/transformer_loss_daily.csv"

KEEP_DAYS = int(os.environ.get("KEEP_DAYS", "40"))  # giu 40 ngay gan nhat/tram (file 30 phut)
DAILY_KEEP_DAYS = int(os.environ.get("DAILY_KEEP_DAYS", "0"))  # 0 = giu toan bo (file ngay nho)

OUT_FIELDS = ["CODE", "LINE_NAME", "DATE_TIME", "DUR_H", "N_METERS", "P_KW", "Q_KVAR",
              "S_KVA", "LOAD_PCT", "DELTA_P_KW", "OUTPUT_KWH", "LOSS_NOLOAD_KWH",
              "LOSS_LOAD_KWH", "LOSS_KWH"]

# File NGAY: san luong OUTPUT lay theo hieu chi so cong to x HSN (chinh xac);
# ton that van tich phan dP ca ngay tu du lieu 30 phut.
DAILY_OUT_FIELDS = ["CODE", "LINE_NAME", "DATE", "OUTPUT_KWH", "LOSS_NOLOAD_KWH",
                    "LOSS_LOAD_KWH", "LOSS_KWH", "LOSS_PCT", "MAX_LOAD_PCT",
                    "AVG_LOAD_PCT", "N_INTERVALS", "OUTPUT_SRC"]


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


def _parse_dt(s: str):
    try:
        return datetime.strptime(str(s or "").strip(), REC_FMT)
    except (TypeError, ValueError):
        return None


def read_station_records(day: str, meter2code: dict, valid_codes: set) -> dict:
    """Doc datametter.csv -> {code: {meter: [(t, P, Q, on) da sap xep theo t]}}.
    `on` = con dien (max U pha > 0). Chi lay cong to chinh thuoc valid_codes."""
    if not os.path.isfile(DATAMETTER_PATH):
        sys.exit(f"Khong tim thay {DATAMETTER_PATH}.")
    by_code = {}
    with open(DATAMETTER_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            dts = str(row.get("DATE_TIME") or "").strip()
            if dts[:10] != day:
                continue
            no = str(row.get("METER_NO") or "").strip()
            code = meter2code.get(no)
            if not code or code not in valid_codes:
                continue
            t = _parse_dt(dts)
            if t is None:
                continue
            u = max(_to_float(row.get("PHASE_A_VOLTS")),
                    _to_float(row.get("PHASE_B_VOLTS")),
                    _to_float(row.get("PHASE_C_VOLTS")))
            by_code.setdefault(code, {}).setdefault(no, []).append(
                (t, _to_float(row.get("TOTAL_KW")), _to_float(row.get("TOTAL_KVAR")), u > 0))
    for meters in by_code.values():
        for lst in meters.values():
            lst.sort(key=lambda r: r[0])
    return by_code


def station_intervals(recs_by_meter: dict):
    """Sinh (t0, dt_h, P, Q, n) tren timeline HOP NHAT cua cac cong to trong tram.
    dt = hieu DATE_TIME hai moc lien tiep (chan tren DT_MAX_H); moc cuoi = DT_NOMINAL_H.
    Tai moc t0: forward-fill gia tri gan nhat <= t0 cua tung cong to, chi cong khi con
    dien (on) va con moi (khong qua han DT_MAX_H). n=0 (mat dien ca tram) -> bo qua."""
    times = sorted({r[0] for lst in recs_by_meter.values() for r in lst})
    if not times:
        return
    meter_times = {m: [r[0] for r in lst] for m, lst in recs_by_meter.items()}
    for k, t0 in enumerate(times):
        dt = (times[k + 1] - t0).total_seconds() / 3600.0 if k + 1 < len(times) else DT_NOMINAL_H
        if dt <= 0:
            continue
        dt = min(dt, DT_MAX_H)
        p = q = 0.0
        n = 0
        for m, lst in recs_by_meter.items():
            i = bisect.bisect_right(meter_times[m], t0) - 1
            if i < 0:
                continue
            rt, rp, rq, on = lst[i]
            if not on:
                continue
            if (t0 - rt).total_seconds() / 3600.0 > DT_MAX_H:  # qua han -> coi nhu chua co du lieu
                continue
            p += rp
            q += rq
            n += 1
        if n == 0:   # ca tram mat dien tai moc nay
            continue
        yield t0, dt, p, q, n


def build_rows(day: str, by_code: dict, params_by_code: dict, code2line: dict) -> list:
    rows = []
    for code, recs_by_meter in by_code.items():
        m = params_by_code[code]
        sdm, p0, pk = m["SDM_KVA"], m["P0_KW"], m["PK_KW"]
        for t0, dt, p, q, n in station_intervals(recs_by_meter):
            s = math.sqrt(p * p + q * q)
            load = s / sdm if sdm else 0.0
            loss_noload = p0 * dt
            loss_load = pk * load * load * dt
            rows.append({
                "CODE": code,
                "LINE_NAME": code2line.get(code, m.get("RAW_CODE", code)),
                "DATE_TIME": t0.strftime(REC_FMT),
                "DUR_H": f"{dt:g}",
                "N_METERS": n,
                "P_KW": f"{p:g}",
                "Q_KVAR": f"{q:g}",
                "S_KVA": f"{s:g}",
                "LOAD_PCT": f"{load * 100:g}",
                "DELTA_P_KW": f"{p0 + pk * load * load:g}",
                "OUTPUT_KWH": f"{p * dt:g}",
                "LOSS_NOLOAD_KWH": f"{loss_noload:g}",
                "LOSS_LOAD_KWH": f"{loss_load:g}",
                "LOSS_KWH": f"{loss_noload + loss_load:g}",
            })
    return rows


def load_daily_output(day: str, meter2code: dict, valid_codes: set) -> dict:
    """San luong ngay theo TRAM = tong (PG_END - PG_START) * HSN cua cac cong to CHINH.

    Doc hes_index_daily.csv (PG = huu cong tong, raw). Chi cong cong to chinh thuoc
    valid_codes. Bo qua cong to bi reset/thay (PG_END < PG_START). Tra ve
    {code: output_kwh} chi gom cac tram co it nhat 1 cong to co chi so hop le."""
    if not os.path.isfile(HES_INDEX_PATH):
        print(f"[WARN] Khong tim thay {HES_INDEX_PATH} -> OUTPUT se fallback P*dt.")
        return {}
    out = {}
    with open(HES_INDEX_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if str(row.get("DATE") or "").strip() != day:
                continue
            no = str(row.get("METER_NO") or "").strip()
            code = meter2code.get(no)
            if not code or code not in valid_codes:
                continue
            hsn = _to_float(row.get("HSN")) or 1.0
            pg0 = _to_float(row.get("PG_START"))
            pg1 = _to_float(row.get("PG_END"))
            diff = pg1 - pg0
            if diff < 0:  # cong to reset/thay trong ngay -> khong tin cay
                print(f"  [skip idx] {no} ({code}): PG_END<PG_START ({pg1}<{pg0}).")
                continue
            out[code] = out.get(code, 0.0) + diff * hsn
    return out


def build_daily_rows(day: str, by_code: dict, params_by_code: dict,
                     code2line: dict, output_by_code: dict) -> list:
    """Gom moi tram ve 1 dong/ngay: OUTPUT theo chi so (fallback Sum P*dt), LOSS tich phan dP."""
    rows = []
    for code, recs_by_meter in by_code.items():
        m = params_by_code[code]
        sdm, p0, pk = m["SDM_KVA"], m["P0_KW"], m["PK_KW"]
        loss_noload = loss_load = out_pxdt = load_sum = load_max = 0.0
        n = 0
        for t0, dt, p, q, cnt in station_intervals(recs_by_meter):
            s = math.sqrt(p * p + q * q)
            load = s / sdm if sdm else 0.0
            loss_noload += p0 * dt
            loss_load += pk * load * load * dt
            out_pxdt += p * dt
            load_sum += load
            load_max = max(load_max, load)
            n += 1
        if n == 0:
            continue
        loss = loss_noload + loss_load
        reg = output_by_code.get(code)
        if reg is not None:
            output, src = reg, "index"
        else:
            output, src = out_pxdt, "pxdt"
        denom = output + loss
        rows.append({
            "CODE": code,
            "LINE_NAME": code2line.get(code, m.get("RAW_CODE", code)),
            "DATE": day,
            "OUTPUT_KWH": f"{output:g}",
            "LOSS_NOLOAD_KWH": f"{loss_noload:g}",
            "LOSS_LOAD_KWH": f"{loss_load:g}",
            "LOSS_KWH": f"{loss:g}",
            "LOSS_PCT": f"{(loss / denom * 100) if denom > 0 else 0:g}",
            "MAX_LOAD_PCT": f"{load_max * 100:g}",
            "AVG_LOAD_PCT": f"{(load_sum / n * 100):g}",
            "N_INTERVALS": n,
            "OUTPUT_SRC": src,
        })
    return rows


def write_daily_pb(daily_rows: list):
    """Dual-write: upsert cac dong ngay vao collection PocketBase `tloss_daily`.

    Bat/tat bang env WRITE_PB (mac dinh "1"). Bo qua neu thieu PB_URL/creds.
    KHONG anh huong luong CSV: chi la ghi song song de chuyen dan sang PB.
    Khoa duy nhat (code, date) -> chay lai chi update.
    """
    if os.environ.get("WRITE_PB", "1") == "0":
        return
    if not os.environ.get("PB_URL"):
        print("[PB] Bo qua ghi PB: thieu PB_URL.")
        return
    try:
        from pb_client import PBClient, PBError
    except ImportError as e:
        print(f"[PB] Khong import duoc pb_client: {e}")
        return

    def num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    rows = [{
        "code": r["CODE"],
        "line_name": r.get("LINE_NAME", ""),
        "date": r["DATE"],
        "output_kwh": num(r.get("OUTPUT_KWH")),
        "loss_noload_kwh": num(r.get("LOSS_NOLOAD_KWH")),
        "loss_load_kwh": num(r.get("LOSS_LOAD_KWH")),
        "loss_kwh": num(r.get("LOSS_KWH")),
        "loss_pct": num(r.get("LOSS_PCT")),
        "max_load_pct": num(r.get("MAX_LOAD_PCT")),
        "avg_load_pct": num(r.get("AVG_LOAD_PCT")),
        "n_intervals": int(num(r.get("N_INTERVALS"))),
        "output_src": r.get("OUTPUT_SRC", ""),
    } for r in daily_rows]
    try:
        created, updated = PBClient().upsert_batch("tloss_daily", rows, ("code", "date"))
        print(f"[PB] tloss_daily: upsert {len(rows)} dong ({created} moi, {updated} cap nhat).")
    except PBError as e:
        print(f"[PB][WARN] Ghi tloss_daily that bai (khong chan pipeline CSV): {e}")


def write_daily_out(new_rows: list):
    merged = {}
    if os.path.isfile(DAILY_OUT_PATH):
        with open(DAILY_OUT_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                merged[(row.get("CODE", ""), row.get("DATE", ""))] = row
    for row in new_rows:
        merged[(row["CODE"], row["DATE"])] = row

    rows = list(merged.values())
    if DAILY_KEEP_DAYS > 0:
        cutoff = (datetime.now(VN_TZ).date() - timedelta(days=DAILY_KEEP_DAYS)).isoformat()
        rows = [r for r in rows if str(r.get("DATE", "")) >= cutoff]
    rows.sort(key=lambda r: (r.get("DATE", ""), r.get("CODE", "")))

    os.makedirs(os.path.dirname(DAILY_OUT_PATH), exist_ok=True)
    with open(DAILY_OUT_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=DAILY_OUT_FIELDS)
        w.writeheader()
        w.writerows(rows)
    return len(rows)


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

    by_code = read_station_records(day, meter2code, codes)
    if not by_code:
        print(f"Khong co du lieu datametter cho ngay {day}. Bo qua.")
        return
    new_rows = build_rows(day, by_code, params_by_code, code2line)
    total = write_out(new_rows)
    print(f"Ghi {len(new_rows)} moc 30 phut (ngay {day}). Tong file: {total} dong -> {OUT_PATH}")

    # File NGAY: OUTPUT theo hieu chi so x HSN (chinh xac), LOSS tich phan dP.
    output_by_code = load_daily_output(day, meter2code, codes)
    daily_rows = build_daily_rows(day, by_code, params_by_code, code2line, output_by_code)
    n_idx = sum(1 for r in daily_rows if r["OUTPUT_SRC"] == "index")
    d_total = write_daily_out(daily_rows)
    print(f"Ghi {len(daily_rows)} tram/ngay ({n_idx} theo chi so, {len(daily_rows) - n_idx} fallback P*dt). "
          f"Tong file ngay: {d_total} dong -> {DAILY_OUT_PATH}")

    # Dual-write sang PocketBase (song song, khong anh huong CSV) — Task 0 migration.
    write_daily_pb(daily_rows)


if __name__ == "__main__":
    main()

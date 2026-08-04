"""Task 3 (plan 2026-08-03-mo-hinh-danh-muc-va-kho-vat-tu.md):
seed dm_zone -> dm_station -> dm_customer -> dm_point.

Nguon:
  public/metterinfo.csv  : CODE (tram), LINE_ID/LINE_NAME (diem do), ROLE, STATUS
  public/mba_info.csv    : Sdm/P0/PK theo tram (dau ';', so thap phan dung dau phay)
  collection invoice     : MKHang / NMua / DChiNMua / HSN  -> khach hang + HSN doi chung

Cach dung:
  python scripts/seed_catalog.py --dry-run     # chi in, khong ghi
  python scripts/seed_catalog.py               # ghi that (idempotent: da co thi bo qua)

3 LINE_ID gia 809/810/857 la KHO cong to da thao, KHONG phai diem do
-> loai khoi dm_point, se tao thanh vt_warehouse o task 6.
"""

import argparse
import csv
import os
import re
import sys
from collections import defaultdict

import requests

import pb_client as pb

METTERINFO = os.environ.get("METTERINFO_PATH", "public/metterinfo.csv")
MBA_INFO = os.environ.get("MBA_PATH", "public/mba_info.csv")

# Giong PREFIX_ZONE trong src/lib/invoices.ts - phai khop, neu khong UI va
# du lieu se hieu khac nhau ve cung mot tram.
PREFIX_ZONE = {"TH": "KCNTH", "PD": "KCNPĐ", "03": "KCN03", "YM": "KCNYM", "TTI": "KCNTTI"}

ZONES = [
    {"code": "KCNTH", "name": "KCN Tiền Hải", "area_label": "KCN Tiền Hải"},
    {"code": "KCNPĐ", "name": "KCN Phong Điền", "area_label": "KCN Phong Điền"},
    {"code": "KCNTTI", "name": "KCN Thuận Thành I", "area_label": "KCN Thuận Thành I"},
    {"code": "KCNYM", "name": "KCN Yên Mỹ", "area_label": "KCN Yên Mỹ"},
    {"code": "KCN03", "name": "KCN Số 3", "area_label": "KCN Số 3"},
]

# LINE_ID gia = kho cong to da thao (xem plan muc 2)
WAREHOUSE_LINE_IDS = {"809", "810", "857"}

# BEN BAN, khong phai khach hang. Lot vao danh muc vi gan voi cong to o
# TTI.DIEMDOPHU trong metterinfo.csv (user chot loai 03/08).
SELLER_MKH = {"GETC"}


def zone_of_code(code: str) -> str:
    pre = (code.split(".")[0] or "").strip().upper().replace("Đ", "D")
    return PREFIX_ZONE.get(pre, "")


def zone_of_mkh(mkh: str) -> str:
    """KCNTH-001 -> KCNTH. Khong doan neu khong khop 5 ma da biet."""
    pre = (mkh.split("-")[0] or "").strip().upper()
    known = {z["code"].upper().replace("Đ", "D"): z["code"] for z in ZONES}
    return known.get(pre.replace("Đ", "D"), "")


def read_meterinfo() -> list:
    with open(METTERINFO, encoding="utf-8-sig", newline="") as f:
        return [ {k: (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f) ]


def _norm_code(s) -> str:
    """Chuan hoa CODE de so khop: bo khoang trang, viet hoa.
    GIONG HET daily_transformer_loss.py::_norm_code - phai khop, neu khong
    hai noi se hieu khac nhau ve cung mot tram."""
    return re.sub(r"\s+", "", str(s or "").strip().upper())


def resolve_mba(code: str, mba: dict):
    """Khop CODE cua HES voi mba_info: chuan hoa truoc, roi khop tien to.

    Copy logic tu daily_transformer_loss.py::resolve_params. Can thiet vi ten
    tram o HES va o mba_info.csv lech nhau 2 kieu (da gap that):
      - khoang trang : '03.TMD.3000kVA'  vs '03.TMD.3000 KVA'
      - hau to       : 'TTI.BQL.T1.630kVA XLNT' vs 'TTI.BQL.T1.630KVA'
    Khop chinh xac tuyet doi se bao 'thieu thong so MBA' mot cach sai lam.
    """
    n = _norm_code(code)
    if n in mba:
        return mba[n]
    cands = [k for k in mba if n.startswith(k) or k.startswith(n)]
    if cands:
        return mba[max(cands, key=len)]   # khop dai nhat cho chac
    return None


def read_mba() -> dict:
    """{code_chuan: {sdm_kva, p0_kw, pk_kw}}. File dung ';' va dau phay thap phan.
    P0/PK trong file don vi W -> chia 1000 ra kW (giong daily_transformer_loss.py)."""
    out = {}
    if not os.path.exists(MBA_INFO):
        print(f"  [WARN] khong thay {MBA_INFO} - tram se khong co thong so MBA")
        return out
    with open(MBA_INFO, encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f, delimiter=";"):
            if not row or len(row) < 4:
                continue
            code = (row[0] or "").strip()
            if not code or code.upper() == "TBA":
                continue

            def num(v):
                v = (v or "").strip().replace(",", ".")
                try:
                    return float(v)
                except ValueError:
                    return None

            sdm, p0, pk = num(row[1]), num(row[2]), num(row[3])
            out[_norm_code(code)] = {
                "sdm_kva": sdm,
                "p0_kw": (p0 / 1000) if p0 is not None else None,
                "pk_kw": (pk / 1000) if pk is not None else None,
            }
    return out


def load_invoice_customers(token: str) -> dict:
    """{mkh: {name, address, }} tu toan bo invoice. Lay ban ghi MOI NHAT theo EndDate
    vi ten/dia chi khach co the doi. Luon tin invoice (chot 27/07)."""
    best = {}
    page = 1
    while True:
        r = pb.req("GET",
            f"{pb.PB_URL}/api/collections/invoice/records",
            params={"page": page, "perPage": 500, "fields": "MKHang,NMua,DChiNMua,EndDate,SCT,HSN"},
            headers=pb.headers(token), timeout=pb.TIMEOUT,
        )
        r.raise_for_status()
        d = r.json()
        for it in d["items"]:
            mkh = (it.get("MKHang") or "").strip()
            if not mkh:
                continue
            end = it.get("EndDate") or ""
            cur = best.get(mkh)
            if cur is None or end > cur["_end"]:
                best[mkh] = {
                    "mkh": mkh,
                    "name": (it.get("NMua") or "").strip(),
                    "address": (it.get("DChiNMua") or "").strip(),
                    "_end": end,
                }
        if page >= d.get("totalPages", 1):
            break
        page += 1
    return best


def load_invoice_hsn(token: str) -> dict:
    """{SCT: HSN moi nhat} - dung lam hsn_invoice cua diem do (doi chung voi hsn_calc)."""
    best = {}
    page = 1
    while True:
        r = pb.req("GET",
            f"{pb.PB_URL}/api/collections/invoice/records",
            params={"page": page, "perPage": 500, "fields": "SCT,HSN,EndDate"},
            headers=pb.headers(token), timeout=pb.TIMEOUT,
        )
        r.raise_for_status()
        d = r.json()
        for it in d["items"]:
            sct = (it.get("SCT") or "").strip()
            if not sct:
                continue
            end = it.get("EndDate") or ""
            cur = best.get(sct)
            if cur is None or end > cur[1]:
                best[sct] = (it.get("HSN"), end)
        if page >= d.get("totalPages", 1):
            break
        page += 1
    return {k: v[0] for k, v in best.items()}


def build(token: str):
    rows = read_meterinfo()
    mba = read_mba()
    warns = []

    # ---- dm_station: tu CODE (bo rong) ----
    stations = {}
    for r in rows:
        code = r.get("CODE", "")
        if not code:
            continue
        if code not in stations:
            z = zone_of_code(code)
            if not z:
                warns.append(f"Tram '{code}': khong suy duoc KCN tu tien to")
            m = resolve_mba(code, mba) or {}
            stations[code] = {
                "code": code, "name": code, "zone": z,
                "sdm_kva": m.get("sdm_kva"), "p0_kw": m.get("p0_kw"), "pk_kw": m.get("pk_kw"),
            }
    # "thieu" = khong tim duoc dong nao, HOAC tim duoc nhung thieu so
    no_mba = []
    for c in stations:
        m = resolve_mba(c, mba)
        if not m or m.get("sdm_kva") is None or m.get("p0_kw") is None or m.get("pk_kw") is None:
            no_mba.append(c)

    # ---- dm_point: tu LINE_ID/LINE_NAME (bo 3 kho) ----
    # Luot 1: khoa theo LINE_ID
    name_to_lineid = {}
    points = {}
    for r in rows:
        lid, lname = r.get("LINE_ID", ""), r.get("LINE_NAME", "")
        if not lid or lid in WAREHOUSE_LINE_IDS:
            continue
        if lname:
            name_to_lineid.setdefault(lname, lid)
        if lid not in points:
            code = r.get("CODE", "")
            points[lid] = {
                "line_id": lid, "line_name": lname, "station": code,
                "zone": zone_of_code(code) or zone_of_code(lname),
                "role": r.get("ROLE", ""), "point_status": "",
                "_meters": [], "_status": set(),
            }
        points[lid]["_meters"].append(r.get("METER_NO", ""))
        points[lid]["_status"].add(r.get("STATUS", ""))

    # Luot 2: cong to thieu LINE_ID -> khop theo LINE_NAME
    orphans = []
    for r in rows:
        if r.get("LINE_ID", ""):
            continue
        lname = r.get("LINE_NAME", "")
        lid = name_to_lineid.get(lname)
        if lid:
            points[lid]["_meters"].append(r.get("METER_NO", ""))
            points[lid]["_status"].add(r.get("STATUS", ""))
            warns.append(f"Cong to {r.get('METER_NO')} thieu LINE_ID -> khop theo LINE_NAME '{lname}' = diem do {lid}")
        else:
            orphans.append(r)
            warns.append(f"Cong to {r.get('METER_NO')} thieu LINE_ID va khong khop LINE_NAME '{lname}'")

    # Trang thai diem do
    for p in points.values():
        st = p.pop("_status")
        if "Yes" in st:
            p["point_status"] = "active"   # vai tro phu nam o cot `role`, khong nhet vao trang thai
        else:
            p["point_status"] = "dismounted"

    # HSN doi chung: lay HSN hoa don moi nhat cua cac cong to tai diem do
    hsn_by_meter = load_invoice_hsn(token)
    hsn_conflict = []
    for p in points.values():
        vals = {hsn_by_meter.get(m) for m in p["_meters"] if hsn_by_meter.get(m) is not None}
        vals.discard(None)
        if len(vals) == 1:
            p["hsn_invoice"] = vals.pop()
        elif len(vals) > 1:
            p["hsn_invoice"] = None
            hsn_conflict.append((p["line_id"], sorted(vals)))
        else:
            p["hsn_invoice"] = None

    # ---- dm_customer: uu tien invoice, bo sung tu metterinfo ----
    customers = load_invoice_customers(token)
    for m in SELLER_MKH:
        customers.pop(m, None)
    from_csv = 0
    for r in rows:
        mkh = r.get("CUSTOMER_CODE", "")
        if mkh in SELLER_MKH:
            continue
        if mkh and mkh not in customers:
            customers[mkh] = {
                "mkh": mkh, "name": r.get("CUSTOMER_NAME", ""),
                "address": r.get("ADDRESS", ""), "_end": "",
            }
            from_csv += 1
    for c in customers.values():
        c["zone"] = zone_of_mkh(c["mkh"])
    no_zone_cus = [c["mkh"] for c in customers.values() if not c["zone"]]

    return {
        "stations": stations, "points": points, "customers": customers,
        "warns": warns, "no_mba": no_mba, "orphans": orphans,
        "hsn_conflict": hsn_conflict, "cus_from_csv": from_csv,
        "no_zone_cus": no_zone_cus, "rows": rows,
    }


def report(d: dict):
    stations, points, customers = d["stations"], d["points"], d["customers"]
    print()
    print("=== SO LUONG SE TAO ===")
    print(f"  dm_zone      : {len(ZONES)}")
    print(f"  dm_station   : {len(stations)}")
    print(f"  dm_customer  : {len(customers)}  (trong do {d['cus_from_csv']} chi co o metterinfo.csv, khong co hoa don)")
    print(f"  dm_point     : {len(points)}  (da loai 3 kho 809/810/857)")

    print()
    print("=== KIEM CHUNG THEO PLAN ===")
    diff = [p for p in points.values() if p["line_name"] and p["line_name"] != p["station"]]
    print(f"  Diem do co LINE_NAME != CODE : {len(diff)} (plan uoc luong 14)")
    for p in diff[:20]:
        ok = "OK" if p["station"] else "KHONG CO TRAM"
        print(f"      {p['line_id']:>5}  {p['line_name'][:45]:45} -> tram '{p['station']}' {ok}")

    per_station = defaultdict(list)
    for p in points.values():
        if p["station"]:
            per_station[p["station"]].append(p["line_id"])
    multi = {k: v for k, v in per_station.items() if len(v) > 1}
    print(f"  Tram co >1 diem do           : {len(multi)} (plan uoc luong 3)")
    for k, v in multi.items():
        print(f"      {k:35} -> diem do {v}")

    m = [p for p in points.values() if "2410320616" in p["_meters"]]
    print(f"  Cong to 2410320616           : " +
          (f"diem do {m[0]['line_id']} ('{m[0]['line_name']}')" if m else "CHUA GAN DUOC"))

    print()
    print("=== PHAN BO ===")
    by_zone = defaultdict(lambda: [0, 0, 0])
    for s in stations.values():
        by_zone[s["zone"] or "(khong ro)"][0] += 1
    for p in points.values():
        by_zone[p["zone"] or "(khong ro)"][1] += 1
    for c in customers.values():
        by_zone[c["zone"] or "(khong ro)"][2] += 1
    print(f"  {'KCN':12} {'tram':>6} {'diem do':>8} {'khach':>7}")
    for z, (a, b, c) in sorted(by_zone.items()):
        print(f"  {z:12} {a:>6} {b:>8} {c:>7}")

    st_count = defaultdict(int)
    for p in points.values():
        st_count[p["point_status"]] += 1
    print(f"  Trang thai diem do: {dict(st_count)}")

    hsn_have = sum(1 for p in points.values() if p.get("hsn_invoice") is not None)
    print(f"  Diem do co hsn_invoice: {hsn_have}/{len(points)}")

    print()
    print("=== CANH BAO ===")
    print(f"  Tram khong co thong so MBA (Sdm/P0/PK): {len(d['no_mba'])}")
    if d["no_mba"]:
        print(f"      {d['no_mba'][:10]}{' ...' if len(d['no_mba']) > 10 else ''}")
    print(f"  Khach khong suy duoc KCN tu MKH: {len(d['no_zone_cus'])}")
    if d["no_zone_cus"]:
        print(f"      {d['no_zone_cus'][:10]}{' ...' if len(d['no_zone_cus']) > 10 else ''}")
    print(f"  Diem do co NHIEU HSN khac nhau giua cac cong to: {len(d['hsn_conflict'])}")
    for lid, vals in d["hsn_conflict"][:10]:
        print(f"      diem do {lid}: HSN {vals}")
    print(f"  Cong to mo coi (khong gan duoc diem do): {len(d['orphans'])}")
    for r in d["orphans"]:
        print(f"      {r.get('METER_NO')} LINE_NAME='{r.get('LINE_NAME')}'")
    print()
    print(f"  Tong canh bao khac: {len(d['warns'])}")
    for w in d["warns"][:15]:
        print(f"      - {w}")
    if len(d["warns"]) > 15:
        print(f"      ... con {len(d['warns']) - 15} dong")


def existing_by(token: str, coll: str, key: str) -> dict:
    """{gia_tri_khoa: record_id} cua toan bo collection - de ghi idempotent."""
    out = {}
    page = 1
    while True:
        r = pb.req("GET",
            f"{pb.PB_URL}/api/collections/{coll}/records",
            params={"page": page, "perPage": 500, "fields": f"id,{key}"},
            headers=pb.headers(token), timeout=pb.TIMEOUT,
        )
        r.raise_for_status()
        d = r.json()
        for it in d["items"]:
            out[str(it.get(key, ""))] = it["id"]
        if page >= d.get("totalPages", 1):
            break
        page += 1
    return out


def create(token: str, coll: str, body: dict) -> str:
    r = pb.req("POST",
        f"{pb.PB_URL}/api/collections/{coll}/records",
        json=body, headers=pb.headers(token), timeout=pb.TIMEOUT,
    )
    if not r.ok:
        sys.exit(f"Tao record trong '{coll}' that bai: HTTP {r.status_code}\n{body}\n{r.text[:500]}")
    return r.json()["id"]


def seed_one(token: str, coll: str, key: str, items: list, label: str) -> dict:
    """Tao cac record chua co. Tra ve {khoa: id} DAY DU (ca cu lan moi)."""
    ids = existing_by(token, coll, key)
    made = 0
    for it in items:
        k = str(it[key])
        if k in ids:
            continue
        ids[k] = create(token, coll, it)
        made += 1
        if made % 20 == 0:
            print(f"    ... {made}")
    print(f"  {label:14} tao moi {made:>4}  |  da co san {len(ids) - made:>4}  |  tong {len(ids):>4}")
    return ids


def update_station_mba(token: str, d: dict, dry_run: bool = False):
    """Vá thông số MBA cho trạm ĐÃ TỒN TẠI (seed_one chỉ tạo mới, không sửa).

    Can thiet sau khi sua cach khop ten (exact -> tien to): 4 tram truoc do bi
    ghi thieu Sdm/P0/Pk mac du mba_info.csv co san so.
    """
    ids = existing_by(token, "dm_station", "code")
    r = pb.req("GET",
        f"{pb.PB_URL}/api/collections/dm_station/records",
        params={"perPage": 500, "fields": "id,code,sdm_kva,p0_kw,pk_kw"},
        headers=pb.headers(token), timeout=pb.TIMEOUT,
    )
    cur = {it["code"]: it for it in r.json()["items"]}

    patched = []
    for code, s in d["stations"].items():
        old = cur.get(code)
        if not old:
            continue
        body = {}
        for k in ("sdm_kva", "p0_kw", "pk_kw"):
            want = s.get(k)
            if want is None:
                continue
            if abs(float(old.get(k) or 0) - float(want)) > 1e-9:
                body[k] = want
        if not body:
            continue
        patched.append((code, body))
        if dry_run:
            continue
        rr = pb.req("PATCH",
            f"{pb.PB_URL}/api/collections/dm_station/records/{ids[code]}",
            json=body, headers=pb.headers(token), timeout=pb.TIMEOUT,
        )
        if not rr.ok:
            sys.exit(f"Cap nhat tram '{code}' that bai: HTTP {rr.status_code}\n{rr.text[:400]}")

    print(f"  {'cap nhat MBA':14} {'(dry-run) ' if dry_run else ''}{len(patched)} tram")
    for code, body in patched:
        print(f"      {code:34} {body}")
    return patched


def write(token: str, d: dict):
    print()
    print("=== GHI THAT LEN POCKETBASE ===")

    zone_ids = seed_one(token, "dm_zone", "code", ZONES, "dm_zone")

    stations = [
        {k: v for k, v in dict(s, zone=zone_ids.get(s["zone"], "")).items() if v not in (None, "")}
        for s in d["stations"].values()
    ]
    station_ids = seed_one(token, "dm_station", "code", stations, "dm_station")

    customers = []
    for c in d["customers"].values():
        customers.append({
            "mkh": c["mkh"], "name": c["name"], "address": c.get("address", ""),
            "zone": zone_ids.get(c.get("zone", ""), ""), "active": True,
        })
    seed_one(token, "dm_customer", "mkh", customers, "dm_customer")

    points = []
    for p in d["points"].values():
        body = {
            "line_id": p["line_id"], "line_name": p["line_name"],
            "station": station_ids.get(p["station"], ""),
            "zone": zone_ids.get(p["zone"], ""),
            "role": p["role"], "point_status": p["point_status"],
        }
        if p.get("hsn_invoice") is not None:
            body["hsn_invoice"] = p["hsn_invoice"]
        points.append({k: v for k, v in body.items() if v != ""} | {"line_id": p["line_id"]})
    seed_one(token, "dm_point", "line_id", points, "dm_point")

    update_station_mba(token, d)


def verify(token: str, d: dict):
    """Doc lai tu API - khong tin ket qua buoc ghi."""
    print()
    print("=== KIEM CHUNG (doc lai tu API) ===")
    want = {
        "dm_zone": len(ZONES), "dm_station": len(d["stations"]),
        "dm_customer": len(d["customers"]), "dm_point": len(d["points"]),
    }
    ok = True
    for coll, n in want.items():
        got = pb.count_records(token, coll)
        mark = "OK" if got == n else "LECH"
        if got != n:
            ok = False
        print(f"  {coll:14} mong doi {n:>4}  thuc te {got:>4}  {mark}")

    # Diem do phai tro dung tram: kiem tra 3 tram nhieu diem do
    r = pb.req("GET",
        f"{pb.PB_URL}/api/collections/dm_point/records",
        params={"perPage": 500, "expand": "station,zone", "fields": "line_id,line_name,expand.station.code,expand.zone.code"},
        headers=pb.headers(token), timeout=pb.TIMEOUT,
    )
    items = r.json()["items"]
    per = defaultdict(list)
    nost = 0
    for it in items:
        st = (it.get("expand") or {}).get("station") or {}
        if st.get("code"):
            per[st["code"]].append(it["line_id"])
        else:
            nost += 1
    multi = {k: v for k, v in per.items() if len(v) > 1}
    print(f"  Tram co >1 diem do: {len(multi)} (mong doi 3)")
    for k, v in multi.items():
        print(f"      {k:35} -> {v}")
    print(f"  Diem do chua gan tram: {nost} (mong doi 28 - diem do phu, gan tay tren UI)")
    if len(multi) != 3 or nost != 28:
        ok = False

    print()
    print("KET QUA: " + ("dung het" if ok else "CO LECH - xem dong tren"))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Chi in, khong ghi len PocketBase")
    args = ap.parse_args()

    token = pb.login()
    print(f"Da dang nhap {pb.PB_URL}")
    d = build(token)
    report(d)

    if args.dry_run:
        print()
        print("DRY-RUN: khong ghi gi len PocketBase.")
        return

    write(token, d)
    verify(token, d)


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""Kiem tra rang buoc danh muc + kho vat tu (task 9, plan §1.6).

CANH BAO chu KHONG chan cung: PocketBase khong rang buoc duoc so luong
relation, nen dung script soat dinh ky thay vi chan luc ghi.

Chay:
    PB_EMAIL=... PB_PASS=... python scripts/validate_catalog.py
    ... --json out.json      # xuat de UI doc
    ... --only 1,2,4         # chi chay mot so kiem tra

Ma thoat: 0 = khong co LOI (canh bao van co the co), 1 = co LOI.
"""
import argparse
import datetime as _dt
import json
import sys
from collections import defaultdict

import pb_client as pb

METER_TYPES = {"ME41", "ME42", "DTS27"}
RATIO_TYPES = {"TI", "TU"}
NO_CALIBRATION = {"GP03", "SIM"}

LOI, CANH_BAO = "LOI", "CANH_BAO"


def _fetch_all(token):
    """Doc mot lan tat ca collection can dung."""
    out = {}
    for name in ("dm_zone", "dm_station", "dm_point", "vt_asset",
                 "vt_install", "vt_warehouse"):
        out[name] = pb.list_records(token, name)
    return out


def _hsn_of_point(point_id, assets_by_id, installs_by_point):
    """HSN suy tu TI/TU dang treo.

    PHAI KHOP voi src/lib/hsn.ts: mot BO ba pha chi tinh MOT lan. Ba TI giong
    het nhau (moi pha mot cai) la MOT lan bien doi, nhan ca ba se ra 500^3.
    """
    by_type = defaultdict(set)
    for inst in installs_by_point.get(point_id, []):
        a = assets_by_id.get(inst.get("asset"))
        if not a or a.get("type") not in RATIO_TYPES:
            continue
        r = a.get("ratio")
        if isinstance(r, (int, float)) and r > 0:
            by_type[a["type"]].add(float(r))

    if not by_type:
        return None, {}
    val = 1.0
    for t in ("TI", "TU"):
        if by_type.get(t):
            val *= sorted(by_type[t])[0]
    return round(val, 6), by_type


def run_checks(d, only=None):
    zones = {z["id"]: z for z in d["dm_zone"]}
    stations = {s["id"]: s for s in d["dm_station"]}
    points = d["dm_point"]
    assets_by_id = {a["id"]: a for a in d["vt_asset"]}

    cur_installs = [i for i in d["vt_install"] if i.get("is_current")]
    by_point = defaultdict(list)
    by_asset = defaultdict(list)
    for i in cur_installs:
        by_point[i.get("point")].append(i)
        by_asset[i.get("asset")].append(i)

    def pname(p):
        z = zones.get(p.get("zone"), {})
        return "%s [%s]" % (p.get("line_name") or p.get("line_id"), z.get("code", "?"))

    findings = []

    def add(num, level, title, detail):
        findings.append({"check": num, "level": level, "title": title, "detail": detail})

    want = set(only) if only else None
    def on(n):
        return want is None or n in want

    # 1. LOI - mot diem do co >=2 cong to dang treo
    if on(1):
        for p in points:
            # Dem theo VAT TU KHAC NHAU. Neu dem ban ghi thi ban ghi treo bi
            # trung se bao nham thanh "2 cong to" (dinh ngay 05/08).
            ms = {i.get("asset"): i.get("serial")
                  for i in by_point.get(p["id"], [])
                  if (assets_by_id.get(i.get("asset")) or {}).get("type") in METER_TYPES}
            if len(ms) >= 2:
                add(1, LOI, "Diem do co %d cong to khac nhau cung luc" % len(ms),
                    "%s: %s" % (pname(p), ", ".join(sorted(ms.values()))))

    # 2. LOI - TI cua cung mot diem do khac ty so nhau
    if on(2):
        for p in points:
            for t in ("TI", "TU"):
                rs = defaultdict(list)
                for i in by_point.get(p["id"], []):
                    a = assets_by_id.get(i.get("asset")) or {}
                    if a.get("type") == t and a.get("ratio"):
                        rs[round(float(a["ratio"]), 6)].append(a.get("serial"))
                if len(rs) >= 2:
                    add(2, LOI, "%s cung diem do khac ty so nhau" % t,
                        "%s: %s" % (pname(p), "; ".join(
                            "%s -> %s" % (k, ", ".join(v)) for k, v in sorted(rs.items()))))

    # 3. LOI - HSN suy ra lech HSN hoa don
    if on(3):
        for p in points:
            calc, _ = _hsn_of_point(p["id"], assets_by_id, by_point)
            inv = p.get("hsn_invoice")

            # HSN hoa don BAT THUONG - bat duoc ngay ca khi chua co TI/TU.
            # Ca that da biet: 6 diem do HSN=0, va 1 diem do bi ghi nham SO
            # HIEU cong to (2610170783) vao o HSN.
            if p.get("point_status") == "active":
                if inv in (None, 0):
                    add(3, LOI, "HSN hoa don bang 0 / de trong", pname(p))
                elif inv > 100000:
                    add(3, LOI, "HSN hoa don bat thuong (co the bi ghi nham so hieu)",
                        "%s: hsn_invoice = %s" % (pname(p), inv))

            if calc is None or not inv:
                continue          # chua du du lieu de so - khong phai loi
            if abs(calc - inv) / inv > 0.001:
                add(3, LOI, "HSN suy ra lech HSN hoa don",
                    "%s: suy ra %s, hoa don %s" % (pname(p), calc, inv))

    # 4. LOI - mot vat tu treo o >=2 noi
    if on(4):
        pt_by_id = {x["id"]: x for x in points}
        for aid, insts in by_asset.items():
            if len(insts) < 2:
                continue
            a = assets_by_id.get(aid, {})
            pids = {i.get("point") for i in insts}
            if len(pids) == 1:
                # Cung MOT diem do ⇒ ban ghi treo bi TRUNG, khong phai treo 2 noi.
                pt = pt_by_id.get(list(pids)[0])
                add(4, LOI, "Ban ghi treo bi trung (%d ban ghi cung 1 diem do)" % len(insts),
                    "%s tai %s — id: %s" % (
                        a.get("serial", aid),
                        pname(pt) if pt else list(pids)[0],
                        ", ".join(i["id"] for i in insts)))
            else:
                names = [pname(pt_by_id[q]) if q in pt_by_id else str(q) for q in pids]
                add(4, LOI, "Vat tu treo o %d diem do KHAC NHAU" % len(pids),
                    "%s: %s" % (a.get("serial", aid), " | ".join(names)))

    # 5. CANH BAO - diem do thieu cong to hoac thieu GP-03
    if on(5):
        for p in points:
            if p.get("point_status") in ("du_kien", "dismounted"):
                continue          # dat truoc / da thao: khong yeu cau (plan §1.7)
            types = [(assets_by_id.get(i.get("asset")) or {}).get("type")
                     for i in by_point.get(p["id"], [])]
            thieu = []
            if not any(t in METER_TYPES for t in types):
                thieu.append("cong to")
            if "GP03" not in types:
                thieu.append("GP-03")
            if thieu:
                add(5, CANH_BAO, "Diem do thieu %s" % " va ".join(thieu), pname(p))

    # 6. CANH BAO - diem do trung the thieu TU
    #    KHONG chay duoc: truong `voltage_level` da bi bo khoi dm_point ngay
    #    03/08 theo yeu cau cua user, khong con cach phan biet LV/MV.
    if on(6):
        add(6, CANH_BAO, "Kiem tra 6 KHONG chay duoc",
            "Can truong voltage_level de biet diem do trung the, truong nay da "
            "bi bo khoi dm_point ngay 03/08. Bo qua kiem tra nay.")

    # 7. CANH BAO - cong to 3 pha nen co 3 TI (2 phan tu = 2 TI, khong chan)
    if on(7):
        for p in points:
            types = [(assets_by_id.get(i.get("asset")) or {}).get("type")
                     for i in by_point.get(p["id"], [])]
            if not any(t in METER_TYPES for t in types):
                continue
            n_ti = sum(1 for t in types if t == "TI")
            if n_ti not in (0, 2, 3):
                add(7, CANH_BAO, "Diem do co %d TI (thuong la 2 hoac 3)" % n_ti, pname(p))

    # 8. CANH BAO - qua han kiem dinh nhung van dang treo
    if on(8):
        today = _dt.date.today().isoformat()
        for a in d["vt_asset"]:
            if a.get("type") in NO_CALIBRATION:
                continue
            nc = (a.get("next_calibration") or "")[:10]
            if nc and nc < today and a.get("current_status") == "dang_treo":
                add(8, CANH_BAO, "Qua han kiem dinh nhung van treo",
                    "%s (%s): han %s" % (a.get("serial"), a.get("type"), nc))

    # 9. CANH BAO - trang thai `kho` nhung HES van co chi so
    #    Can goi API HES, khong lam trong script nay de tranh phu thuoc mang
    #    noi bo + token. Ghi ro thay vi im lang bo qua.
    if on(9):
        add(9, CANH_BAO, "Kiem tra 9 CHUA lam",
            "Can doi chieu voi API HES (chi so hom qua) - chua noi vao script nay.")

    # 10. CANH BAO - khong suy duoc nam SX ⇒ thieu han kiem dinh
    if on(10):
        for a in d["vt_asset"]:
            if a.get("type") in NO_CALIBRATION:
                continue
            if not a.get("next_calibration"):
                add(10, CANH_BAO, "Thieu han kiem dinh",
                    "%s (%s): nam SX %s" % (a.get("serial"), a.get("type"),
                                            a.get("manufacture_year") or "khong ro"))

    return findings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="Ghi ket qua ra file JSON")
    ap.add_argument("--only", help="Chi chay mot so kiem tra, vd 1,2,4")
    ap.add_argument("--quiet", action="store_true", help="Chi in tong ket")
    args = ap.parse_args()

    only = [int(x) for x in args.only.split(",")] if args.only else None

    token = pb.login()
    d = _fetch_all(token)
    print("Da doc: %d KCN, %d tram, %d diem do, %d vat tu, %d lan treo\n" % (
        len(d["dm_zone"]), len(d["dm_station"]), len(d["dm_point"]),
        len(d["vt_asset"]), len(d["vt_install"])))

    findings = run_checks(d, only)
    loi = [f for f in findings if f["level"] == LOI]
    canh = [f for f in findings if f["level"] == CANH_BAO]

    if not args.quiet:
        for group, label in ((loi, "LOI"), (canh, "CANH BAO")):
            if not group:
                continue
            print("=" * 62)
            print("%s (%d)" % (label, len(group)))
            print("=" * 62)
            by_check = defaultdict(list)
            for f in group:
                by_check[f["check"]].append(f)
            for num in sorted(by_check):
                items = by_check[num]
                print("\n[%d] %s  (%d)" % (num, items[0]["title"], len(items)))
                for f in items[:20]:
                    print("    - %s" % f["detail"])
                if len(items) > 20:
                    print("    ... con %d dong nua" % (len(items) - 20))
            print()

    print("TONG KET: %d LOI, %d canh bao" % (len(loi), len(canh)))

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"errors": loi, "warnings": canh}, fh,
                      ensure_ascii=False, indent=2)
        print("Da ghi %s" % args.json)

    return 1 if loi else 0


if __name__ == "__main__":
    sys.exit(main())

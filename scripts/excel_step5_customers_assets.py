# -*- coding: utf-8 -*-
"""Buoc 5: dong bo KHACH HANG va VAT TU tu Excel.

  - Khach hang: bo sung MKH con thieu + ghi `short_name` (ten tat) cho tat ca.
  - Vat tu    : bo sung serial con thieu; voi vat tu DA CO thi chi BO SUNG cho
                truong dang trong, KHONG ghi de.

Vi sao khong ghi de: Excel co `Tinh trang kiem dinh` = False cho ca 359 dong va
KHONG dong nao co han kiem dinh, trong khi PB da tinh duoc han tu nam SX
(cong to 3 nam, TI/TU 5 nam). Ghi de la mat sach du lieu kiem dinh.

Mac dinh CHAY THU.
    python scripts/excel_step5_customers_assets.py
    python scripts/excel_step5_customers_assets.py --apply
"""
import argparse
import json
import re
import sys

import openpyxl
import pb_client as pb
from excel_step3_match_points import XLSX

# Excel viet "GP-03", "Sim"; PB dung ma khong dau gach
TYPE_MAP = {"GP-03": "GP03", "GP03": "GP03", "SIM": "SIM",
            "ME41": "ME41", "ME42": "ME42", "TI": "TI", "TU": "TU",
            "DTS27": "DTS27"}
METERS = {"ME41", "ME42", "DTS27"}
NO_CALIB = {"GP03", "SIM"}


def sheet(name):
    wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
    ws = wb[name]
    it = ws.iter_rows(values_only=True)
    next(it)
    return [r for r in it if r and any(c is not None and str(c).strip() for c in r)]


def parse_ratio(txt):
    """'2500/5' -> (2500.0, 5.0, 500.0). Tra None neu khong doc duoc."""
    if not txt:
        return None
    m = re.match(r"^\s*([\d.,]+)\s*[/:]\s*([\d.,]+)\s*$", str(txt))
    if not m:
        return None
    try:
        p = float(m.group(1).replace(",", "."))
        q = float(m.group(2).replace(",", "."))
    except ValueError:
        return None
    if q == 0 or p <= 0:
        return None
    return p, q, round(p / q, 6)


def year_from_serial(serial, typ):
    """Cong to: 2 so dau la nam SX (2610... -> 2026)."""
    s = str(serial)
    if typ in METERS and len(s) >= 2 and s[:2].isdigit():
        return 2000 + int(s[:2])
    return None


def next_calib(year, typ):
    if not year or typ in NO_CALIB:
        return None
    span = 3 if typ in METERS else 5
    return "%d-01-01" % (year + span)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    token = pb.login()

    # ---------- Khach hang ----------
    zones = {z["code"]: z["id"] for z in pb.list_records(token, "dm_zone")}
    pbc = {c["mkh"]: c for c in pb.list_records(token, "dm_customer")}
    xc = sheet("Quản lý khách hàng")

    them_kh, sua_kh = [], []
    for r in xc:
        mkh = str(r[0]).strip()
        ten = str(r[1]).strip() if r[1] else ""
        tat = str(r[2]).strip() if r[2] else ""
        kcn = str(r[3]).strip() if r[3] else ""
        cur = pbc.get(mkh)
        if not cur:
            zid = zones.get(kcn)
            if not zid:
                print("  BO QUA (khong ro KCN %s): %s" % (kcn, mkh))
                continue
            them_kh.append({"mkh": mkh, "name": ten, "short_name": tat,
                            "zone": zid, "active": True})
        else:
            patch = {}
            if tat and (cur.get("short_name") or "") != tat:
                patch["short_name"] = tat
            if patch:
                sua_kh.append((cur["id"], mkh, patch))

    print("Khach hang: them %d | ghi ten tat cho %d" % (len(them_kh), len(sua_kh)))

    # ---------- Vat tu ----------
    pba = {a["serial"]: a for a in pb.list_records(token, "vt_asset")}
    xa = sheet("Quản lý vật tư")
    them_vt, sua_vt, bo_qua = [], [], 0

    for r in xa:
        typ = TYPE_MAP.get(str(r[0]).strip().upper().replace(" ", ""))
        if not typ:
            typ = TYPE_MAP.get(str(r[0]).strip(), "KHAC")
        serial = str(r[1]).strip()
        tskt = r[2]
        ghi_chu = str(r[5]).strip() if len(r) > 5 and r[5] else ""
        if not serial:
            bo_qua += 1
            continue

        rat = parse_ratio(tskt)
        cur = pba.get(serial)
        if not cur:
            body = {"serial": serial, "type": typ, "current_status": "kho",
                    "hes_seen": False, "note": ghi_chu}
            if rat:
                body["ratio_primary"], body["ratio_secondary"], body["ratio"] = rat
            y = year_from_serial(serial, typ)
            if y:
                body["manufacture_year"] = y
                nc = next_calib(y, typ)
                if nc:
                    body["next_calibration"] = nc
            them_vt.append(body)
        else:
            # CHI bo sung cho truong dang trong - khong ghi de
            patch = {}
            if rat and not cur.get("ratio"):
                patch["ratio_primary"], patch["ratio_secondary"], patch["ratio"] = rat
            if ghi_chu and not (cur.get("note") or "").strip():
                patch["note"] = ghi_chu
            if patch:
                sua_vt.append((cur["id"], serial, patch))

    print("Vat tu: them %d | bo sung %d | bo qua (thieu serial) %d"
          % (len(them_vt), len(sua_vt), bo_qua))
    print("  loai se them:", end=" ")
    from collections import Counter
    print(dict(Counter(b["type"] for b in them_vt)))

    if not args.apply:
        print("\nCHAY THU - chua ghi gi. Them --apply de ghi that.")
        return 0

    H = {**pb.headers(token), "Content-Type": "application/json"}
    for b in them_kh:
        pb.req("post", "%s/api/collections/dm_customer/records" % pb.PB_URL,
               headers=H, data=json.dumps(b)).raise_for_status()
    for cid, _, patch in sua_kh:
        pb.req("patch", "%s/api/collections/dm_customer/records/%s" % (pb.PB_URL, cid),
               headers=H, data=json.dumps(patch)).raise_for_status()
    for b in them_vt:
        pb.req("post", "%s/api/collections/vt_asset/records" % pb.PB_URL,
               headers=H, data=json.dumps(b)).raise_for_status()
    for aid, _, patch in sua_vt:
        pb.req("patch", "%s/api/collections/vt_asset/records/%s" % (pb.PB_URL, aid),
               headers=H, data=json.dumps(patch)).raise_for_status()

    c2 = pb.list_records(token, "dm_customer")
    a2 = pb.list_records(token, "vt_asset")
    print("\nSau khi ghi: %d khach hang (co ten tat: %d) | %d vat tu (co ty so: %d)"
          % (len(c2), sum(1 for c in c2 if c.get("short_name")),
             len(a2), sum(1 for a in a2 if a.get("ratio"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())

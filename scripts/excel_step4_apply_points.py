# -*- coding: utf-8 -*-
"""Buoc 4: ap dung ket qua doi chieu diem do (user duyet 05/08).

Xem `plans/doi-chieu-diem-do.md` phan "USER DA DUYET".

Lam 3 viec:
  1. Voi diem do GHEP DUOC: ghi `ops_name` (ten van hanh cua Excel), va bo sung
     `energized_date` / `liquidated_date` / `point_status` neu PB con trong.
  2. Voi 3 diem do ARCANA: TAO MOI, vai tro PHU, gan cung tram voi
     `03.LOGOS.T3.1600kVA` (user: "cac diem do ARCANA nam ben trong do").
  3. Voi diem do chi co o Excel: TAO MOI. Chung khong co `line_id` tu HES nen
     sinh khoa tam `XL-###` va ghi ro trong `note`.

KHONG doi `line_name` cua ban ghi da co: do la ten HES, con la khoa nhin thay
trong ca ung dung. Ten Excel di vao `ops_name`.

Mac dinh CHAY THU.
    python scripts/excel_step4_apply_points.py
    python scripts/excel_step4_apply_points.py --apply
"""
import argparse
import difflib
import json
import re
import sys

import pb_client as pb
from excel_step3_match_points import KHO_PAT, norm, read_excel_points

# Ba diem do nam BEN TRONG mot diem do khac => tao moi, vai tro phu
ARCANA = {
    "03.LOGOS.T3.1600kVA.ARCANA.T1",
    "03.LOGOS.T3.1600kVA.ARCANA.T2",
    "03.LOGOS.T3.1600kVA.ARCANA.T3",
}
ARCANA_PARENT = "03.LOGOS.T3.1600kVA"

STATUS_MAP = {
    "Đang hoạt động": "active",
    "Chưa đóng điện": "chua_van_hanh",
    "Đã thanh lý": "da_thanh_ly",
    "Đã thu hồi": "dismounted",
    "Không  hoạt động": "khong_hoat_dong",
    "Không hoạt động": "khong_hoat_dong",
    "Trả Emic": "tra_ncc",
    "Chưa gán khách hàng": "du_kien",
}

ZONE_PREFIX = {"03": "KCN03", "TH": "KCNTH", "TTI": "KCNTTI", "PĐ": "KCNPĐ",
               "PD": "KCNPĐ", "YM": "KCNYM", "GETC": "GETC"}


def d10(v):
    return str(v)[:10] if v else ""


def zone_of(ten, zones_by_code):
    pre = ten.split(".")[0].strip().upper()
    for k, v in ZONE_PREFIX.items():
        if pre == k.upper():
            return zones_by_code.get(v)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--cutoff", type=float, default=0.80)
    args = ap.parse_args()

    token = pb.login()
    pts = pb.list_records(token, "dm_point")
    zones_by_code = {z["code"]: z["id"] for z in pb.list_records(token, "dm_zone")}
    by_norm = {}
    for p in pts:
        by_norm.setdefault(norm(p.get("line_name") or ""), p)

    xl = read_excel_points()

    ghep, tao_moi, arcana = [], [], []
    for x in xl:
        if KHO_PAT.search(x["ten"].upper()):
            continue                       # kho ao -> buoc 5
        if x["ten"] in ARCANA:
            arcana.append(x)
            continue
        n = norm(x["ten"])
        p = by_norm.get(n)
        if not p:
            m = difflib.get_close_matches(n, list(by_norm.keys()), n=1, cutoff=args.cutoff)
            p = by_norm[m[0]] if m else None
        if p:
            ghep.append((x, p))
        else:
            tao_moi.append(x)

    print("Ghep vao ban ghi co san : %d" % len(ghep))
    print("Tao moi (chi co o Excel): %d" % len(tao_moi))
    print("Tao moi (ARCANA, phu)   : %d" % len(arcana))

    # --- 1. Ghi ops_name + ngay + trang thai cho ban ghi ghep duoc ---
    n_upd = 0
    for x, p in ghep:
        patch = {}
        if (p.get("ops_name") or "") != x["ten"]:
            patch["ops_name"] = x["ten"]
        if x["dong_dien"] and not p.get("energized_date"):
            patch["energized_date"] = d10(x["dong_dien"])
        if x["thanh_ly"] and not p.get("liquidated_date"):
            patch["liquidated_date"] = d10(x["thanh_ly"])
        st = STATUS_MAP.get(x["trang_thai"])
        # Chi nang cap trang thai khi PB dang de trong - KHONG de Excel ghi de
        # trang thai da duoc xac nhan trong app.
        if st and not p.get("point_status"):
            patch["point_status"] = st
        if not patch:
            continue
        n_upd += 1
        if args.apply:
            r = pb.req("patch", "%s/api/collections/dm_point/records/%s" % (pb.PB_URL, p["id"]),
                       headers={**pb.headers(token), "Content-Type": "application/json"},
                       data=json.dumps(patch))
            r.raise_for_status()
    print("  -> se cap nhat %d ban ghi" % n_upd)

    # --- 2 & 3. Tao moi ---
    parent = by_norm.get(norm(ARCANA_PARENT))
    if arcana and not parent:
        print("  CANH BAO: khong tim thay %s => bo qua 3 diem do ARCANA" % ARCANA_PARENT)
        arcana = []

    seq = 1
    existing_ids = {p.get("line_id") for p in pts}
    made = 0
    for x in tao_moi + arcana:
        la_arcana = x["ten"] in ARCANA
        zid = parent["zone"] if la_arcana else zone_of(x["ten"], zones_by_code)
        if not zid:
            print("  BO QUA (khong ro KCN): %s" % x["ten"])
            continue
        while ("XL-%03d" % seq) in existing_ids:
            seq += 1
        lid = "XL-%03d" % seq
        seq += 1
        body = {
            "line_id": lid,
            "line_name": x["ten"],
            "ops_name": x["ten"],
            "zone": zid,
            "role": "phu" if la_arcana else "chinh",
            "point_status": STATUS_MAP.get(x["trang_thai"], "chua_van_hanh"),
            "note": ("Nam ben trong %s. " % ARCANA_PARENT if la_arcana else "")
                    + "Tu Excel Quan ly kho V2, CHUA khop HES (line_id tam).",
        }
        if la_arcana and parent.get("station"):
            body["station"] = parent["station"]
        if x["dong_dien"]:
            body["energized_date"] = d10(x["dong_dien"])
        if x["thanh_ly"]:
            body["liquidated_date"] = d10(x["thanh_ly"])
        made += 1
        if args.apply:
            r = pb.req("post", "%s/api/collections/dm_point/records" % pb.PB_URL,
                       headers={**pb.headers(token), "Content-Type": "application/json"},
                       data=json.dumps(body))
            r.raise_for_status()
    print("  -> se tao moi %d diem do" % made)

    if not args.apply:
        print("\nCHAY THU - chua ghi gi. Them --apply de ghi that.")
        return 0

    # Doc lai de xac nhan
    pts2 = pb.list_records(token, "dm_point")
    print("\nSau khi ghi: %d diem do (truoc: %d), co ops_name: %d, line_id tam: %d"
          % (len(pts2), len(pts),
             sum(1 for p in pts2 if p.get("ops_name")),
             sum(1 for p in pts2 if str(p.get("line_id", "")).startswith("XL-"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())

# -*- coding: utf-8 -*-
"""Buoc 1 dong bo Excel: doi luoc do (user chot 05/08).

Xem plan `plans/2026-08-05-dong-bo-voi-excel-quan-ly-kho-v2.md` §8.

  - dm_customer  + short_name       (ten tat: ECOLAND, COFICO...)
  - dm_point     + ops_name         (ten van hanh cua Excel, GIU song song
                                     line_name la ten HES)
  - dm_point     + energized_date, liquidated_date
  - dm_point.point_status: MO RONG them da_thanh_ly / khong_hoat_dong / tra_ncc
  - dm_zone      + ban ghi GETC (van phong 52 Le Dai Hanh)

CHI THEM, khong xoa/doi ten truong nao. Mac dinh CHAY THU.

    python scripts/excel_step1_schema.py
    python scripts/excel_step1_schema.py --apply
"""
import argparse
import json
import sys

import pb_client as pb

NEW_STATUS = ["du_kien", "chua_van_hanh", "active", "dismounted",
              "da_thanh_ly", "khong_hoat_dong", "tra_ncc"]


def txt(name):
    return {"name": name, "type": "text", "required": False, "presentable": False}


def date(name):
    return {"name": name, "type": "date", "required": False}


def ensure_fields(cols, token, coll_name, want, apply):
    """Them cac truong con thieu vao mot collection."""
    col = next((c for c in cols if c["name"] == coll_name), None)
    if not col:
        print("  KHONG tim thay %s" % coll_name)
        return False
    have = {f["name"] for f in col["fields"]}
    missing = [f for f in want if f["name"] not in have]
    if not missing:
        print("  %-18s da du truong" % coll_name)
        return False
    print("  %-18s them: %s" % (coll_name, ", ".join(f["name"] for f in missing)))
    if not apply:
        return True
    col["fields"].extend(missing)
    r = pb.req("patch", "%s/api/collections/%s" % (pb.PB_URL, col["id"]),
               headers={**pb.headers(token), "Content-Type": "application/json"},
               data=json.dumps({"fields": col["fields"]}))
    r.raise_for_status()
    return True


def widen_status(cols, token, apply):
    """Mo rong danh sach gia tri cua point_status."""
    col = next(c for c in cols if c["name"] == "dm_point")
    f = next(x for x in col["fields"] if x["name"] == "point_status")
    cur = list(f.get("values") or [])
    add = [v for v in NEW_STATUS if v not in cur]
    if not add:
        print("  point_status da du gia tri")
        return False
    print("  point_status them: %s" % ", ".join(add))
    if not apply:
        return True
    f["values"] = cur + add
    r = pb.req("patch", "%s/api/collections/%s" % (pb.PB_URL, col["id"]),
               headers={**pb.headers(token), "Content-Type": "application/json"},
               data=json.dumps({"fields": col["fields"]}))
    r.raise_for_status()
    return True


def ensure_zone_getc(token, apply):
    zones = pb.list_records(token, "dm_zone")
    if any(z["code"] == "GETC" for z in zones):
        print("  KCN GETC da co")
        return False
    print("  KCN GETC: se tao (Van phong 52 Le Dai Hanh)")
    if not apply:
        return True
    r = pb.req("post", "%s/api/collections/dm_zone/records" % pb.PB_URL,
               headers={**pb.headers(token), "Content-Type": "application/json"},
               data=json.dumps({"code": "GETC", "name": "Văn phòng GETC",
                                "area_label": "Văn phòng 52 Lê Đại Hành"}))
    r.raise_for_status()
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    token = pb.login()
    cols = pb.list_collections(token)

    print("=== Truong moi ===")
    ensure_fields(cols, token, "dm_customer", [txt("short_name")], args.apply)
    ensure_fields(cols, token, "dm_point",
                  [txt("ops_name"), date("energized_date"), date("liquidated_date")],
                  args.apply)
    print("=== Trang thai diem do ===")
    widen_status(cols, token, args.apply)
    print("=== Khu cong nghiep ===")
    ensure_zone_getc(token, args.apply)

    if not args.apply:
        print("\nCHAY THU - chua ghi gi. Them --apply de ghi that.")
        return 0

    # Doc lai de xac nhan, khong tin vao ma tra ve
    cols2 = pb.list_collections(token)
    ok = True
    c = next(x for x in cols2 if x["name"] == "dm_customer")
    if "short_name" not in {f["name"] for f in c["fields"]}:
        ok = False
    p = next(x for x in cols2 if x["name"] == "dm_point")
    pf = {f["name"] for f in p["fields"]}
    for n in ("ops_name", "energized_date", "liquidated_date"):
        if n not in pf:
            ok = False
    st = next(f for f in p["fields"] if f["name"] == "point_status")
    for v in NEW_STATUS:
        if v not in (st.get("values") or []):
            ok = False
    if not any(z["code"] == "GETC" for z in pb.list_records(token, "dm_zone")):
        ok = False

    print("\nKiem lai: %s" % ("OK" if ok else "KHONG DUNG NHU MONG DOI"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

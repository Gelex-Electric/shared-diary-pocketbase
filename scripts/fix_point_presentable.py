# -*- coding: utf-8 -*-
"""Doi truong hien thi cua dm_point: line_id -> line_name (user chot 05/08).

Trong giao dien quan tri PocketBase, o quan he va danh sach lay truong co co
`presentable=true` lam nhan. Hien `line_id` dang mang co do nen moi cho deu hien
day so kho doc (VD 811) thay vi ten diem do (VD TH.RICO.T1.2500kVA).

`line_id` VAN GIU trong CSDL: la khoa unique va la khoa khop voi HES.

    python scripts/fix_point_presentable.py --dry-run
    python scripts/fix_point_presentable.py --apply
"""
import argparse
import json
import sys

import pb_client as pb


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    token = pb.login()
    col = next((c for c in pb.list_collections(token) if c["name"] == "dm_point"), None)
    if not col:
        print("Khong tim thay collection dm_point")
        return 1

    fields = col["fields"]
    print("Truoc:")
    for f in fields:
        if f.get("name") in ("line_id", "line_name"):
            print("   %-10s presentable=%s" % (f["name"], f.get("presentable")))

    changed = False
    for f in fields:
        if f.get("name") == "line_id" and f.get("presentable"):
            f["presentable"] = False
            changed = True
        if f.get("name") == "line_name" and not f.get("presentable"):
            f["presentable"] = True
            changed = True

    if not changed:
        print("\nDa dung tu truoc - khong can lam gi.")
        return 0

    print("\nSe doi: line_id presentable=False, line_name presentable=True")
    if not args.apply:
        print("CHAY THU - chua ghi gi. Them --apply de ghi that.")
        return 0

    r = pb.req("patch",
               "%s/api/collections/%s" % (pb.PB_URL, col["id"]),
               headers={**pb.headers(token), "Content-Type": "application/json"},
               data=json.dumps({"fields": fields}))
    r.raise_for_status()

    # Doc lai de xac nhan, khong tin vao ma tra ve
    col2 = next(c for c in pb.list_collections(token) if c["name"] == "dm_point")
    print("\nSau khi ghi:")
    ok = True
    for f in col2["fields"]:
        if f.get("name") in ("line_id", "line_name"):
            print("   %-10s presentable=%s" % (f["name"], f.get("presentable")))
            if f["name"] == "line_id" and f.get("presentable"):
                ok = False
            if f["name"] == "line_name" and not f.get("presentable"):
                ok = False
    print("\n%s" % ("OK" if ok else "KHONG DUNG NHU MONG DOI"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

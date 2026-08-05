# -*- coding: utf-8 -*-
"""Don ban ghi vt_install bi TRUNG (cung vat tu + cung diem do, deu is_current).

Nguyen nhan: seed_warehouse.py chay HAI luot ngay 03/08 - luot 08:35 ghi
from_date = ngay chay, luot 09:41 ghi from_date that. Ca hai deu is_current.

Quy tac giu: giu ban ghi co `from_date` SOM NHAT (ngay treo that ngoai hien
truong), xoa cac ban con lai. Neu trung ca from_date thi giu ban `created` som
nhat.

MAC DINH LA CHAY THU. Phai them --apply moi ghi that.

    python scripts/fix_duplicate_installs.py            # xem truoc
    python scripts/fix_duplicate_installs.py --apply    # xoa that
"""
import argparse
import sys
from collections import defaultdict

import pb_client as pb


def find_duplicates(token):
    installs = pb.list_records(token, "vt_install")
    points = {p["id"]: p for p in pb.list_records(token, "dm_point")}

    cur = [i for i in installs if i.get("is_current")]
    groups = defaultdict(list)
    for i in cur:
        groups[(i.get("asset"), i.get("point"))].append(i)

    dups = []
    for (asset, point), items in groups.items():
        if len(items) < 2:
            continue
        # Som nhat truoc: from_date, roi den created
        items.sort(key=lambda r: ((r.get("from_date") or "9999")[:10], r.get("created", "")))
        dups.append({
            "serial": items[0].get("serial"),
            "point_name": (points.get(point) or {}).get("line_name", point),
            "keep": items[0],
            "drop": items[1:],
        })
    return installs, dups


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Xoa that (mac dinh chi xem truoc)")
    args = ap.parse_args()

    token = pb.login()
    installs, dups = find_duplicates(token)

    print("Tong vt_install: %d\nSo cap bi trung: %d\n" % (len(installs), len(dups)))
    if not dups:
        print("Khong co gi de don.")
        return 0

    n_drop = 0
    for d in dups:
        print("%s  tai  %s" % (d["serial"], d["point_name"]))
        k = d["keep"]
        print("   GIU  id=%s  from=%s  created=%s"
              % (k["id"], (k.get("from_date") or "")[:10], k.get("created", "")[:19]))
        for r in d["drop"]:
            print("   XOA  id=%s  from=%s  created=%s"
                  % (r["id"], (r.get("from_date") or "")[:10], r.get("created", "")[:19]))
            n_drop += 1
        print()

    if not args.apply:
        print("CHAY THU - chua xoa gi. Them --apply de xoa %d ban ghi." % n_drop)
        return 0

    print("Dang xoa %d ban ghi..." % n_drop)
    done = 0
    for d in dups:
        for r in d["drop"]:
            pb.req("delete", "%s/api/collections/vt_install/records/%s" % (pb.PB_URL, r["id"]),
                   headers=pb.headers(token)).raise_for_status()
            done += 1
            print("   da xoa %s" % r["id"])

    # Doc lai de xac nhan, khong tin vao ma tra ve
    _, con_lai = find_duplicates(token)
    print("\nDa xoa %d ban ghi. Kiem lai: con %d cap trung." % (done, len(con_lai)))
    return 0 if not con_lai else 1


if __name__ == "__main__":
    sys.exit(main())

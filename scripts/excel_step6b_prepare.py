# -*- coding: utf-8 -*-
"""Buoc 6b: tao truoc nhung thu ma so giao dich tro toi nhung PB chua co.

User chot 05/08:
  - 351 vat tu chi xuat hien trong so giao dich (khong con trong danh sach vat
    tu hien tai) => TAO LAI, danh dau `thanh_ly`, ghi ro suy tu lich su.
  - 13 diem do dich (P1/P2/P3, HANA, FTA...) => TAO MOI, vai tro PHU, gan cung
    tram voi diem do cha suy tu ten.

Mac dinh CHAY THU.
"""
import argparse
import json
import sys
from collections import Counter

import pb_client as pb
from excel_step3_match_points import KHO_PAT, norm, build_alias
from excel_step6_transactions import read_tx

TYPE_MAP = {"GP-03": "GP03", "GP03": "GP03", "SIM": "SIM", "ME41": "ME41",
            "ME42": "ME42", "TI": "TI", "TU": "TU", "DTS27": "DTS27"}
ZONE_PREFIX = {"03": "KCN03", "TH": "KCNTH", "TTI": "KCNTTI", "PĐ": "KCNPĐ",
               "YM": "KCNYM", "GETC": "GETC"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    token = pb.login()
    H = {**pb.headers(token), "Content-Type": "application/json"}

    assets = {a["serial"] for a in pb.list_records(token, "vt_asset")}
    zones = {z["code"]: z["id"] for z in pb.list_records(token, "dm_zone")}
    by_norm, pts = build_alias(token)

    tx = read_tx()

    # ---------- 1. Vat tu chi co trong so giao dich ----------
    loai_of = {}
    for r in tx:
        loai_of.setdefault(r["serial"], r.get("loai_vt") or "")
    thieu = [s for s in loai_of if s not in assets]
    print("Vat tu can tao lai: %d" % len(thieu))
    tao_vt = []
    for s in thieu:
        raw = str(loai_of[s]).strip()
        typ = TYPE_MAP.get(raw.upper().replace(" ", "").replace("-", "")) \
            or TYPE_MAP.get(raw) or "KHAC"
        tao_vt.append({"serial": s, "type": typ, "current_status": "thanh_ly",
                       "hes_seen": False,
                       "note": "Suy tu so giao dich Excel - khong con trong danh sach vat tu"})
    print("   theo loai:", dict(Counter(b["type"] for b in tao_vt)))

    # ---------- 2. Diem do dich chua co ----------
    thieu_dd = {}
    for r in tx:
        d = r["dich"]
        if not d or KHO_PAT.search(d.upper()):
            continue
        if norm(d) not in by_norm:
            thieu_dd[d] = thieu_dd.get(d, 0) + 1

    print("\nDiem do can tao: %d" % len(thieu_dd))
    tao_dd = []
    for ten, n in sorted(thieu_dd.items()):
        # Suy diem do CHA bang cach bo dan doan cuoi cua ten
        parts = ten.split(".")
        parent = None
        for k in range(len(parts) - 1, 1, -1):
            cand = by_norm.get(norm(".".join(parts[:k])))
            if cand:
                parent = cand
                break
        zid = parent["zone"] if parent else zones.get(
            ZONE_PREFIX.get(parts[0].strip().upper(), ""), "")
        if not zid:
            print("   BO QUA (khong ro KCN): %s" % ten)
            continue
        # Co diem do CHA => day la diem do CON (vai tro phu). Khong co cha =>
        # la mot may bien ap rieng => vai tro CHINH.
        body = {"line_name": ten, "ops_name": ten, "zone": zid,
                "role": "phu" if parent else "chinh",
                "point_status": "active",
                "note": ("Nam ben trong %s. " % parent.get("line_name") if parent else "")
                        + "Suy tu so giao dich Excel, CHUA khop HES."}
        if parent and parent.get("station"):
            body["station"] = parent["station"]
        tao_dd.append((body, n, parent.get("line_name") if parent else "(khong ro cha)"))
        print("   %-40s %2d GD  <- cha: %s" % (ten, n, tao_dd[-1][2]))

    if not args.apply:
        print("\nCHAY THU - chua ghi gi.")
        return 0

    for b in tao_vt:
        pb.req("post", "%s/api/collections/vt_asset/records" % pb.PB_URL,
               headers=H, data=json.dumps(b)).raise_for_status()

    seq = 100
    used = {p.get("line_id") for p in pts}
    for body, _n, _p in tao_dd:
        while ("XL-%03d" % seq) in used:
            seq += 1
        body["line_id"] = "XL-%03d" % seq
        used.add(body["line_id"])
        seq += 1
        pb.req("post", "%s/api/collections/dm_point/records" % pb.PB_URL,
               headers=H, data=json.dumps(body)).raise_for_status()

    print("\nSau khi ghi: %d vat tu | %d diem do"
          % (len(pb.list_records(token, "vt_asset")),
             len(pb.list_records(token, "dm_point"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())

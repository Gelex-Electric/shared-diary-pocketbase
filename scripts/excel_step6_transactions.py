# -*- coding: utf-8 -*-
"""Buoc 6: nhap 1.128 giao dich cua Excel thanh so cai `vt_event` + `vt_install`.

Mo hinh cua Excel khac mo hinh PB:
  - Excel chi ghi DICH DEN (`DDDK`), khong ghi nguon. Nguon = dich cua giao dich
    LIEN TRUOC cua chinh vat tu do.
  - `Treo thao` la MOT loai; treo hay thao phan biet bang dich den la diem do
    that hay "kho ao" (DU PHONG / THU HOI / TRA / GETC).

Cach dung o day:
  1. Sap xep giao dich theo (vat tu, ngay, STT).
  2. Duyet tuan tu, suy `from_*` tu vi tri truoc do.
  3. Sinh `vt_event`; rieng treo/thao sinh them `vt_install` (dong ky truoc).
  4. Cuoi cung ghi `current_*` cua vat tu theo vi tri sau cung.

Mac dinh CHAY THU va chi IN BANG. `--apply` moi ghi.
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict

import openpyxl
import pb_client as pb
from excel_step3_match_points import XLSX, KHO_PAT, norm, build_alias

# "Kho ao" cua Excel -> ma kho that trong PB
KHO_MAP = {
    "03.DỰ PHÒNG": "810", "03.THU HỒI": "810",
    "TH.DỰ PHÒNG": "809", "TH.THU HỒI": "809", "TH.TRẢ": "809",
    "YM.DỰ PHÒNG": "857", "YM.THU HỒI": "857",
    "PĐ.DỰ PHÒNG": "KHO-KCNPD", "PĐ.THU HỒI": "KHO-KCNPD",
    "TTI.DỰ PHÒNG": "KHO-KCNTTI", "TTI.THU HỒI": "KHO-KCNTTI",
}
# Tra nha san xuat / luu van phong -> khong phai kho KCN nao
TRA_NCC = {"TH.TRẢ"}
VAN_PHONG = {"GETC", "GETCHY"}


def read_tx():
    wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
    ws = wb["Quản lý giao dịch"]
    it = ws.iter_rows(values_only=True)
    next(it)
    out = []
    for r in it:
        if not r or not r[4]:
            continue
        out.append({
            "stt": int(r[0]) if str(r[0] or "").isdigit() else 0,
            "loai": (str(r[1]) or "").strip(),
            "ngay": str(r[2])[:10] if r[2] else "",
            "loai_vt": (str(r[3]) or "").strip() if r[3] else "",
            "serial": str(r[4]).strip(),
            "dich": (str(r[6]) or "").strip() if r[6] else "",
            "gc": (str(r[7]) or "").strip() if r[7] else "",
            "anh": (str(r[8]) or "").strip() if r[8] else "",
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    token = pb.login()

    assets = {a["serial"]: a for a in pb.list_records(token, "vt_asset")}
    whs = {w["code"]: w["id"] for w in pb.list_records(token, "vt_warehouse")}
    pt_by_norm, pts = build_alias(token)

    tx = read_tx()
    print("Doc %d giao dich tu Excel" % len(tx))

    # Gom theo vat tu, sap theo ngay roi STT
    by_asset = defaultdict(list)
    for r in tx:
        by_asset[r["serial"]].append(r)
    for v in by_asset.values():
        v.sort(key=lambda r: (r["ngay"], r["stt"]))

    thieu_vt = [s for s in by_asset if s not in assets]
    dich_la = Counter()
    events, installs, cur_state = [], [], {}

    for serial, rows in by_asset.items():
        a = assets.get(serial)
        if not a:
            continue
        cur_wh, cur_pt = "", ""          # vi tri truoc do
        for r in rows:
            dich = r["dich"]
            la_kho = bool(dich) and (KHO_PAT.search(dich.upper()) is not None)
            pt = None if la_kho else pt_by_norm.get(norm(dich)) if dich else None
            wh_code = KHO_MAP.get(dich) if la_kho else None
            if dich and not la_kho and not pt:
                dich_la[dich] += 1
                continue

            note = r["gc"] + (("  [anh] " + r["anh"]) if r["anh"] else "")
            base = {"asset": a["id"], "serial": serial, "at": r["ngay"],
                    "note": note.strip()}

            if pt:                                    # -> treo len diem do
                events.append({**base, "event": "treo",
                               "from_warehouse": cur_wh, "to_point": pt["id"]})
                installs.append({"asset": a["id"], "serial": serial, "type": a["type"],
                                 "point": pt["id"], "from_date": r["ngay"]})
                cur_wh, cur_pt = "", pt["id"]
            else:                                     # -> ve kho / tra NCC
                wid = whs.get(wh_code, "") if wh_code else ""
                ev = "thao" if cur_pt else "nhap_kho"
                if dich in TRA_NCC:
                    ev = "thanh_ly"
                events.append({**base, "event": ev,
                               "from_point": cur_pt, "from_warehouse": cur_wh,
                               "to_warehouse": wid})
                cur_wh, cur_pt = wid, ""
        cur_state[a["id"]] = (cur_wh, cur_pt, a["type"])

    print("Se tao %d su kien | %d lan treo" % (len(events), len(installs)))
    print("Vat tu trong Excel chua co trong PB: %d" % len(thieu_vt))
    if thieu_vt:
        print("   vd:", thieu_vt[:5])
    if dich_la:
        print("Dich den KHONG khop diem do nao: %d ten" % len(dich_la))
        for k, v in dich_la.most_common(10):
            print("   %-38s %d giao dich" % (k, v))

    ev_old = pb.list_records(token, "vt_event")
    in_old = pb.list_records(token, "vt_install")
    print("\nPB dang co: %d su kien | %d lan treo (se BI XOA neu --apply)"
          % (len(ev_old), len(in_old)))

    if not args.apply:
        print("\nCHAY THU - chua ghi gi.")
        return 0

    H = {**pb.headers(token), "Content-Type": "application/json"}
    print("\nXoa so cai cu...")
    for e in ev_old:
        pb.req("delete", "%s/api/collections/vt_event/records/%s" % (pb.PB_URL, e["id"]),
               headers=H).raise_for_status()
    for i in in_old:
        pb.req("delete", "%s/api/collections/vt_install/records/%s" % (pb.PB_URL, i["id"]),
               headers=H).raise_for_status()

    print("Ghi %d su kien..." % len(events))
    for e in events:
        pb.req("post", "%s/api/collections/vt_event/records" % pb.PB_URL,
               headers=H, data=json.dumps(e)).raise_for_status()

    print("Ghi %d lan treo..." % len(installs))
    # Chi lan treo CUOI CUNG cua moi (vat tu, diem do) moi la is_current
    last = {}
    for k, ins in enumerate(installs):
        last[ins["asset"]] = k
    for k, ins in enumerate(installs):
        aid = ins["asset"]
        is_cur = (last[aid] == k) and (cur_state.get(aid, ("", "", ""))[1] == ins["point"])
        body = {**ins, "is_current": is_cur}
        if not is_cur:
            body["to_date"] = ins["from_date"]
        pb.req("post", "%s/api/collections/vt_install/records" % pb.PB_URL,
               headers=H, data=json.dumps(body)).raise_for_status()

    print("Cap nhat vi tri hien tai...")
    for aid, (wh, pt, _ty) in cur_state.items():
        st = "dang_treo" if pt else ("kho" if wh else "kho")
        pb.req("patch", "%s/api/collections/vt_asset/records/%s" % (pb.PB_URL, aid),
               headers=H, data=json.dumps({"current_warehouse": wh, "current_point": pt,
                                           "current_status": st})).raise_for_status()

    print("\nSau khi ghi: %d su kien | %d lan treo"
          % (len(pb.list_records(token, "vt_event")),
             len(pb.list_records(token, "vt_install"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())

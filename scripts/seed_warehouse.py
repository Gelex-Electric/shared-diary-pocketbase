"""Task 6 (plan 2026-08-03-mo-hinh-danh-muc-va-kho-vat-tu.md):
seed vt_warehouse + vt_asset (cong to) + vt_install + vt_event khoi tao.

Nguon: public/metterinfo.csv (danh sach cong to + vi tri hien tai theo HES)
       collection invoice     (ngay hoa don som nhat -> uoc luong ngay treo)

QUAN TRONG - tinh trung thuc cua so cai:
  vt_event la append-only, khong sua/xoa duoc. Ta KHONG BIET ngay nhap kho /
  ngay treo that cua 134 cong to nay (HES lan hoa don deu khong co). Vi vay:
    - Moi cong to chi sinh DUNG MOT event khoi tao (khong dung chuoi gia
      nhap_kho -> treo).
    - note ghi ro "KHOI TAO TU HES - khong phai su kien thuc dia".
    - Ngay lay theo hoa don som nhat cua cong to; khong co thi danh dau
      uoc luong va liet ke ra de nguoi dung biet.
  Bia lich su vao so cai append-only la khong the go lai.

TI / TU / GP-03: KHONG co nguon du lieu nao => khong seed, nhap tay qua UI.

Cach dung:
  python scripts/seed_warehouse.py --dry-run
  python scripts/seed_warehouse.py
"""

import argparse
import datetime as dt
import sys
from collections import Counter, defaultdict

import pb_client as pb
import seed_catalog as sc

SEED_NOTE = "KHOI TAO TU HES 2026-08-03 - khong phai su kien thuc dia"

# MOI KCN DUNG 1 KHO (user chot 03/08).
# 3 kho dau suy tu LINE_ID gia trong HES (cong to da thao); 2 kho sau tao moi
# vi KCN Phong Dien va Thuan Thanh I chua tung lo ra trong HES.
WAREHOUSES = [
    {"code": "809", "name": "Kho vật tư KCN Tiền Hải", "zone": "KCNTH"},
    {"code": "810", "name": "Kho vật tư KCN Số 3", "zone": "KCN03"},
    {"code": "857", "name": "Kho vật tư KCN Yên Mỹ", "zone": "KCNYM"},
    {"code": "KHO-KCNPD", "name": "Kho vật tư KCN Phong Điền", "zone": "KCNPĐ"},
    {"code": "KHO-KCNTTI", "name": "Kho vật tư KCN Thuận Thành I", "zone": "KCNTTI"},
]


def manufacture_year(serial: str):
    """2 chu so dau serial = nam SX (user chot 03/08). 2410320616 -> 2024.

    KHONG doan bua: serial khong bat dau bang 2 chu so, hoac nam suy ra o
    tuong lai / truoc 2000 => tra None + ly do, de nguoi dung nhap tay.
    """
    s = (serial or "").strip()
    if len(s) < 2 or not s[:2].isdigit():
        return None, "serial khong bat dau bang 2 chu so"
    y = 2000 + int(s[:2])
    now = dt.date.today().year
    if y > now:
        return None, f"nam suy ra {y} o tuong lai"
    if y < 2000:
        return None, f"nam suy ra {y} khong hop ly"
    return y, ""


METER_TYPES = {"ME41", "ME42", "DTS27"}
NO_CALIBRATION = {"GP03", "SIM"}


def meter_type(model_desc: str) -> str:
    """Suy loai cong to tu model. Khop voi ASSET_TYPES trong catalog_schema."""
    m = (model_desc or "").upper().replace("-", "").replace(" ", "")
    if "ME41" in m:
        return "ME41"
    if "ME42" in m:
        return "ME42"
    if "DTS27" in m:
        return "DTS27"
    return "KHAC"


def next_calibration(year: int, asset_type: str):
    """Cong to 3 nam, TI/TU 5 nam, GP03/SIM khong kiem dinh (user chot 03/08)."""
    if asset_type in NO_CALIBRATION or year is None:
        return None
    span = 3 if asset_type in METER_TYPES else 5
    return f"{year + span}-01-01"


def earliest_invoice(token: str) -> dict:
    """{SCT: ngay StartDate som nhat} - dung uoc luong ngay bat dau treo."""
    best = {}
    page = 1
    while True:
        r = pb.req("GET",
            f"{pb.PB_URL}/api/collections/invoice/records",
            params={"page": page, "perPage": 500, "fields": "SCT,StartDate,EndDate"},
            headers=pb.headers(token), timeout=pb.TIMEOUT,
        )
        r.raise_for_status()
        d = r.json()
        for it in d["items"]:
            sct = (it.get("SCT") or "").strip()
            day = (it.get("StartDate") or it.get("EndDate") or "")[:10]
            if not (sct and day):
                continue
            if sct not in best or day < best[sct]:
                best[sct] = day
        if page >= d.get("totalPages", 1):
            break
        page += 1
    return best


def build(token: str):
    rows = sc.read_meterinfo()
    first_bill = earliest_invoice(token)
    today = dt.date.today().isoformat()

    # Diem do cua tung cong to (giong logic task 3/4: LINE_ID, roi LINE_NAME)
    name_to_lid = {}
    for r in rows:
        if r["LINE_ID"] and r["LINE_ID"] not in sc.WAREHOUSE_LINE_IDS and r["LINE_NAME"]:
            name_to_lid.setdefault(r["LINE_NAME"], r["LINE_ID"])

    assets, installs = {}, []
    no_year, est_date, in_wh, orphan = [], [], [], []

    name_fallback = []
    for r in rows:
        serial = r["METER_NO"].strip()
        if not serial or serial in assets:
            continue
        lid = r["LINE_ID"]
        if not lid:
            # Thieu LINE_ID -> thu khop theo LINE_NAME, NHUNG chi khi la cong to
            # CHINH. Cong to PHU thuoc mot diem do phu rieng; gan no vao diem do
            # chinh se lam diem do do co 2 cong to (vi pham rang buoc LOI #1) va
            # lam sai HSN. Da gap that: 2410320616 (phu) bi khop vao diem do 108
            # von da co cong to chinh 2610170783.
            cand = name_to_lid.get(r["LINE_NAME"], "")
            if cand and r.get("ROLE") == "chinh":
                lid = cand
            elif cand:
                name_fallback.append((serial, r.get("ROLE"), r["LINE_NAME"], cand))
        year, why = manufacture_year(serial)
        if year is None:
            no_year.append((serial, why))

        atype = meter_type(r.get("METER_MODEL_DESC", ""))
        a = {
            "serial": serial, "type": atype,
            "model_desc": r.get("METER_MODEL_DESC", ""),
            "manufacture_year": year,
            "next_calibration": next_calibration(year, atype),
            "hes_seen": True,
            "_warehouse": "", "_point": "",
        }

        if lid in sc.WAREHOUSE_LINE_IDS:
            a["current_status"] = "kho"
            a["_warehouse"] = lid
            in_wh.append(serial)
        elif lid:
            a["current_status"] = "dang_treo"
            a["_point"] = lid
            start = first_bill.get(serial)
            if not start:
                start = today
                est_date.append(serial)
            installs.append({
                "serial": serial, "point": lid, "from_date": start,
                "is_current": True, "estimated": serial in est_date,
            })
        else:
            # Khong ro vi tri: de trang thai kho nhung khong gan kho nao
            a["current_status"] = "kho"
            orphan.append(serial)

        assets[serial] = a

    return {
        "assets": assets, "installs": installs, "no_year": no_year,
        "est_date": est_date, "in_wh": in_wh, "orphan": orphan,
        "name_fallback": name_fallback,
    }


def report(d: dict):
    a = d["assets"]
    by_status = defaultdict(int)
    by_year = defaultdict(int)
    for x in a.values():
        by_status[x["current_status"]] += 1
        by_year[x["manufacture_year"]] += 1

    print()
    print("=== SO LUONG SE TAO ===")
    print(f"  vt_warehouse : {len(WAREHOUSES)}")
    print(f"  vt_asset     : {len(a)}  " + str(dict(Counter(x['type'] for x in a.values()))))
    print(f"  vt_install   : {len(d['installs'])}  (cong to dang treo tren diem do)")
    print(f"  vt_event     : {len(a)}  (DUNG 1 event khoi tao / cong to)")
    print(f"  Trang thai   : {dict(by_status)}")

    print()
    print("=== NAM SAN XUAT (2 chu so dau serial) ===")
    for y in sorted(k for k in by_year if k):
        span = "het han" if y + 3 < dt.date.today().year else ""
        print(f"    {y}: {by_year[y]:>3} cong to  {span}")
    exp = [x["serial"] for x in a.values()
           if x["manufacture_year"] and x["manufacture_year"] + 3 < dt.date.today().year]
    print(f"  Cong to QUA HAN kiem dinh (SX + 3 nam < {dt.date.today().year}): {len(exp)}")

    print()
    print("=== CANH BAO ===")
    print(f"  Khong suy duoc nam SX: {len(d['no_year'])}")
    for s, why in d["no_year"][:10]:
        print(f"      {s}  ({why})")
    print(f"  Ngay treo PHAI UOC LUONG (khong co hoa don) -> lay ngay hom nay: {len(d['est_date'])}")
    if d["est_date"]:
        print(f"      {d['est_date'][:12]}")
    print(f"  Cong to nam trong kho thao: {len(d['in_wh'])}")
    print(f"  Cong to khong ro vi tri   : {len(d['orphan'])} {d['orphan'][:10]}")
    print(f"  Cong to PHU thieu LINE_ID -> KHONG tu gan (cho gan tay): {len(d['name_fallback'])}")
    for s2, role, ln, cand in d["name_fallback"]:
        print(f"      {s2}  ROLE={role}  ten='{ln}'  (diem do chinh trung ten: {cand})")


def write(token: str, d: dict):
    print()
    print("=== GHI THAT LEN POCKETBASE ===")
    zone_ids = sc.existing_by(token, "dm_zone", "code")
    point_ids = sc.existing_by(token, "dm_point", "line_id")

    wh = [{"code": w["code"], "name": w["name"],
           "zone": zone_ids.get(w["zone"], ""), "active": True} for w in WAREHOUSES]
    wh_ids = sc.seed_one(token, "vt_warehouse", "code", wh, "vt_warehouse")

    assets = []
    for x in d["assets"].values():
        body = {k: v for k, v in x.items()
                if not k.startswith("_") and v not in (None, "")}
        if x["_warehouse"]:
            body["current_warehouse"] = wh_ids.get(x["_warehouse"], "")
        if x["_point"]:
            body["current_point"] = point_ids.get(x["_point"], "")
        assets.append(body)
    asset_ids = sc.seed_one(token, "vt_asset", "serial", assets, "vt_asset")

    # vt_install - khoa idempotent (serial, from_date)
    have = set()
    page = 1
    while True:
        r = pb.req("GET", f"{pb.PB_URL}/api/collections/vt_install/records",
                   params={"page": page, "perPage": 500, "fields": "serial,from_date"},
                   headers=pb.headers(token), timeout=pb.TIMEOUT)
        r.raise_for_status(); dd = r.json()
        for it in dd["items"]:
            have.add((it["serial"], (it.get("from_date") or "")[:10]))
        if page >= dd.get("totalPages", 1):
            break
        page += 1

    made = 0
    for ins in d["installs"]:
        if (ins["serial"], ins["from_date"]) in have:
            continue
        pid = point_ids.get(ins["point"])
        aid = asset_ids.get(ins["serial"])
        if not (pid and aid):
            continue
        sc.create(token, "vt_install", {
            "asset": aid, "serial": ins["serial"], "type": d["assets"][ins["serial"]]["type"],
            "point": pid, "from_date": ins["from_date"], "is_current": True,
            "note": SEED_NOTE + (" - ngay treo UOC LUONG" if ins["estimated"] else " - ngay theo hoa don som nhat"),
        })
        made += 1
        if made % 25 == 0:
            print(f"    ... {made}")
    print(f"  {'vt_install':14} tao moi {made}  |  da co san {len(have)}")

    # vt_event - DUNG 1 event khoi tao moi asset
    have_ev = set()
    page = 1
    while True:
        r = pb.req("GET", f"{pb.PB_URL}/api/collections/vt_event/records",
                   params={"page": page, "perPage": 500, "fields": "serial,event"},
                   headers=pb.headers(token), timeout=pb.TIMEOUT)
        r.raise_for_status(); dd = r.json()
        for it in dd["items"]:
            have_ev.add(it["serial"])
        if page >= dd.get("totalPages", 1):
            break
        page += 1

    install_by_serial = {i["serial"]: i for i in d["installs"]}
    made_ev = 0
    for serial, x in d["assets"].items():
        if serial in have_ev:
            continue
        aid = asset_ids.get(serial)
        if not aid:
            continue
        if x["_point"]:
            ins = install_by_serial.get(serial, {})
            body = {"asset": aid, "serial": serial, "event": "treo",
                    "to_point": point_ids.get(x["_point"], ""),
                    "at": ins.get("from_date") or dt.date.today().isoformat()}
        else:
            body = {"asset": aid, "serial": serial, "event": "nhap_kho",
                    "at": dt.date.today().isoformat()}
            if x["_warehouse"]:
                body["to_warehouse"] = wh_ids.get(x["_warehouse"], "")
        body["note"] = SEED_NOTE
        sc.create(token, "vt_event", body)
        made_ev += 1
        if made_ev % 25 == 0:
            print(f"    ... {made_ev}")
    print(f"  {'vt_event':14} tao moi {made_ev}  |  da co san {len(have_ev)}")


def verify(token: str, d: dict):
    print()
    print("=== KIEM CHUNG (doc lai tu API) ===")
    want = {"vt_warehouse": len(WAREHOUSES), "vt_asset": len(d["assets"]),
            "vt_install": len(d["installs"]), "vt_event": len(d["assets"])}
    ok = True
    for c, n in want.items():
        got = pb.count_records(token, c)
        if got != n:
            ok = False
        print(f"  {c:14} mong doi {n:>4}  thuc te {got:>4}  {'OK' if got == n else 'LECH'}")

    # Moi diem do chi duoc co 1 cong to is_current (rang buoc LOI #1)
    r = pb.req("GET", f"{pb.PB_URL}/api/collections/vt_install/records",
               params={"perPage": 500, "filter": 'is_current=true && (type="ME41" || type="ME42" || type="DTS27")',
                       "fields": "point,serial"},
               headers=pb.headers(token), timeout=pb.TIMEOUT)
    per = defaultdict(list)
    for it in r.json()["items"]:
        per[it["point"]].append(it["serial"])
    dup = {k: v for k, v in per.items() if len(v) > 1}
    print(f"  Diem do co >1 cong to dang treo: {len(dup)} (phai = 0)")
    for k, v in list(dup.items())[:10]:
        print(f"      {k}: {v}")
    if dup:
        ok = False
    print()
    print("KET QUA: " + ("dung het" if ok else "CO LECH - xem dong tren"))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
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

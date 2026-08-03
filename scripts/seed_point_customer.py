"""Task 4 (plan 2026-08-03-mo-hinh-danh-muc-va-kho-vat-tu.md):
seed dm_point_customer - KY khach hang tren tung diem do.

Cach suy ky (chot trong plan):
  Toan bo invoice (KHONG gioi han thoi gian) -> nhom theo SCT (so cong to)
  -> sap theo EndDate tang -> MKHang doi thi DONG ky cu, MO ky moi
  -> anh xa SCT sang diem do qua metterinfo.csv (LINE_ID)
  -> gop ky cua nhieu cong to tren CUNG mot diem do neu cung khach & giao/ke nhau

CHOT CHAN: neu mot SCT co >=2 MKHang voi khoang thoi gian GIAO NHAU
=> tao ky SONG SONG + shared=true, KHONG ep thanh chuoi tuan tu.
Ep tuan tu se sinh ra lich su sai mot cach am tham.

Cach dung:
  python scripts/seed_point_customer.py --dry-run
  python scripts/seed_point_customer.py
"""

import argparse
import sys
from collections import defaultdict

import pb_client as pb
import seed_catalog as sc


def day(v: str) -> str:
    """'2023-11-30 00:00:00.000Z' -> '2023-11-30'. Rong -> ''."""
    return (v or "")[:10]


def load_invoices(token: str) -> list:
    out = []
    page = 1
    while True:
        r = pb.req("GET",
            f"{pb.PB_URL}/api/collections/invoice/records",
            params={"page": page, "perPage": 500, "fields": "SCT,MKHang,StartDate,EndDate"},
            headers=pb.headers(token), timeout=pb.TIMEOUT,
        )
        r.raise_for_status()
        d = r.json()
        out.extend(d["items"])
        if page >= d.get("totalPages", 1):
            break
        page += 1
    return out


def periods_per_meter(invoices: list):
    """{SCT: [ {mkh, from, to, n_bill} ]} + danh sach SCT co ky giao nhau."""
    by_sct = defaultdict(list)
    for it in invoices:
        sct = (it.get("SCT") or "").strip()
        mkh = (it.get("MKHang") or "").strip()
        end = day(it.get("EndDate"))
        if not (sct and mkh and end):
            continue
        by_sct[sct].append({"mkh": mkh, "start": day(it.get("StartDate")) or end, "end": end})

    out, overlapped = {}, []
    for sct, bills in by_sct.items():
        bills.sort(key=lambda b: (b["end"], b["start"]))
        runs = []
        for b in bills:
            if runs and runs[-1]["mkh"] == b["mkh"]:
                runs[-1]["to"] = max(runs[-1]["to"], b["end"])
                runs[-1]["from"] = min(runs[-1]["from"], b["start"])
                runs[-1]["n_bill"] += 1
            else:
                runs.append({"mkh": b["mkh"], "from": b["start"], "to": b["end"], "n_bill": 1})

        # Phat hien GIAO NHAU giua cac khach khac nhau tren cung mot cong to
        for i, a in enumerate(runs):
            for b in runs[i + 1:]:
                if a["mkh"] != b["mkh"] and a["from"] <= b["to"] and b["from"] <= a["to"]:
                    overlapped.append((sct, a["mkh"], b["mkh"], a["from"], a["to"], b["from"], b["to"]))
        out[sct] = runs
    return out, overlapped


def merge_runs(runs: list) -> list:
    """Gop cac ky CUNG khach neu giao hoac ke nhau. runs: [{mkh,from,to,n_bill}]"""
    by_mkh = defaultdict(list)
    for r in runs:
        by_mkh[r["mkh"]].append(r)
    out = []
    for mkh, items in by_mkh.items():
        items.sort(key=lambda x: x["from"])
        cur = dict(items[0])
        for nxt in items[1:]:
            if nxt["from"] <= cur["to"]:          # giao nhau
                cur["to"] = max(cur["to"], nxt["to"])
                cur["n_bill"] += nxt["n_bill"]
            else:
                out.append(cur)
                cur = dict(nxt)
        out.append(cur)
    return sorted(out, key=lambda x: x["from"])


def build(token: str):
    invoices = load_invoices(token)
    per_meter, overlapped = periods_per_meter(invoices)

    # SCT -> line_id, lay tu metterinfo.csv (cung nguon voi task 3)
    rows = sc.read_meterinfo()
    name_to_lid = {}
    for r in rows:
        if r["LINE_ID"] and r["LINE_ID"] not in sc.WAREHOUSE_LINE_IDS and r["LINE_NAME"]:
            name_to_lid.setdefault(r["LINE_NAME"], r["LINE_ID"])
    meter_to_point, in_warehouse = {}, set()
    for r in rows:
        lid = r["LINE_ID"] or name_to_lid.get(r["LINE_NAME"], "")
        if not lid:
            continue
        if lid in sc.WAREHOUSE_LINE_IDS:
            in_warehouse.add(r["METER_NO"])
            continue
        meter_to_point[r["METER_NO"]] = lid

    # Gop ky theo (diem do, khach)
    by_point = defaultdict(list)
    no_point, no_invoice_meters = [], []
    for sct, runs in per_meter.items():
        lid = meter_to_point.get(sct)
        if not lid:
            no_point.append((sct, sct in in_warehouse))
            continue
        by_point[lid].extend(runs)
    for m in meter_to_point:
        if m not in per_meter:
            no_invoice_meters.append(m)

    periods = {}
    for lid, runs in by_point.items():
        periods[lid] = merge_runs(runs)

    # shared: diem do co >=2 khach voi khoang GIAO NHAU
    shared_points = set()
    for lid, ps in periods.items():
        for i, a in enumerate(ps):
            for b in ps[i + 1:]:
                if a["mkh"] != b["mkh"] and a["from"] <= b["to"] and b["from"] <= a["to"]:
                    shared_points.add(lid)

    return {
        "periods": periods, "overlapped": overlapped, "shared_points": shared_points,
        "no_point": no_point, "no_invoice_meters": no_invoice_meters,
        "meter_to_point": meter_to_point, "n_invoice": len(invoices),
    }


def report(d: dict):
    periods = d["periods"]
    total = sum(len(v) for v in periods.values())
    multi = {k: v for k, v in periods.items() if len({x["mkh"] for x in v}) > 1}
    print()
    print("=== SO LUONG SE TAO ===")
    print(f"  Da doc {d['n_invoice']} hoa don")
    print(f"  dm_point_customer : {total} ky  tren {len(periods)} diem do")
    print(f"  Diem do co >1 khach theo thoi gian: {len(multi)}")
    for lid, ps in list(multi.items())[:12]:
        print(f"      diem do {lid}:")
        for p in ps:
            print(f"          {p['mkh']:16} {p['from']} -> {p['to']}  ({p['n_bill']} hoa don)")

    print()
    print("=== KIEM CHUNG THEO PLAN ===")
    for sct in ("2410320615", "2410131380", "2410131387"):
        lid = d["meter_to_point"].get(sct)
        ps = periods.get(lid, []) if lid else []
        who = sorted({p["mkh"] for p in ps})
        print(f"  Cong to {sct} -> diem do {lid or '(khong co)'}: {len(ps)} ky, khach {who}")

    print()
    print("=== CANH BAO ===")
    print(f"  Diem do DUNG CHUNG (ky giao nhau, shared=true): {len(d['shared_points'])}")
    for lid in sorted(d["shared_points"]):
        for p in periods[lid]:
            print(f"      diem do {lid}: {p['mkh']:16} {p['from']} -> {p['to']}")
    print(f"  Cong to co hoa don nhung KHONG gan duoc diem do: {len(d['no_point'])}")
    for sct, in_wh in d["no_point"][:15]:
        print(f"      {sct}{'  (dang o kho thao)' if in_wh else '  (khong co trong metterinfo)'}")
    print(f"  Cong to co diem do nhung CHUA co hoa don nao: {len(d['no_invoice_meters'])}")
    if d["no_invoice_meters"]:
        print(f"      {d['no_invoice_meters'][:12]}")


def write(token: str, d: dict):
    print()
    print("=== GHI THAT LEN POCKETBASE ===")
    point_ids = sc.existing_by(token, "dm_point", "line_id")
    cus_ids = sc.existing_by(token, "dm_customer", "mkh")

    # Khoa idempotent: point|mkh|from_date
    have = set()
    page = 1
    while True:
        r = pb.req("GET",
            f"{pb.PB_URL}/api/collections/dm_point_customer/records",
            params={"page": page, "perPage": 500, "fields": "point,mkh,from_date"},
            headers=pb.headers(token), timeout=pb.TIMEOUT,
        )
        r.raise_for_status()
        dd = r.json()
        for it in dd["items"]:
            have.add((it["point"], it["mkh"], (it.get("from_date") or "")[:10]))
        if page >= dd.get("totalPages", 1):
            break
        page += 1

    made = skipped = miss_cus = 0
    for lid, ps in d["periods"].items():
        pid = point_ids.get(lid)
        if not pid:
            continue
        last_to = max(p["to"] for p in ps)
        for p in ps:
            cid = cus_ids.get(p["mkh"])
            if not cid:
                miss_cus += 1
                continue
            key = (pid, p["mkh"], p["from"])
            if key in have:
                skipped += 1
                continue
            sc.create(token, "dm_point_customer", {
                "point": pid, "customer": cid, "mkh": p["mkh"],
                "from_date": p["from"], "to_date": p["to"],
                "is_current": p["to"] == last_to,
                "shared": lid in d["shared_points"],
            })
            made += 1
            if made % 25 == 0:
                print(f"    ... {made}")
    print(f"  dm_point_customer  tao moi {made}  |  da co san {skipped}  |  bo qua (thieu khach) {miss_cus}")


def verify(token: str, d: dict):
    print()
    print("=== KIEM CHUNG (doc lai tu API) ===")
    want = sum(len(v) for v in d["periods"].values())
    got = pb.count_records(token, "dm_point_customer")
    print(f"  dm_point_customer  mong doi {want}  thuc te {got}  {'OK' if got == want else 'LECH'}")

    r = pb.req("GET",
        f"{pb.PB_URL}/api/collections/dm_point_customer/records",
        params={"perPage": 500, "filter": "is_current=true"},
        headers=pb.headers(token), timeout=pb.TIMEOUT,
    )
    cur = r.json()
    by_point = defaultdict(int)
    for it in cur["items"]:
        by_point[it["point"]] += 1
    dup = {k: v for k, v in by_point.items() if v > 1}
    print(f"  Ky is_current: {cur['totalItems']} tren {len(by_point)} diem do")
    print(f"  Diem do co >1 ky is_current: {len(dup)} (chi chap nhan khi shared=true)")
    return got == want


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

"""Task 1 cua plan 2026-08-03-mo-hinh-danh-muc-va-kho-vat-tu.md

BACKUP toan bo PocketBase (schema + record) truoc khi dung den schema,
va liet ke collection hien co kem so record de quyet dinh don dep.

Cach dung:
  # 1) Backup + liet ke (KHONG ghi gi len PocketBase)
  python scripts/build_catalog.py --dump-schema

  # 2) Chi liet ke nhanh, khong tai record
  python scripts/build_catalog.py --list

  # 3) Xoa collection cu (chi chay SAU khi da co file backup chua du lieu do)
  python scripts/build_catalog.py --purge ten1,ten2 --yes-i-mean-it

Bien moi truong: PB_URL, PB_EMAIL, PB_PASS (xem scripts/pb_client.py).
"""

import argparse
import datetime as dt
import json
import os
import sys

import requests

import catalog_schema as cs
import pb_client as pb

DEFAULT_OUT_DIR = "backup"


def human(n: int) -> str:
    return "?" if n < 0 else f"{n:,}".replace(",", ".")


def cmd_list(token: str):
    cols = pb.list_collections(token)
    rows = []
    for c in cols:
        name = c.get("name", "")
        if name.startswith("_"):
            continue
        rows.append((name, c.get("type", ""), pb.count_records(token, name)))
    rows.sort(key=lambda r: r[0].lower())

    width = max([len(r[0]) for r in rows] + [10])
    print()
    print(f"{'COLLECTION'.ljust(width)}  {'TYPE'.ljust(6)}  {'RECORDS':>9}  GHI CHU")
    print("-" * (width + 32))
    for name, ctype, cnt in rows:
        note = "DANG DUNG (bao ve)" if name in pb.PROTECTED else ""
        print(f"{name.ljust(width)}  {ctype.ljust(6)}  {human(cnt):>9}  {note}")
    print("-" * (width + 32))
    print(f"Tong: {len(rows)} collection (chua tinh collection he thong _*)")
    return rows


def cmd_dump(token: str, out_path: str):
    cols = pb.list_collections(token)
    payload = {
        "exported_at": dt.datetime.now().isoformat(timespec="seconds"),
        "pb_url": pb.PB_URL,
        "collections": [],
    }

    for c in cols:
        name = c.get("name", "")
        entry = {
            "name": name,
            "id": c.get("id"),
            "type": c.get("type"),
            "system": c.get("system", False),
            "fields": c.get("fields") or c.get("schema"),
            "listRule": c.get("listRule"),
            "viewRule": c.get("viewRule"),
            "createRule": c.get("createRule"),
            "updateRule": c.get("updateRule"),
            "deleteRule": c.get("deleteRule"),
            "indexes": c.get("indexes"),
            "records": [],
        }
        # Khong dump record cua collection he thong (_superusers chua hash mat khau)
        if not name.startswith("_"):
            print(f"  tai record: {name} ...", end="", flush=True)
            entry["records"] = pb.list_records(token, name)
            print(f" {len(entry['records'])}")
        payload["collections"].append(entry)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    size = os.path.getsize(out_path)
    total_rec = sum(len(c["records"]) for c in payload["collections"])
    print()
    print(f"Da ghi: {out_path}")
    print(f"  {len(payload['collections'])} collection, {total_rec} record, {size/1024:.1f} KB")
    return out_path


def backup_contains(path: str, names: list) -> list:
    """Tra ve danh sach ten CHUA co trong file backup."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    have = {c["name"] for c in data.get("collections", [])}
    return [n for n in names if n not in have]


def cmd_purge(token: str, names: list, backup_path: str, confirmed: bool):
    if not confirmed:
        sys.exit("Thieu --yes-i-mean-it. Xoa collection KHONG hoan tac duoc.")

    blocked = [n for n in names if n in pb.PROTECTED or n.startswith("_")]
    if blocked:
        sys.exit(f"TU CHOI: cac collection dang duoc he thong dung: {', '.join(blocked)}")

    if not backup_path or not os.path.exists(backup_path):
        sys.exit(
            "Chua co file backup. Chay '--dump-schema' truoc, roi truyen --backup <duong-dan>.\n"
            "Chan cung theo plan: khong backup thi khong xoa."
        )

    missing = backup_contains(backup_path, names)
    if missing:
        sys.exit(
            "File backup KHONG chua cac collection sau => khong duoc xoa: "
            + ", ".join(missing)
        )

    for n in names:
        print(f"  xoa {n} ...", end="", flush=True)
        pb.delete_collection(token, n)
        print(" xong")
    print(f"\nDa xoa {len(names)} collection. Backup con o: {backup_path}")


def cmd_create_schema(token: str, dry_run: bool):
    """Tao 9 collection moi. Idempotent: da co thi bo qua, khong ghi de.

    KHONG dung den collection cu - moi ten deu co tien to dm_/vt_.
    """
    existing = {c["name"]: c for c in pb.list_collections(token)}
    ids = {n: c["id"] for n, c in existing.items()}

    created, skipped = [], []
    for entry in cs.SCHEMA:
        name = entry["name"]
        if name in existing:
            skipped.append(name)
            print(f"  [BO QUA] {name} - da ton tai")
            ids[name] = existing[name]["id"]
            continue

        # Doi _target (ten collection) sang collectionId that
        fields = []
        for f in entry["fields"]:
            f = dict(f)
            target = f.pop("_target", None)
            if target:
                if target not in ids:
                    sys.exit(
                        f"Loi thu tu: '{name}.{f['name']}' tro toi '{target}' nhung "
                        f"'{target}' chua duoc tao. Sua thu tu trong catalog_schema.SCHEMA."
                    )
                f["collectionId"] = ids[target]
            fields.append(f)

        body = {
            "name": name,
            "type": "base",
            "fields": fields,
            "indexes": entry.get("indexes", []),
            **cs.rules_for(entry),
        }

        if dry_run:
            rl = cs.rules_for(entry)
            print(f"  [DRY-RUN] tao {name}: {len(fields)} field, "
                  f"{len(entry.get('indexes', []))} index, "
                  f"write={'superuser' if rl['updateRule'] is None else 'kinh doanh'}")
            ids[name] = f"<dry-run-{name}>"
            created.append(name)
            continue

        r = pb.req("POST",
            f"{pb.PB_URL}/api/collections",
            json=body,
            headers=pb.headers(token),
            timeout=pb.TIMEOUT,
        )
        if not r.ok:
            sys.exit(f"Tao '{name}' that bai: HTTP {r.status_code}\n{r.text[:800]}")
        ids[name] = r.json()["id"]
        created.append(name)
        print(f"  [TAO]    {name} - {len(fields)} field")

    print()
    print(f"Tao moi: {len(created)}  |  Bo qua (da co): {len(skipped)}")
    return created


def cmd_verify_schema(token: str):
    """Doc lai tung collection tu API - khong tin ket qua cua buoc tao."""
    existing = {c["name"]: c for c in pb.list_collections(token)}
    ok = True
    print()
    print(f"{'COLLECTION'.ljust(20)} {'FIELD':>6} {'INDEX':>6}  CREATE / UPDATE RULE")
    print("-" * 78)
    for entry in cs.SCHEMA:
        name = entry["name"]
        c = existing.get(name)
        if not c:
            print(f"{name.ljust(20)} {'--':>6} {'--':>6}  THIEU")
            ok = False
            continue
        want = {f["name"] for f in entry["fields"]}
        have = {f["name"] for f in c.get("fields", [])}
        missing = want - have
        rl = cs.rules_for(entry)
        upd = "superuser" if rl["updateRule"] is None else "kinh doanh"
        mark = "" if not missing else f"  THIEU FIELD: {sorted(missing)}"
        if missing:
            ok = False
        print(f"{name.ljust(20)} {len(have):>6} {len(c.get('indexes', [])):>6}  "
              f"{'kinh doanh'} / {upd}{mark}")
    print("-" * 78)
    print("KET QUA: " + ("dung du 9 collection" if ok else "CO SAI SOT - xem dong THIEU o tren"))
    return ok


def main():
    ap = argparse.ArgumentParser(description="Backup / liet ke / don dep collection PocketBase")
    ap.add_argument("--dump-schema", action="store_true", help="Backup schema + toan bo record ra JSON")
    ap.add_argument("--list", action="store_true", help="Chi liet ke collection + so record")
    ap.add_argument("--purge", default="", help="Danh sach collection can xoa, cach nhau bang dau phay")
    ap.add_argument("--backup", default="", help="Duong dan file backup (bat buoc khi --purge)")
    ap.add_argument("--yes-i-mean-it", dest="confirmed", action="store_true", help="Xac nhan xoa")
    ap.add_argument("--out", default="", help="Duong dan file backup dau ra")
    ap.add_argument("--create-schema", action="store_true", help="Tao 9 collection moi (dm_*, vt_*)")
    ap.add_argument("--verify-schema", action="store_true", help="Doc lai tu API va doi chieu")
    ap.add_argument("--dry-run", action="store_true", help="Chi in ra se lam gi, khong ghi")
    args = ap.parse_args()

    if not (args.dump_schema or args.list or args.purge or args.create_schema or args.verify_schema):
        ap.print_help()
        return

    token = pb.login()
    print(f"Da dang nhap {pb.PB_URL}")

    if args.list:
        cmd_list(token)

    out_path = args.out
    if args.dump_schema:
        if not out_path:
            stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
            out_path = os.path.join(DEFAULT_OUT_DIR, f"pb-backup-{stamp}.json")
        cmd_dump(token, out_path)
        cmd_list(token)

    if args.create_schema:
        cmd_create_schema(token, args.dry_run)
        if not args.dry_run:
            cmd_verify_schema(token)

    if args.verify_schema and not args.create_schema:
        cmd_verify_schema(token)

    if args.purge:
        names = [n.strip() for n in args.purge.split(",") if n.strip()]
        cmd_purge(token, names, args.backup or out_path, args.confirmed)


if __name__ == "__main__":
    main()

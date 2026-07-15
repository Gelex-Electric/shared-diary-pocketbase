#!/usr/bin/env python3
"""Backfill MOT LAN: nap toan bo public/transformer_loss_daily.csv vao collection
PocketBase `tloss_daily` (de PB = CSV cho giai doan pilot Task 1).

- Idempotent: bo qua record da co (theo khoa code+date).
- Ghi song song (ThreadPoolExecutor) vi instance tat Batch API — tranh doi tuan tu.
- KHONG dung trong pipeline hang ngay (do daily_transformer_loss.py dual-write lo).

Chay:
  PB_URL=... PB_EMAIL=... PB_PASS=... python scripts/backfill_tloss_daily.py
"""
import csv
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

from pb_client import PBClient, _request

CSV_PATH = os.environ.get("DAILY_OUT_PATH", "public/transformer_loss_daily.csv")
WORKERS = int(os.environ.get("BACKFILL_WORKERS", "12"))


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def main():
    if not os.path.isfile(CSV_PATH):
        sys.exit(f"Khong tim thay {CSV_PATH}.")
    pb = PBClient()
    token = pb.token
    base = f"{pb.url}/api/collections/tloss_daily/records"

    existing = pb._existing_map("tloss_daily", ("code", "date"))
    print(f"tloss_daily hien co: {len(existing)} record.")

    todo = []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            code, date = r.get("CODE", "").strip(), r.get("DATE", "").strip()
            if not code or not date:
                continue
            if (code, date) in existing:
                continue
            todo.append({
                "code": code,
                "line_name": r.get("LINE_NAME", ""),
                "date": date,
                "output_kwh": num(r.get("OUTPUT_KWH")),
                "loss_noload_kwh": num(r.get("LOSS_NOLOAD_KWH")),
                "loss_load_kwh": num(r.get("LOSS_LOAD_KWH")),
                "loss_kwh": num(r.get("LOSS_KWH")),
                "loss_pct": num(r.get("LOSS_PCT")),
                "max_load_pct": num(r.get("MAX_LOAD_PCT")),
                "avg_load_pct": num(r.get("AVG_LOAD_PCT")),
                "n_intervals": int(num(r.get("N_INTERVALS"))),
                "output_src": r.get("OUTPUT_SRC", ""),
            })
    print(f"Can nap moi: {len(todo)} record (bo qua {len(existing)} da co).")
    if not todo:
        return

    ok = err = 0
    errors = []

    def post(row):
        _request("POST", base, token=token, payload=row)

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(post, row): row for row in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                fut.result()
                ok += 1
            except Exception as e:  # noqa: BLE001
                err += 1
                if len(errors) < 5:
                    errors.append(str(e))
            if i % 1000 == 0:
                print(f"  ... {i}/{len(todo)} (ok={ok} err={err})")

    print(f"Xong: nap {ok} record, loi {err}.")
    for e in errors:
        print("  [ERR]", e[:200])
    if err:
        sys.exit(1)


if __name__ == "__main__":
    main()

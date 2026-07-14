#!/usr/bin/env python3
"""Backfill transformer_loss_daily.csv (va monthly) tu BF_START den BF_END.

Voi moi ngay chua co trong transformer_loss_daily.csv (resume tu nhien — chay lai
an toan, khong lam lai ngay da xong):
  1) fetch_hes_index.py     TARGET_DATE=D   -> ghi thang vao hes_index_daily.csv
  2) fetch_meter_data.py    TARGET_DATE=D, ROLE_FILTER=chinh, DATAMETTER_PATH=file
     tam -> KHONG dung public/datametter.csv (rolling 7 ngay cho dashboard Dien ap)
  3) daily_transformer_loss.py TARGET_DATE=D DATAMETTER_PATH=file tam
  4) xoa file tam

Token thuc te song rat ngan (~1 phut du truong TOKEN_EXPIRED bao con den ngay hom
sau) -> dang nhap lai TRUOC MOI ngay cho fetch_meter_data.py; neu van het han giua
chung (subprocess bao "TOKEN_EXPIRED") thi dang nhap lai va thu them 1 lan.

Sau khi het vong lap: chay monthly_transformer_loss.py mot lan.

Bien moi truong:
  BF_START, BF_END   (YYYY-MM-DD, mac dinh 2026-01-01 .. ngay truoc ngay som nhat
                       da co trong transformer_loss_daily.csv, hoac 2026-07-01)
  API_USER, API_PASS  bat buoc (dang nhap that)
"""
import csv
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta

import requests

BASE_URL = "http://14.225.244.63:8899/api"
DAILY_OUT_PATH = "public/transformer_loss_daily.csv"
STAGING_PATH = "public/_backfill_datametter.csv"
LOG_PATH = os.environ.get("BF_LOG", "logs/_backfill_progress.log")

PY = sys.executable


def log(msg: str):
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def existing_dates() -> set:
    if not os.path.isfile(DAILY_OUT_PATH):
        return set()
    with open(DAILY_OUT_PATH, newline="", encoding="utf-8") as f:
        return {row.get("DATE", "").strip() for row in csv.DictReader(f)}


def daterange(start: str, end: str):
    d0 = datetime.strptime(start, "%Y-%m-%d").date()
    d1 = datetime.strptime(end, "%Y-%m-%d").date()
    d = d0
    while d <= d1:
        yield d.isoformat()
        d += timedelta(days=1)


def login() -> str:
    user = os.environ.get("API_USER", "")
    pw = os.environ.get("API_PASS", "")
    if not (user and pw):
        sys.exit("Thieu API_USER/API_PASS.")
    r = requests.get(f"{BASE_URL}/Login", params={"UserAccount": user, "Password": pw}, timeout=30)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, list):
        data = data[0] if data else {}
    if str(data.get("CODE")) != "1":
        sys.exit(f"Login failed: {data.get('MESSAGE')}")
    log(f"Dang nhap OK, token het han {data.get('TOKEN_EXPIRED')}")
    return data["TOKEN"]


def run(cmd, env):
    r = subprocess.run(cmd, env=env, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def process_day(day: str) -> bool:
    base_env = {**os.environ}

    # 1) Chi so HES (ghi thang, tu login rieng — luon fresh, khong lo het han)
    rc, out, err = run(
        [PY, "scripts/fetch_hes_index.py"],
        {**base_env, "TARGET_DATE": day},
    )
    if rc != 0:
        log(f"  [LOI] fetch_hes_index {day}: rc={rc} {err[-400:]}")
        return False

    # 2) P,Q tuc thoi -> file tam (chi cong to chinh). Token thuc te song rat ngan
    # (~1 phut, khong nhu truong TOKEN_EXPIRED bao) -> LUON dang nhap moi ngay ngay
    # truoc khi goi, thu lai 1 lan neu van het han giua chung.
    for attempt in range(2):
        token = login()
        rc, out, err = run(
            [PY, "scripts/fetch_meter_data.py"],
            {**base_env, "TARGET_DATE": day, "ROLE_FILTER": "chinh",
             "DATAMETTER_PATH": STAGING_PATH, "API_TOKEN": token, "FETCH_SLEEP": "0.1"},
        )
        if "TOKEN_EXPIRED" not in (out + err):
            break
        log(f"  Token het han giua chung o ngay {day}, thu lai (lan {attempt + 2})...")
    else:
        log(f"  [LOI] fetch_meter_data {day}: het han lap lai, bo qua ngay nay.")
        return False
    if rc != 0:
        log(f"  [LOI] fetch_meter_data {day}: rc={rc} {err[-400:]}")
        return False

    # 3) Tinh ton that ngay tu file tam
    rc, out, err = run(
        [PY, "scripts/daily_transformer_loss.py"],
        {**base_env, "TARGET_DATE": day, "DATAMETTER_PATH": STAGING_PATH},
    )
    if os.path.isfile(STAGING_PATH):
        os.remove(STAGING_PATH)
    if rc != 0:
        log(f"  [LOI] daily_transformer_loss {day}: rc={rc} {err[-400:]}")
        return False

    last_line = [l for l in out.splitlines() if l.strip()][-1:] or [""]
    log(f"  OK {day}: {last_line[0]}")
    return True


def main():
    end_existing = existing_dates()
    default_end = "2026-07-01"
    if end_existing:
        earliest = min(end_existing)
        default_end = (datetime.strptime(earliest, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
    start = os.environ.get("BF_START", "2026-01-01")
    end = os.environ.get("BF_END", default_end)
    log(f"Backfill {start} -> {end} (bo qua ngay da co: {len(end_existing)} ngay hien co)")

    days = [d for d in daterange(start, end) if d not in end_existing]
    log(f"Con {len(days)} ngay can xu ly.")

    done, failed = 0, []
    for day in days:
        if process_day(day):
            done += 1
        else:
            failed.append(day)
        if done and done % 20 == 0:
            log(f"Tien do: {done}/{len(days)} ngay xong, {len(failed)} loi.")

    log(f"Xong vong lap: {done} ngay OK, {len(failed)} loi.")
    if failed:
        log(f"Cac ngay loi: {failed}")

    log("Chay monthly_transformer_loss.py...")
    rc, out, err = run([PY, "scripts/monthly_transformer_loss.py"], {**os.environ})
    log(out.strip() or err.strip())
    log("HOAN TAT BACKFILL.")


if __name__ == "__main__":
    main()

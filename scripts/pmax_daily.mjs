#!/usr/bin/env node
/**
 * Pmax MỘT NGÀY của từng công tơ → `public/pmax_daily.csv` (lưu VĨNH VIỄN).
 *
 * Thay `scripts/daily_pmax.py` (29/09/2026). Hai thứ đổi:
 *   · nguồn `public/datametter.csv` → `public/ThongSo_30min/<ngày>.csv`;
 *   · số trong file nguồn nay là RAW, phải ×HSN của ĐIỂM ĐO mà công tơ gắn vào
 *     tại thời điểm của mốc (`scripts/lib/thongso.mjs`) — trước đây HSN đã nhân
 *     sẵn lúc ghi nên script chỉ việc lấy max.
 * Viết bằng Node để chạy được trên cả hai máy (CLAUDE.md).
 *
 * Pmax ở đây là **đỉnh tức thời** (mẫu 30 phút), khác Pmax trung bình 30 phút
 * của `pmax_line_daily.mjs`. Hai nhánh độc lập, đừng đem so thẳng.
 *
 * Công tơ không tra được HSN thì BỎ và in ra — ghi số chưa nhân vào file lưu
 * vĩnh viễn là để lại con số nhỏ hơn hàng trăm lần, rất khó phát hiện về sau.
 *
 * Khử trùng theo (METER_NO, DATE) nên chạy lại không nhân đôi. Dòng cũ giữ
 * NGUYÊN VĂN, không định dạng lại — tránh cả file đổi chỉ vì đổi ngôn ngữ.
 *
 *   PB_EMAIL=... PB_PASS=... node scripts/pmax_daily.mjs            # hôm qua
 *   ... node scripts/pmax_daily.mjs --date 2026-09-25
 *   TARGET_DATE=2026-09-25 node scripts/pmax_daily.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHsnResolver, scaleRow } from './lib/thongso.mjs';
import { pbLogin, allOf } from './lib/pb_meters.mjs';

const SRC_DIR = process.env.THONGSO_30MIN_DIR || 'public/ThongSo_30min';
const OUT_PATH = process.env.PMAX_DAILY_OUT || 'public/pmax_daily.csv';
const OUT_FIELDS = ['METER_NO', 'DATE', 'PMAX_KW'];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Như `%g` của Python: tối đa 6 chữ số có nghĩa, bỏ số 0 thừa. */
export const g6 = (n) => String(Number(n.toPrecision(6)));

export function readCsv(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const head = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).filter(l => l.trim()).map(l => {
    const c = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h, (c[i] ?? '').trim()]));
  });
}

/**
 * Phần tính THUẦN — tách ra để kiểm được không cần PocketBase.
 * @param rows dòng RAW của đúng một ngày
 * @param hsnAt (serial, dateTime) → {hsn} | {reason}
 */
export function pmaxOfRows(rows, hsnAt) {
  const pmax = new Map();
  const missing = new Map();
  for (const r of rows) {
    const no = String(r.METER_NO ?? '').trim();
    if (!no) continue;
    const got = hsnAt(no, r.DATE_TIME);
    if (!('hsn' in got)) { missing.set(no, got.reason); continue; }
    const kw = scaleRow(r, got.hsn).P;
    if (kw === null || !Number.isFinite(kw)) continue;
    const cur = pmax.get(no);
    if (cur === undefined || kw > cur) pmax.set(no, kw);
  }
  return { pmax, missing };
}

async function main() {
  const i = process.argv.indexOf('--date');
  const day = (i >= 0 ? process.argv[i + 1] : '') || (process.env.TARGET_DATE ?? '').trim()
    || ymd(new Date(Date.now() - 86400000));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { console.error(`Ngày không hợp lệ: ${day}`); process.exit(1); }

  const src = `${SRC_DIR}/${day}.csv`;
  if (!existsSync(src)) {
    console.log(`Không có ${src} (có thể đã ra khỏi vòng giữ 40 ngày). Không đụng file cũ.`);
    return;
  }
  const rows = readCsv(src);

  const token = await pbLogin();
  const [assets, points] = await Promise.all([allOf('dm_asset', token), allOf('dm_point', token)]);
  const { pmax, missing } = pmaxOfRows(rows, buildHsnResolver(assets, points));

  if (missing.size) {
    console.log(`[HSN] ${missing.size} công tơ bỏ qua vì chưa tra được hệ số nhân:`);
    for (const [no, why] of missing) console.log(`   ${no}  ${why}`);
  }
  if (!pmax.size) {
    console.error(`Không tính được công tơ nào cho ${day} — dừng, không đụng file cũ.`);
    process.exit(1);
  }

  /* Dòng cũ giữ NGUYÊN VĂN; chỉ ngày này được ghi đè. */
  const keep = new Map();
  for (const r of readCsv(OUT_PATH)) keep.set(`${r.METER_NO}|${r.DATE}`, r);
  for (const [no, kw] of pmax) keep.set(`${no}|${day}`, { METER_NO: no, DATE: day, PMAX_KW: g6(kw) });

  const out = [...keep.values()].sort((a, b) =>
    a.DATE.localeCompare(b.DATE) || a.METER_NO.localeCompare(b.METER_NO));
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, [OUT_FIELDS.join(','),
    ...out.map(r => OUT_FIELDS.map(c => r[c] ?? '').join(','))].join('\n') + '\n', 'utf8');
  console.log(`Pmax ngày ${day}: ${pmax.size} công tơ. Tổng file: ${out.length} dòng -> ${OUT_PATH}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(e => { console.error(e); process.exit(1); });
}

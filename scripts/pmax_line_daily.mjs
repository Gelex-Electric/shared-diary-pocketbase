#!/usr/bin/env node
/**
 * Pmax của từng LỘ ĐƯỜNG DÂY theo ngày → `public/pmax_line_daily.csv`.
 *
 * Vì sao phải có file riêng thay vì tính trong app từ `pmax_daily.csv`:
 * `pmax_daily.csv` là đỉnh của TỪNG CÔNG TƠ, cộng lại là đỉnh KHÔNG TRÙNG THỜI
 * ĐIỂM nên vống 0–25% (đo ngày 21/09/2026). Đỉnh thật của lộ phải cộng công
 * suất theo từng mốc 30 phút rồi mới lấy max — mà muốn vậy phải có dữ liệu 30
 * phút, thứ chỉ giữ 30 ngày. Nên tính ngay mỗi đêm và lưu lại VĨNH VIỄN, để sau
 * này tra tháng cũ vẫn có số đúng.
 *
 * NGUỒN: `public/hes_30min/<ngày>.csv` — chỉ số lũy kế 30 phút, RAW (chưa nhân
 * HSN), kèm cột HSN.
 *
 *   P(t) = (PG[t] − PG[t−1]) × HSN ÷ 0,5h     (kW, công suất trung bình 30 phút)
 *
 * LƯU Ý ĐƠN VỊ: đây là công suất TRUNG BÌNH trong khoảng 30 phút, thấp hơn công
 * suất TỨC THỜI mà `pmax_daily.csv` lấy từ `datametter.csv` (đo thực tế lệch
 * ~18%). Hai đại lượng khác nhau, không phải cái nào sai — cột `SRC` ghi rõ.
 *
 * CHỈ CỘNG ĐIỂM ĐO CHÍNH: điểm đo phụ nằm trong phạm vi đo của điểm chính, cộng
 * cả hai là đếm trùng (dữ liệu thật có 44 công tơ ở điểm đo phụ).
 *
 * Chạy:
 *   PB_EMAIL=... PB_PASS=... node scripts/pmax_line_daily.mjs           # ngày hôm qua
 *   ... node scripts/pmax_line_daily.mjs --all                          # mọi ngày đang có
 *   ... node scripts/pmax_line_daily.mjs --date 2026-09-15
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pbLogin } from './lib/pb_meters.mjs';

const DIR_30 = process.env.HES_30MIN_DIR || 'public/hes_30min';
const OUT = process.env.PMAX_LINE_OUT || 'public/pmax_line_daily.csv';
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

const FIELDS = ['LINE_CODE', 'DATE', 'PMAX_KW', 'AT', 'COVERED', 'TOTAL', 'SRC'];
/** Mốc 30 phút, tính theo giờ. Dùng để đổi hiệu chỉ số ra công suất. */
const HOURS_PER_SLOT = 0.5;

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
};

/* ----------------------------- đọc/ghi CSV ----------------------------- */
function readCsv(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '').trim();
  if (!text) return [];
  const [head, ...lines] = text.split(/\r?\n/);
  const cols = head.split(',');
  return lines.filter(Boolean).map(line => {
    const cells = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
  });
}

function writeCsv(path, rows) {
  const body = rows.map(r => FIELDS.map(f => r[f] ?? '').join(',')).join('\n');
  writeFileSync(path, `${FIELDS.join(',')}\n${body}\n`, 'utf8');
}

/* --------------------------- danh mục từ PB --------------------------- */
async function catalog(token) {
  const get = async (c) => {
    const r = await fetch(`${PB_URL}/api/collections/${c}/records?perPage=1000`,
      { headers: { Authorization: token } });
    if (!r.ok) { console.error(`Không đọc được ${c}: HTTP ${r.status}`); process.exit(1); }
    return (await r.json()).items;
  };
  const [lines, stations, points, assets] = await Promise.all(
    ['dm_line', 'dm_station', 'dm_point', 'dm_asset'].map(get));
  return { lines, stations, points, assets };
}

/**
 * Công tơ ĐANG TREO của từng lộ — CHỈ điểm đo chính.
 * `dm_asset` (CONGTO) → `dm_point` → `dm_station` → `dm_line`.
 *
 * "ĐANG TREO" = có ngày treo và CHƯA có ngày tháo — cùng định nghĩa với
 * `liveMeters` trong `lib/pb_meters.mjs`, chặt hơn cờ `active`.
 *
 * Vì sao phải lọc (sửa 22/09/2026): bản đầu đếm MỌI công tơ từng gắn ở điểm đo
 * chính, nên mẫu số gồm cả công tơ đã tháo và công tơ dự kiến chưa ra hiện
 * trường. Lộ 477E11.9 hiện "10/31 công tơ có số liệu" trong khi thực tế là
 * 9/13 — nhìn vào tưởng mất 2/3 dữ liệu, mà 18 cái kia vốn KHÔNG THỂ có dữ liệu:
 * 10 đã tháo, 7 chưa treo, và chúng vẫn nằm trong mẫu số. Một con số như vậy
 * làm người đọc mất tin vào cả những lộ đang đúng.
 */
function metersByLine({ stations, points, assets }) {
  const stById = new Map(stations.map(s => [s.id, s]));
  const pById = new Map(points.map(p => [p.id, p]));
  const ymd = (v) => String(v ?? '').slice(0, 10);
  const out = new Map();
  for (const a of assets) {
    if (a.type !== 'CONGTO' || !a.point) continue;
    if (!ymd(a.date_on) || ymd(a.date_off)) continue;
    const p = pById.get(a.point);
    if (!p || p.role !== 'chinh') continue;
    const st = p.station ? stById.get(p.station) : undefined;
    if (!st?.line) continue;
    if (!out.has(st.line)) out.set(st.line, []);
    out.get(st.line).push(a.serial);
  }
  return out;
}

/* ------------------------------ tính Pmax ------------------------------ */
/**
 * Đỉnh TRÙNG THỜI ĐIỂM của một lộ trong một ngày.
 *
 * Gom về mốc 30 phút trước khi cộng: đồng hồ công tơ lệch 1–2 phút nên cùng một
 * "mốc 10:00" nằm rải ở 10:00/10:01/10:02; cộng theo mốc thô thì tổng bị HỤT
 * (đo ngày 21/09: lộ 479E28.24 hụt 135 kW = 7,6%).
 */
function peakOfLine(serials, rowsByMeter) {
  const bySlot = new Map();
  let covered = 0;

  for (const serial of serials) {
    const rows = rowsByMeter.get(serial);
    if (!rows || rows.length < 2) continue;
    covered++;

    rows.sort((a, b) => a.time.localeCompare(b.time));
    /* Mỗi công tơ góp MỘT giá trị cho mỗi mốc — báo cả 10:01 lẫn 10:02 mà cộng
       cả hai là đếm trùng chính nó. Lấy giá trị lớn nhất: đây là bài toán ĐỈNH. */
    const perSlot = new Map();
    for (let i = 1; i < rows.length; i++) {
      const dv = rows[i].pg - rows[i - 1].pg;
      /* Chỉ số lùi (thay/reset công tơ) → bỏ mốc đó, không bịa số âm. */
      if (!(dv >= 0)) continue;
      const kw = (dv * rows[i].hsn) / HOURS_PER_SLOT;
      const slot = snap(rows[i].time);
      const cur = perSlot.get(slot);
      if (cur === undefined || kw > cur) perSlot.set(slot, kw);
    }
    for (const [slot, kw] of perSlot) bySlot.set(slot, (bySlot.get(slot) ?? 0) + kw);
  }

  let pmax = 0;
  let at = '';
  for (const [slot, kw] of bySlot) if (kw > pmax) { pmax = kw; at = slot; }
  return { pmax, at, covered, total: serials.length };
}

/** `HH:mm` → mốc 30 phút gần nhất. */
function snap(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const mins = Math.round((h * 60 + m) / 30) * 30;
  const hh = Math.floor(mins / 60) % 24;
  return `${String(hh).padStart(2, '0')}:${mins % 60 === 0 ? '00' : '30'}`;
}

/* --------------------------------- chạy --------------------------------- */
const days = (() => {
  const one = arg('--date');
  if (one) return [one];
  const have = existsSync(DIR_30)
    ? readdirSync(DIR_30).filter(f => f.endsWith('.csv')).map(f => f.slice(0, -4)).sort()
    : [];
  if (process.argv.includes('--all')) return have;
  /* Mặc định: NGÀY MỚI NHẤT đang có — khớp với lượt pipeline vừa ghi xong. */
  return have.length ? [have[have.length - 1]] : [];
})();

if (!days.length) { console.error(`Không có file nào trong ${DIR_30}.`); process.exit(1); }

const token = await pbLogin();
const cat = await catalog(token);
const byLine = metersByLine(cat);
const lineCode = new Map(cat.lines.map(l => [l.id, l.code]));
console.log(`Danh mục: ${cat.lines.length} lộ · ${byLine.size} lộ có công tơ ở điểm đo chính.`);

/* Giữ lại các ngày KHÁC, ghi đè đúng những ngày vừa tính — chạy lại cùng một
   ngày cho ra cùng kết quả, không nhân đôi dòng. */
const kept = readCsv(OUT).filter(r => !days.includes(r.DATE));
const added = [];

for (const day of days) {
  const path = join(DIR_30, `${day}.csv`);
  if (!existsSync(path)) { console.log(`[bỏ qua] ${day}: không có file.`); continue; }

  const rowsByMeter = new Map();
  for (const r of readCsv(path)) {
    const pg = Number(r.PG);
    const hsn = Number(r.HSN);
    if (!Number.isFinite(pg) || !Number.isFinite(hsn)) continue;
    if (!rowsByMeter.has(r.METER_NO)) rowsByMeter.set(r.METER_NO, []);
    rowsByMeter.get(r.METER_NO).push({ time: String(r.DATE_TIME).slice(11, 16), pg, hsn });
  }

  let n = 0;
  for (const [lineId, serials] of byLine) {
    const { pmax, at, covered, total } = peakOfLine(serials, rowsByMeter);
    if (!covered) continue;
    added.push({
      LINE_CODE: lineCode.get(lineId) ?? lineId,
      DATE: day,
      PMAX_KW: pmax.toFixed(1),
      AT: at,
      COVERED: covered,
      TOTAL: total,
      /* Ghi rõ đại lượng: trung bình 30 phút, KHÁC tức thời của pmax_daily.csv. */
      SRC: '30min',
    });
    n++;
  }
  console.log(`${day}: ${n} lộ có số liệu.`);
}

const all = [...kept, ...added].sort((a, b) =>
  a.DATE.localeCompare(b.DATE) || a.LINE_CODE.localeCompare(b.LINE_CODE));
writeCsv(OUT, all);
console.log(`\n✔ ${OUT}: ${all.length} dòng (${added.length} vừa tính, ${kept.length} giữ lại).`);

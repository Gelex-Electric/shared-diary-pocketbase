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
 * NGUỒN: `public/ChiSo_30min/<ngày>.csv` — chỉ số lũy kế 30 phút, RAW (chưa nhân
 * HSN), kèm cột HSN.
 *
 *   P = (PG[i] − PG[i−1]) × HSN ÷ (thời gian THỰC giữa hai bản đọc)
 *
 * CHIA CHO THỜI GIAN THỰC, KHÔNG phải 0,5h cố định (sửa 22/09/2026).
 *
 * Công tơ KHÔNG báo đúng mỗi 30 phút: đồng hồ lệch và khoảng cách thật rất lệch
 * nhau. Công tơ 2510633411 ngày 12/09 báo lúc 14:01 rồi 14:45 — cách nhau 44
 * phút; chia hiệu chỉ số đó cho 0,5h ra 1.888 kW trong khi đúng là 1.287 kW.
 * Chính con số 1.888 kW đó đã thành "đỉnh" của lộ 473E27.4.
 *
 * Công suất tính được áp cho MỌI mốc 30 phút mà khoảng đó phủ qua — nó là công
 * suất trung bình suốt khoảng ấy, không phải của riêng mốc cuối.
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
/* Tập công tơ của một lộ — dùng CHUNG với head_balance_daily.mjs (đối soát đầu nguồn). */
import { metersByLine } from './lib/lineMembers.mjs';

const DIR_30 = process.env.CHISO_30MIN_DIR || process.env.HES_30MIN_DIR || 'public/ChiSo_30min';
const OUT = process.env.PMAX_LINE_OUT || 'public/pmax_line_daily.csv';
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

const FIELDS = [
  'LINE_CODE', 'DATE', 'PMAX_KW', 'AT', 'COVERED', 'TOTAL', 'SRC',
  /* Ai kéo đỉnh lên — trả lời "đỉnh này của khách nào" ngay tại chỗ, khỏi phải
     mở lại dữ liệu 30 phút để tra (mà 30 ngày sau thì cũng không còn để tra). */
  'TOP_MKH', 'TOP_NAME', 'TOP_STATION', 'TOP_KW', 'TOP_SHARE',
];
/** Độ dài một mốc đo, phút. Chỉ để chia ô trên trục thời gian — KHÔNG dùng để
 *  đổi hiệu chỉ số ra công suất; chỗ đó phải dùng thời gian THỰC giữa hai bản
 *  đọc, xem ghi chú đầu file. */
const SLOT_MIN = 30;

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
  const [lines, stations, points, assets, customers] = await Promise.all(
    ['dm_line', 'dm_station', 'dm_point', 'dm_asset', 'dm_customer'].map(get));
  return { lines, stations, points, assets, customers };
}


/* ------------------------------ tính Pmax ------------------------------ */
/**
 * Đỉnh TRÙNG THỜI ĐIỂM của một lộ trong một ngày.
 *
 * Gom về mốc 30 phút trước khi cộng: đồng hồ công tơ lệch 1–2 phút nên cùng một
 * "mốc 10:00" nằm rải ở 10:00/10:01/10:02; cộng theo mốc thô thì tổng bị HỤT
 * (đo ngày 21/09: lộ 479E28.24 hụt 135 kW = 7,6%).
 */
function peakOfLine(meters, rowsByMeter) {
  const bySlot = new Map();
  /* Đóng góp của từng công tơ tại từng mốc — cần để biết ai kéo đỉnh lên. */
  const perMeterSlot = new Map();
  let covered = 0;

  for (const m of meters) {
    const serial = m.serial;
    const rows = rowsByMeter.get(serial);
    if (!rows || rows.length < 2) continue;
    covered++;

    rows.sort((a, b) => a.time.localeCompare(b.time));
    /*
      Mỗi công tơ góp MỘT giá trị cho mỗi mốc — cùng một khoảng có thể phủ hai
      mốc, và hai khoảng có thể cùng rơi vào một mốc; lấy giá trị LỚN NHẤT vì
      đây là bài toán tìm ĐỈNH, còn cộng lại là đếm trùng chính công tơ đó.
    */
    const perSlot = new Map();
    for (let i = 1; i < rows.length; i++) {
      const dv = rows[i].pg - rows[i - 1].pg;
      /* Chỉ số lùi (thay/reset công tơ) → bỏ khoảng đó, không bịa số âm. */
      if (!(dv >= 0)) continue;

      const dtMin = toMinutes(rows[i].time) - toMinutes(rows[i - 1].time);
      /* Hai bản đọc cùng phút (hoặc lùi giờ) → không có khoảng để chia. */
      if (dtMin <= 0) continue;

      const kw = (dv * rows[i].hsn) / (dtMin / 60);
      /* Áp cho mọi mốc mà khoảng này phủ qua: đó là công suất trung bình suốt
         khoảng, không phải của riêng mốc cuối. */
      for (const slot of slotsBetween(rows[i - 1].time, rows[i].time)) {
        const cur = perSlot.get(slot);
        if (cur === undefined || kw > cur) perSlot.set(slot, kw);
      }
    }

    for (const [slot, kw] of perSlot) {
      bySlot.set(slot, (bySlot.get(slot) ?? 0) + kw);
      if (!perMeterSlot.has(slot)) perMeterSlot.set(slot, new Map());
      perMeterSlot.get(slot).set(serial, kw);
    }
  }

  let pmax = 0;
  let at = '';
  for (const [slot, kw] of bySlot) if (kw > pmax) { pmax = kw; at = slot; }

  /*
    Ai kéo đỉnh lên — lấy TẠI ĐÚNG MỐC đạt đỉnh, không phải công tơ có đỉnh
    riêng lớn nhất trong ngày: hai thứ đó có thể là hai khách khác nhau, mà câu
    hỏi "đỉnh của lộ là do ai" chỉ có nghĩa tại chính thời điểm đỉnh.
  */
  let top = null;
  const atPeak = perMeterSlot.get(at);
  if (atPeak) {
    let mx = -1;
    for (const [serial, kw] of atPeak) if (kw > mx) { mx = kw; top = { serial, kw }; }
  }
  const info = top ? meters.find(m => m.serial === top.serial) : null;

  return {
    pmax, at, covered, total: meters.length,
    topMkh: info?.mkh ?? '',
    topName: info?.name ?? '',
    topStation: info?.station ?? '',
    topKw: top?.kw ?? 0,
    /* Tỷ trọng của khách lớn nhất trong đỉnh — 70% thì đỉnh lộ thực chất là
       đỉnh của một khách, khác hẳn 15% (nhiều khách cùng lên). */
    topShare: pmax > 0 && top ? top.kw / pmax : 0,
  };
}

/** `HH:mm` → số phút từ 00:00. */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Các mốc 30 phút mà khoảng `[from, to]` phủ qua.
 *
 * Luôn trả ít nhất một mốc: khoảng ngắn hơn 30 phút vẫn phải đóng góp vào mốc
 * chứa nó, không thì phần điện đó biến mất khỏi đường phụ tải.
 */
function slotsBetween(from, to) {
  const a = toMinutes(from);
  const b = toMinutes(to);
  const out = [];
  for (let m = Math.floor(a / SLOT_MIN) * SLOT_MIN; m < b; m += SLOT_MIN) {
    const hh = Math.floor(m / 60) % 24;
    out.push(`${String(hh).padStart(2, '0')}:${m % 60 === 0 ? '00' : '30'}`);
  }
  return out.length ? out : [snap(to)];
}

/** `HH:mm` → mốc 30 phút gần nhất. */
function snap(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const mins = Math.round((h * 60 + m) / SLOT_MIN) * SLOT_MIN;
  const hh = Math.floor(mins / 60) % 24;
  return `${String(hh).padStart(2, '0')}:${mins % 60 === 0 ? '00' : '30'}`;
}

/* --------------------------------- chạy --------------------------------- */
const days = (() => {
  const one = arg('--date');
  if (one) return [one];
  /* Chạy tay workflow với target_date: job đặt TARGET_DATE, bước 4 vừa ghi đúng
     ngày đó — phải tính ĐÚNG ngày đó, không phải file mới nhất (có thể là ngày
     khác). Thiếu dòng này thì backfill một ngày cũ lặng lẽ tính lại hôm qua. */
  const env = (process.env.TARGET_DATE || '').trim();
  if (env) return [env];
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
  for (const [lineId, meters] of byLine) {
    const r = peakOfLine(meters, rowsByMeter);
    if (!r.covered) continue;
    added.push({
      LINE_CODE: lineCode.get(lineId) ?? lineId,
      DATE: day,
      PMAX_KW: r.pmax.toFixed(1),
      AT: r.at,
      COVERED: r.covered,
      TOTAL: r.total,
      /* Ghi rõ đại lượng: trung bình 30 phút, KHÁC tức thời của pmax_daily.csv. */
      SRC: '30min',
      TOP_MKH: r.topMkh,
      TOP_NAME: r.topName,
      TOP_STATION: r.topStation,
      TOP_KW: r.topKw.toFixed(1),
      TOP_SHARE: (r.topShare * 100).toFixed(0),
    });
    n++;
  }
  console.log(`${day}: ${n} lộ có số liệu.`);
}

const all = [...kept, ...added].sort((a, b) =>
  a.DATE.localeCompare(b.DATE) || a.LINE_CODE.localeCompare(b.LINE_CODE));
writeCsv(OUT, all);
console.log(`\n✔ ${OUT}: ${all.length} dòng (${added.length} vừa tính, ${kept.length} giữ lại).`);

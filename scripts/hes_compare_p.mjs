#!/usr/bin/env node
/**
 * T2 — đối chiếu CÔNG SUẤT giữa hai nguồn, trước khi đổi lõi tính tổn thất.
 *
 *   NGUỒN MỚI: `public/hes_30min/` — P = ΔPG × HSN ÷ Δt thực (qua `lib/hes30.mjs`).
 *   NGUỒN CŨ : `public/datametter.csv` — `TOTAL_KW` tức thời, ĐÃ nhân HSN sẵn.
 *
 * Hai đại lượng KHÁC NHAU về bản chất, nên mục tiêu KHÔNG phải là chúng bằng nhau:
 *   · chỉ số cho **công suất trung bình** suốt nửa giờ;
 *   · datametter cho **một lát cắt tức thời** trong nửa giờ đó.
 * Tải dao động thì lát cắt lệch trung bình là đương nhiên. Cái PHẢI khớp là
 * **NĂNG LƯỢNG cả ngày** — nếu lệch nhiều thì một trong hai nguồn sai HSN hoặc
 * sai cách quy đổi, và đó mới là thứ cần chặn trước khi viết lõi.
 *
 * CHỈ ĐỌC. Không ghi file nào, không gọi mạng, không đụng PocketBase.
 *
 *   node scripts/hes_compare_p.mjs --date 2026-09-21
 *   node scripts/hes_compare_p.mjs --date 2026-09-21 --meters 2510633411,2410320615
 */
import fs from 'node:fs';
import { buildDaySeries, slotLabel, SLOT_MIN, SLOTS_PER_DAY } from './lib/hes30.mjs';

const arg = (n, d = '') => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? d) : d;
};
const DAY = arg('--date', '2026-09-21');
const DM_PATH = process.env.DATAMETTER_PATH || 'public/datametter.csv';
const MI_PATH = process.env.METTERINFO_PATH || 'public/metterinfo.csv';

/* ---- công tơ cần soi: mặc định lấy các điểm đo CHÍNH có sản lượng lớn nhất ---- */
const pickedArg = arg('--meters', '');
const TOP_N = Number(arg('--top', '3'));

/* ---- tên trạm / khách hàng để in cho dễ đọc ---- */
const info = new Map();
if (fs.existsSync(MI_PATH)) {
  const lines = fs.readFileSync(MI_PATH, 'utf8').split(/\r?\n/).filter(x => x.trim());
  const H = lines[0].split(','); const I = (n) => H.indexOf(n);
  for (const l of lines.slice(1)) {
    const c = l.split(',');
    info.set(c[I('METER_NO')].trim(), {
      code: (c[I('CODE')] || '').trim(),
      name: (c[I('CUSTOMER_NAME')] || '').trim(),
      role: (c[I('ROLE')] || '').trim(),
      status: (c[I('STATUS')] || '').trim(),
    });
  }
}

/* ---- nguồn MỚI ---- */
const series = buildDaySeries(DAY);
if (series.meters.size === 0) {
  console.error(`Không có dữ liệu chỉ số 30 phút cho ${DAY} (public/hes_30min/${DAY}.csv).`);
  process.exit(1);
}

/* ---- nguồn CŨ: gom TOTAL_KW tức thời về đúng lưới 48 mốc ----
   Một mốc có thể có nhiều mẫu (đồng hồ lệch nhịp) → lấy TRUNG BÌNH, cùng tinh
   thần với nguồn mới; lấy max sẽ thiên vị nguồn cũ lên cao. */
const inst = new Map();     // serial → Map(slot → {sum, n})
if (!fs.existsSync(DM_PATH)) { console.error(`Không thấy ${DM_PATH}`); process.exit(1); }
{
  const lines = fs.readFileSync(DM_PATH, 'utf8').split(/\r?\n/);
  const H = lines[0].split(','); const iKw = H.indexOf('TOTAL_KW');
  for (const l of lines.slice(1)) {
    if (!l) continue;
    const c = l.split(',');
    const stamp = (c[1] || '').trim();
    if (!stamp.startsWith(DAY)) continue;
    const kw = Number(c[iKw]);
    if (!Number.isFinite(kw)) continue;
    const hh = Number(stamp.slice(11, 13)), mm = Number(stamp.slice(14, 16));
    const slot = Math.min(SLOTS_PER_DAY - 1, Math.floor((hh * 60 + mm) / SLOT_MIN));
    const serial = c[0].trim();
    if (!inst.has(serial)) inst.set(serial, new Map());
    const m = inst.get(serial);
    const cur = m.get(slot) || { sum: 0, n: 0 };
    cur.sum += kw; cur.n++; m.set(slot, cur);
  }
}

/* ---- chọn công tơ ---- */
let picked;
if (pickedArg) {
  picked = pickedArg.split(',').map(x => x.trim()).filter(Boolean);
} else {
  picked = [...series.meters.entries()]
    .filter(([s]) => info.get(s)?.role === 'chinh' && info.get(s)?.status === 'Yes')
    .sort((a, b) => b[1].energyKwh - a[1].energyKwh)
    .slice(0, TOP_N).map(([s]) => s);
}

const f = (x, d = 1) => x.toLocaleString('vi-VN', { maximumFractionDigits: d });
const line = (n = 78) => console.log('─'.repeat(n));

console.log(`\nĐỐI CHIẾU CÔNG SUẤT — ngày ${DAY}`);
console.log('nguồn MỚI: hiệu chỉ số 30′ (trung bình nửa giờ) · nguồn CŨ: TOTAL_KW tức thời');
if (series.nextDayMissing) {
  console.log('⚠️  Thiếu file ngày sau ⇒ mốc 23:30 không có ở nguồn mới (xem log T1).');
}
line();

let tongMoi = 0, tongCu = 0;
for (const serial of picked) {
  const m = series.meters.get(serial);
  const old = inst.get(serial);
  const meta = info.get(serial) || {};
  if (!m) { console.log(`\n${serial}: KHÔNG có ở nguồn mới`); continue; }
  if (!old) { console.log(`\n${serial}: KHÔNG có ở nguồn cũ (datametter)`); continue; }

  const rows = [];
  for (let s = 0; s < SLOTS_PER_DAY; s++) {
    const pNew = m.slots.get(s)?.p;
    const o = old.get(s);
    const pOld = o ? o.sum / o.n : undefined;
    if (pNew === undefined || pOld === undefined) continue;
    rows.push({ s, pNew, pOld, d: pOld === 0 ? null : (pNew - pOld) / pOld });
  }
  const withD = rows.filter(r => r.d !== null);
  const absD = withD.map(r => Math.abs(r.d)).sort((a, b) => a - b);
  const med = absD.length ? absD[Math.floor(absD.length / 2)] : 0;
  const worst = withD.reduce((a, b) => (a && Math.abs(a.d) > Math.abs(b.d) ? a : b), null);

  /* Năng lượng: nguồn cũ xấp xỉ bằng P × 0,5h mỗi mốc — đúng cách lõi CŨ đang làm. */
  const eOld = [...old.values()].reduce((a, v) => a + (v.sum / v.n) * 0.5, 0);
  const eNew = m.energyKwh;
  tongMoi += eNew; tongCu += eOld;

  console.log(`\n${serial}  ${meta.code || '(không rõ trạm)'}  ${(meta.name || '').slice(0, 38)}`);
  console.log(`  mốc so được: ${rows.length}/48 · HSN ${m.hsn}`);
  console.log(`  lệch P từng mốc: trung vị ${f(med * 100, 1)}% · lớn nhất ${worst ? f(Math.abs(worst.d) * 100, 1) : 0}%`
    + (worst ? ` tại ${slotLabel(worst.s)} (mới ${f(worst.pNew)} / cũ ${f(worst.pOld)} kW)` : ''));
  console.log(`  NĂNG LƯỢNG ngày: mới ${f(eNew, 0)} kWh · cũ ${f(eOld, 0)} kWh · `
    + `lệch ${f((eNew - eOld) / (eOld || 1) * 100, 2)}%`);
}

line();
console.log(`\nTỔNG ${picked.length} công tơ: mới ${f(tongMoi, 0)} kWh · cũ ${f(tongCu, 0)} kWh · `
  + `lệch ${f((tongMoi - tongCu) / (tongCu || 1) * 100, 2)}%`);
console.log('\nĐọc kết quả: lệch P từng mốc vài % → bình thường (trung bình vs lát cắt).');
console.log('Lệch NĂNG LƯỢNG cả ngày quá ~5% → một nguồn sai HSN hoặc sai quy đổi, phải dừng điều tra.');
line();

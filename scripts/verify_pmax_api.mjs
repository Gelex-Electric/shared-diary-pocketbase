#!/usr/bin/env node
/**
 * Đối chiếu Pmax: tính LẠI TỪ ĐẦU bằng cách gọi thẳng API HES, rồi so với
 * `public/pmax_line_daily.csv`.
 *
 * CHỈ ĐỌC. Không ghi PocketBase, không sửa file nào.
 *
 * Vì sao cần (user yêu cầu 22/09/2026): số trong CSV đi qua nhiều bước —
 * pipeline gọi API, ghi file 30 phút, rồi script khác đọc file đó tính Pmax lộ.
 * Mỗi bước là một chỗ có thể sai. Script này đi đường thẳng: API → tính → so.
 * Hai đường độc lập ra cùng số thì mới tin được.
 *
 * DÙNG ĐÚNG luật đã chốt:
 *   · công tơ ĐANG TREO (có ngày treo, chưa có ngày tháo)
 *   · điểm đo ĐANG VẬN HÀNH (`status === 'active'`) và là điểm đo CHÍNH
 *   · HSN lấy từ `dm_point.hsn`, KHÔNG lấy `METER_NAME` của HES
 *   · P = ΔPG × HSN ÷ THỜI GIAN THỰC giữa hai bản đọc, áp cho mọi mốc 30 phút
 *     mà khoảng đó phủ qua
 *
 *   PB_EMAIL=... PB_PASS=... API_USER=... API_PASS=... \
 *     node scripts/verify_pmax_api.mjs --from 2026-09-01 --to 2026-09-20
 */
import { readFileSync, existsSync } from 'node:fs';
import { getJson, getToken, mapLimit, stamp } from './lib/hes_api.mjs';
import { pbLogin } from './lib/pb_meters.mjs';

const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const SLOT_MIN = 30;

const arg = (n, d = '') => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const FROM = arg('--from', '2026-09-01');
const TO = arg('--to', '2026-09-20');
const CSV = process.env.PMAX_LINE_OUT || 'public/pmax_line_daily.csv';

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const slotsBetween = (a, b) => {
  const out = [];
  for (let m = Math.floor(a / SLOT_MIN) * SLOT_MIN; m < b; m += SLOT_MIN) {
    const hh = Math.floor(m / 60) % 24;
    out.push(`${String(hh).padStart(2, '0')}:${m % 60 === 0 ? '00' : '30'}`);
  }
  if (out.length) return out;
  const m = Math.round(b / SLOT_MIN) * SLOT_MIN;
  return [`${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${m % 60 === 0 ? '00' : '30'}`];
};

/* ----------------------------- danh mục ----------------------------- */
const pbToken = await pbLogin();
const pbGet = async (c) => {
  const r = await fetch(`${PB_URL}/api/collections/${c}/records?perPage=1000`,
    { headers: { Authorization: pbToken } });
  if (!r.ok) { console.error(`Không đọc được ${c}: HTTP ${r.status}`); process.exit(1); }
  return (await r.json()).items;
};
const [lines, stations, points, assets, customers] = await Promise.all(
  ['dm_line', 'dm_station', 'dm_point', 'dm_asset', 'dm_customer'].map(pbGet));

const stById = new Map(stations.map(s => [s.id, s]));
const pById = new Map(points.map(p => [p.id, p]));
const cById = new Map(customers.map(c => [c.id, c]));
const lById = new Map(lines.map(l => [l.id, l]));
const ymd = (v) => String(v ?? '').slice(0, 10);

const meters = [];
for (const a of assets) {
  if (a.type !== 'CONGTO' || !a.point) continue;
  if (!ymd(a.date_on) || ymd(a.date_off)) continue;
  const p = pById.get(a.point);
  if (!p || p.role !== 'chinh' || p.status !== 'active') continue;
  const st = p.station ? stById.get(p.station) : undefined;
  if (!st?.line) continue;
  if (p.hsn == null) { console.log(`[WARN] ${a.serial}: điểm đo chưa có HSN — bỏ qua.`); continue; }
  meters.push({
    serial: a.serial, hsn: Number(p.hsn), lineId: st.line,
    lineCode: lById.get(st.line)?.code ?? '?',
    name: cById.get(p.customer)?.short_name ?? '',
  });
}
console.log(`Danh mục: ${meters.length} công tơ đang treo · điểm đo chính · đang vận hành`);
console.log(`Khoảng: ${FROM} → ${TO}\n`);

/* ------------------------------ gọi API ------------------------------ */
const hesToken = await getToken();
const d0 = new Date(`${FROM}T00:00:00`);
const d1 = new Date(`${TO}T00:00:00`);
d1.setDate(d1.getDate() + 1);

let done = 0;
const byMeter = await mapLimit(meters, 6, async (m) => {
  const data = await getJson('GetMeterDataByDate', {
    MeterNo: m.serial, StartDate: stamp(d0), EndDate: stamp(d1), Token: hesToken,
  });
  done++;
  if (done % 20 === 0) console.log(`  … ${done}/${meters.length} công tơ`);
  if (!Array.isArray(data)) return [];
  return data
    .map(r => ({ t: r.DATE_TIME || r.DATA_TIME || '', pg: Number(r.ACTIVE_KW_INDICATE_TOTAL) }))
    .filter(r => r.t && Number.isFinite(r.pg))
    .sort((a, b) => a.t.localeCompare(b.t));
});
console.log(`  … ${done}/${meters.length} công tơ — xong\n`);

/* --------------------- tính Pmax lộ theo từng ngày --------------------- */
/** lineCode → day → slot → kW cộng dồn của các công tơ. */
const agg = new Map();
meters.forEach((m, i) => {
  const rows = byMeter[i] ?? [];
  /* Gom theo NGÀY trước: khoảng vắt qua nửa đêm không được cộng sang ngày sau. */
  const byDay = new Map();
  for (const r of rows) {
    const day = r.t.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ time: r.t.slice(11, 16), pg: r.pg });
  }
  for (const [day, list] of byDay) {
    if (list.length < 2) continue;
    const perSlot = new Map();
    for (let k = 1; k < list.length; k++) {
      const dv = list[k].pg - list[k - 1].pg;
      if (!(dv >= 0)) continue;                    // chỉ số lùi → bỏ khoảng
      const a = toMin(list[k - 1].time);
      const b = toMin(list[k].time);
      if (b <= a) continue;
      const kw = (dv * m.hsn) / ((b - a) / 60);
      for (const slot of slotsBetween(a, b)) {
        const cur = perSlot.get(slot);
        if (cur === undefined || kw > cur) perSlot.set(slot, kw);
      }
    }
    if (!agg.has(m.lineCode)) agg.set(m.lineCode, new Map());
    const dmap = agg.get(m.lineCode);
    if (!dmap.has(day)) dmap.set(day, { slots: new Map(), covered: new Set() });
    const bag = dmap.get(day);
    if (perSlot.size) bag.covered.add(m.serial);
    for (const [slot, kw] of perSlot) bag.slots.set(slot, (bag.slots.get(slot) ?? 0) + kw);
  }
});

/** Đỉnh tháng của từng lộ, tính từ API. */
const apiPeak = new Map();
for (const [code, dmap] of agg) {
  for (const [day, bag] of dmap) {
    if (day < FROM || day > TO) continue;
    let mx = 0; let at = '';
    for (const [slot, kw] of bag.slots) if (kw > mx) { mx = kw; at = slot; }
    const cur = apiPeak.get(code);
    if (!cur || mx > cur.pmax) apiPeak.set(code, { pmax: mx, day, at, covered: bag.covered.size });
  }
}

/* ------------------------------ so sánh ------------------------------ */
const csvPeak = new Map();
if (existsSync(CSV)) {
  const t = readFileSync(CSV, 'utf8').trim().split(/\r?\n/);
  const cols = t[0].split(',');
  for (const l of t.slice(1)) {
    const r = Object.fromEntries(l.split(',').map((v, i) => [cols[i], v]));
    if (r.DATE < FROM || r.DATE > TO) continue;
    const cur = csvPeak.get(r.LINE_CODE);
    if (!cur || Number(r.PMAX_KW) > cur.pmax) {
      csvPeak.set(r.LINE_CODE, { pmax: Number(r.PMAX_KW), day: r.DATE, at: r.AT, covered: Number(r.COVERED) });
    }
  }
}

console.log('Lộ           API (gọi thẳng)          CSV (qua pipeline)       Lệch');
let worst = 0;
for (const code of [...new Set([...apiPeak.keys(), ...csvPeak.keys()])].sort()) {
  const a = apiPeak.get(code);
  const c = csvPeak.get(code);
  if (!a || !c) { console.log(`  ${code.padEnd(12)}${a ? 'chỉ có API' : 'chỉ có CSV'}`); continue; }
  const d = c.pmax ? ((a.pmax - c.pmax) / c.pmax) * 100 : 0;
  if (Math.abs(d) > Math.abs(worst)) worst = d;
  console.log(`  ${code.padEnd(12)}`
    + `${String(Math.round(a.pmax)).padStart(6)} kW ${a.day.slice(5)} ${a.at} ${String(a.covered).padStart(2)}ct   `
    + `${String(Math.round(c.pmax)).padStart(6)} kW ${c.day.slice(5)} ${c.at} ${String(c.covered).padStart(2)}ct   `
    + `${d.toFixed(2).padStart(7)}%${Math.abs(d) > 1 ? '  ⚠' : ''}`);
}
console.log(`\nLệch lớn nhất: ${worst.toFixed(2)}%`);

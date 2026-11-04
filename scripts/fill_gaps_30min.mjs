#!/usr/bin/env node
/**
 * Tải BÙ các mốc còn thiếu của `ChiSo_30min` + `ThongSo_30min` trong GAP_DAYS ngày gần
 * nhất, rồi báo những công tơ vẫn thiếu của ngày hôm qua (plan 2026-11-04, T5).
 *
 * Vì sao có: lượt tải đêm lỗi mạng thì công tơ đó mất số. Tệ hơn, nếu không tải lại trước
 * khi file bị dọn (30/40 ngày) thì không còn nhận ra đã từng thiếu. HES thường vẫn giữ số
 * nên đa số lấy lại được; công tơ mất liên lạc thì HES không có gì để trả, chỉ báo được.
 *
 * Gộp theo (METER_NO, DATE_TIME) nên chạy lại an toàn. Ngày được bù vào quá
 * khứ thì tổn thất tự đúng (`loss_daily` tính lại 30 ngày); Pmax của ngày đó KHÔNG tự tính
 * lại — script in danh sách ngày để chạy tay nếu cần.
 *
 * CẢNH BÁO (kind `congto`, một bản ghi mỗi ngày): chỉ công tơ CÓ số trong các ngày soát
 * trước đó mà hôm qua thiếu. Công tơ đã im lặng lâu (nằm kho, khách tắt trạm dài ngày) không báo, để
 * màn Cảnh báo không ngập như lần thử 16/09/2026.
 *
 *   node scripts/fill_gaps_30min.mjs [--notify] [--dry-run]
 *
 * Env: GAP_DAYS (7), GAP_MIN_ROWS (46 — đồng hồ công tơ lệch vài mốc là bình thường),
 *      GAP_BUDGET_MS (300000 — HES chết thì dừng, không ăn hết giờ của pipeline),
 *      CONCURRENCY (6), PB_EMAIL/PB_PASS, API_TOKEN hoặc API_USER/API_PASS.
 */
import { join } from 'node:path';
import { getJson, getToken, mapLimit, stamp } from './lib/hes_api.mjs';
import { pbLogin, allOf } from './lib/pb_meters.mjs';
import { rawRow, metersForRange, buildHsnResolver } from './lib/thongso.mjs';
import { hesSerials } from './lib/hes_list.mjs';
import { raiseAlert, zoneOf } from './lib/pb_alert.mjs';
import { FIELD_MAP, readCsv, writeCsv30ByDay, writeIndex30 } from './fetch_hes_index.mjs';
import { writeByDay } from './fetch_thongso_30min.mjs';

const DIR_CS = process.env.CHISO_30MIN_DIR || process.env.HES_30MIN_DIR || 'public/ChiSo_30min';
const DIR_TS = process.env.THONGSO_30MIN_DIR || 'public/ThongSo_30min';
const GAP_DAYS = Number(process.env.GAP_DAYS || 7);
const MIN_ROWS = Number(process.env.GAP_MIN_ROWS || 46);
const BUDGET_MS = Number(process.env.GAP_BUDGET_MS || 300000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const NOTIFY = process.argv.includes('--notify');
const DRY = process.argv.includes('--dry-run');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const recTime = (r) => r?.DATE_TIME || r?.DATA_TIME || '';

function lastDays(n) {
  const now = new Date();
  const vn = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60000);
  const out = [];
  for (let i = n; i >= 1; i--) out.push(ymd(new Date(vn.getFullYear(), vn.getMonth(), vn.getDate() - i)));
  return out;
}

/** Số dòng theo công tơ của một file ngày. */
const countByMeter = (dir, day) => {
  const m = new Map();
  for (const r of readCsv(join(dir, `${day}.csv`))) m.set(r.METER_NO, (m.get(r.METER_NO) ?? 0) + 1);
  return m;
};

/** NÉM khi API lỗi, để phân biệt "gọi hỏng" với "công tơ không có số". */
async function fetchRecs(endpoint, token, serial, day) {
  const start = parse(day), end = parse(day);
  end.setHours(23, 59, 59, 0);
  const data = await getJson(endpoint, { MeterNo: serial, StartDate: stamp(start), EndDate: stamp(end), Token: token });
  if (Array.isArray(data)) return data.filter(r => recTime(r).slice(0, 10) === day);
  if (String(data?.MESSAGE ?? '').toLowerCase() === 'invalid token') throw new Error('invalid token');
  return [];
}

async function main() {
  const days = lastDays(GAP_DAYS);
  const yesterday = days[days.length - 1];
  const pbToken = await pbLogin();
  const [assets, points, customers, stations, zones] = await Promise.all(
    ['dm_asset', 'dm_point', 'dm_customer', 'dm_station', 'dm_zone'].map(c => allOf(c, pbToken)));
  const hsnAt = buildHsnResolver(assets, points);
  const hes = hesSerials();
  if (!hes.length) throw new Error('metterinfo.csv rỗng — dừng.');

  /* Việc cần làm: (ngày, công tơ, nguồn) còn thiếu mốc. */
  const jobs = [];
  for (const day of days) {
    const list = [...new Set([...hes, ...metersForRange(assets, day, day)])];
    const cs = countByMeter(DIR_CS, day), ts = countByMeter(DIR_TS, day);
    for (const sn of list) {
      if ((cs.get(sn) ?? 0) < MIN_ROWS) jobs.push({ day, sn, kind: 'cs' });
      if ((ts.get(sn) ?? 0) < MIN_ROWS) jobs.push({ day, sn, kind: 'ts' });
    }
  }
  console.log(`Soát ${days[0]} → ${yesterday}: ${jobs.length} lượt cần thử tải bù${DRY ? ' — DRY-RUN' : ''}.`);
  if (DRY) return;

  const token = jobs.length ? await getToken() : '';
  const t0 = Date.now();
  let skipped = 0;
  const failed = new Set();
  const rowsCs = [], rowsTs = [];
  const results = await mapLimit(jobs, CONCURRENCY, async (j) => {
    if (Date.now() - t0 > BUDGET_MS) { skipped++; return; }
    try {
      if (j.kind === 'cs') {
        const h = hsnAt(j.sn, `${j.day} 00:00:00`);
        for (const r of await fetchRecs('GetMeterDataByDate', token, j.sn, j.day)) {
          if (!(Number(r.ACTIVE_KW_INDICATE_TOTAL) > 0)) continue;
          const row = { METER_NO: j.sn, DATE_TIME: recTime(r), HSN: h.hsn == null ? '' : String(h.hsn) };
          for (const [k, src] of Object.entries(FIELD_MAP)) row[k] = r[src] ?? '';
          rowsCs.push(row);
        }
      } else {
        for (const r of await fetchRecs('GetInstantByDate', token, j.sn, j.day)) rowsTs.push(rawRow(j.sn, r));
      }
    } catch (e) {
      /* Token hỏng thì mọi lượt sau cũng hỏng — ném ra để dừng, không báo nhầm là công tơ lỗi. */
      if (/invalid token/.test(String(e))) throw e;
      failed.add(`${j.day}|${j.sn}`);
    }
  });
  if (results.some(r => /invalid token/.test(r?.error ?? ''))) throw new Error('Token HES hỏng — dừng.');

  /* Hai hàm ghi gộp theo (METER_NO, DATE_TIME): mốc đã có được thay bằng chính số HES trả lại. */
  const addedDays = new Set(rowsCs.map(r => r.DATE_TIME.slice(0, 10)));
  if (rowsCs.length) { writeCsv30ByDay(DIR_CS, rowsCs); writeIndex30(DIR_CS); }
  if (rowsTs.length) writeByDay(DIR_TS, rowsTs, { from: days[0], to: yesterday });
  console.log(`Tải bù: ChiSo ${rowsCs.length} mốc · ThongSo ${rowsTs.length} mốc · lỗi API ${failed.size} lượt`
    + `${skipped ? ` · bỏ ${skipped} lượt vì hết ngân sách thời gian` : ''}.`);
  const pastDays = [...addedDays].filter(d => d !== yesterday).sort();
  if (pastDays.length) console.log(`[NHẮC] Có mốc mới ở ngày cũ, Pmax các ngày này chưa tính lại: ${pastDays.join(', ')}`);

  /* ------------------------------ báo công tơ vẫn thiếu ------------------------------ */
  const cs = countByMeter(DIR_CS, yesterday);
  const recent = new Set();
  for (const d of days.slice(0, -1)) for (const sn of countByMeter(DIR_CS, d).keys()) recent.add(sn);
  const missing = [...recent].filter(sn => (cs.get(sn) ?? 0) < MIN_ROWS).sort();
  console.log(`Ngày ${yesterday}: ${missing.length} công tơ có số gần đây nhưng vẫn thiếu mốc`
    + `${missing.length ? `: ${missing.join(', ')}` : ''}.`);
  if (!missing.length || !NOTIFY) return;

  const pointById = new Map(points.map(p => [p.id, p]));
  const customerById = new Map(customers.map(c => [c.id, c]));
  const stationById = new Map(stations.map(s => [s.id, s]));
  const zoneName = new Map(zones.map(z => [z.id, z.name]));
  const details = missing.map(sn => {
    const h = hsnAt(sn, `${yesterday} 00:00:00`);
    const p = h.point ?? pointById.get(assets.find(a => a.type === 'CONGTO' && String(a.serial).trim() === sn)?.point);
    const c = customerById.get(p?.customer);
    const zone = zoneName.get(stationById.get(p?.station)?.zone || p?.zone) ?? '';
    const n = cs.get(sn) ?? 0;
    return { meter: sn, customer: c?.short_name || c?.name || '', station: p?.code ?? '', zone, day: yesterday,
      note: `${failed.has(`${yesterday}|${sn}`) ? 'Gọi HES lỗi' : 'HES không trả đủ'} — có ${n}/48 mốc` };
  });
  const ok = await raiseAlert(pbToken, {
    kind: 'congto',
    title: 'Công tơ thiếu số sau khi tải bù',
    message: `Ngày ${yesterday}: ${missing.length} công tơ có số trong ${GAP_DAYS - 1} ngày trước đó nhưng ngày này thiếu mốc — ${missing.join(', ')}`,
    zone: zoneOf(details.map(d => d.zone)),
    meters: missing,
    details,
    day: yesterday,
  });
  console.log(`Cảnh báo công tơ thiếu số: ${ok ? 'đã ghi 1 bản' : 'bỏ qua (đã có bản cho ngày này)'}.`);
}

main().catch((e) => { console.error(`LỖI: ${e.message ?? e}`); process.exit(1); });

#!/usr/bin/env node
/**
 * Thông số tức thời 30 phút (U, I, P, Q từng pha, PF, tần số) → `public/ThongSo_30min/`.
 * MỖI NGÀY MỘT FILE `YYYY-MM-DD.csv` + `index.json`, giữ 40 ngày (user chốt 24/09/2026).
 * Thay `datametter.csv` (một file 7 ngày, đã nhân cứng HSN).
 *
 * LƯU RAW — KHÔNG nhân HSN, KHÔNG có cột HSN. Nơi đọc nhân theo điểm đo mà công tơ
 * gắn vào tại thời điểm của mốc: `buildHsnResolver` + `scaleRow` trong `lib/thongso.mjs`.
 *
 * Danh sách công tơ: Danh mục PocketBase — mọi lần treo `dm_asset` có khoảng giao
 * với cửa sổ ngày (`metersForRange`), không phải metterinfo.csv của HES.
 *
 * Mỗi công tơ MỘT lời gọi `GetInstantByDate` cho cả khoảng — backfill 40 ngày cũng
 * chỉ ~130 lời gọi.
 *
 * Chạy:
 *   node scripts/fetch_thongso_30min.mjs                       # hôm qua (hoặc TARGET_DATE)
 *   node scripts/fetch_thongso_30min.mjs --date 2026-09-18
 *   node scripts/fetch_thongso_30min.mjs --from 2026-08-16 --to 2026-09-23
 *   ... --dry-run   chỉ in sẽ ghi gì
 *
 * Cần: PB_EMAIL/PB_PASS (đọc danh mục), API_TOKEN hoặc API_USER/API_PASS.
 * Env: THONGSO_30MIN_DIR (mặc định public/ThongSo_30min), KEEP_DAYS_THONGSO (40).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getJson, getToken, mapLimit, stamp } from './lib/hes_api.mjs';
import { pbLogin, allOf } from './lib/pb_meters.mjs';
import { rawRow, metersForRange, THONGSO_COLUMNS } from './lib/thongso.mjs';

const OUT_DIR = process.env.THONGSO_30MIN_DIR || 'public/ThongSo_30min';
const KEEP_DAYS = Number(process.env.KEEP_DAYS_THONGSO || 40);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');

function todayVn() {
  const now = new Date();
  const vn = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60000);
  return new Date(vn.getFullYear(), vn.getMonth(), vn.getDate());
}

/** [from, to] (cả hai đầu) theo --date / --from --to / TARGET_DATE / mặc định hôm qua. */
function range(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
  const one = arg('--date') || (process.env.TARGET_DATE || '').trim();
  if (arg('--from') || arg('--to')) {
    if (!isDay(arg('--from')) || !isDay(arg('--to'))) throw new Error('--from/--to phải dạng YYYY-MM-DD');
    return [arg('--from'), arg('--to')];
  }
  if (one) {
    if (!isDay(one)) throw new Error(`Ngày không hợp lệ: ${one}`);
    return [one, one];
  }
  const y = ymd(new Date(todayVn().getTime() - 86400000));
  return [y, y];
}

/* --------------------------------- CSV --------------------------------- */
export function readCsv(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(l => l.trim());
  if (lines.length <= 1) return [];
  const head = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(l => {
    const c = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h, (c[i] ?? '').trim()]));
  });
}

/**
 * Ghi theo NGÀY CỦA CHÍNH MỐC; gộp với file cũ theo (METER_NO, DATE_TIME) nên chạy
 * lại không nhân đôi. Dọn file quá KEEP_DAYS. Cùng luật với ChiSo_30min.
 */
export function writeByDay(dir, rows, { from, to } = {}) {
  const byDay = new Map();
  for (const r of rows) {
    const d = String(r.DATE_TIME).slice(0, 10);
    /* Chỉ ghi các ngày được yêu cầu — mốc rìa ngoài cửa sổ (API trả dư) bỏ. */
    if (!isDay(d) || (from && d < from) || (to && d > to)) continue;
    (byDay.get(d) ?? byDay.set(d, []).get(d)).push(r);
  }
  mkdirSync(dir, { recursive: true });
  let written = 0;
  for (const [d, list] of byDay) {
    const path = join(dir, `${d}.csv`);
    const merged = new Map();
    for (const r of readCsv(path)) merged.set(`${r.METER_NO}|${r.DATE_TIME}`, r);
    for (const r of list) merged.set(`${r.METER_NO}|${r.DATE_TIME}`, r);
    const out = [...merged.values()]
      .sort((x, y) => (x.DATE_TIME + x.METER_NO).localeCompare(y.DATE_TIME + y.METER_NO));
    writeFileSync(path, [THONGSO_COLUMNS.join(','),
      ...out.map(r => THONGSO_COLUMNS.map(c => r[c] ?? '').join(','))].join('\n') + '\n', 'utf8');
    written += out.length;
  }
  const removed = [];
  if (KEEP_DAYS > 0) {
    const cutoff = ymd(new Date(todayVn().getTime() - KEEP_DAYS * 86400000));
    for (const f of readdirSync(dir)) {
      const m = /^(\d{4}-\d{2}-\d{2})\.csv$/.exec(f);
      if (m && m[1] < cutoff) { rmSync(join(dir, f)); removed.push(m[1]); }
    }
  }
  const days = readdirSync(dir).map(f => /^(\d{4}-\d{2}-\d{2})\.csv$/.exec(f)?.[1]).filter(Boolean).sort();
  writeFileSync(join(dir, 'index.json'),
    JSON.stringify({ days, first: days[0] ?? '', last: days[days.length - 1] ?? '' }) + '\n', 'utf8');
  return { days: [...byDay.keys()].sort(), rows: written, removed, all: days };
}

/* --------------------------------- main --------------------------------- */
async function main() {
  const [from, to] = range(process.argv);
  const dry = process.argv.includes('--dry-run');
  const pbToken = await pbLogin();
  const assets = await allOf('dm_asset', pbToken);
  const serials = metersForRange(assets, from, to);
  console.log(`ThongSo_30min ${from} → ${to}: ${serials.length} công tơ (Danh mục, mọi lần treo giao cửa sổ)`
    + `${dry ? ' — DRY-RUN' : ''}`);
  if (!serials.length) { console.error('Không có công tơ nào — dừng.'); process.exit(1); }

  const token = await getToken();
  const start = parse(from);
  const end = parse(to); end.setHours(23, 59, 59, 0);
  let apiErr = 0;
  const per = await mapLimit(serials, CONCURRENCY, async (sn) => {
    let data;
    try {
      data = await getJson('GetInstantByDate', { MeterNo: sn, StartDate: stamp(start), EndDate: stamp(end), Token: token });
    } catch (e) { apiErr++; console.log(`[WARN] ${sn}: lỗi API (${String(e).slice(0, 60)})`); return []; }
    if (!Array.isArray(data)) {
      if (String(data?.MESSAGE ?? '').toLowerCase() === 'invalid token') throw new Error('invalid token');
      return [];
    }
    return data.filter(r => r.DATE_TIME || r.DATA_TIME).map(r => rawRow(sn, r));
  });
  /* mapLimit nuốt lỗi thành {error} — token hỏng mà không dừng thì ghi ra file rỗng như thật. */
  if (per.some(p => /invalid token/.test(p?.error ?? ''))) { console.error('Token HES hỏng — dừng, không ghi.'); process.exit(1); }
  const rows = per.filter(Array.isArray).flat();
  const quiet = serials.filter((_, i) => !(Array.isArray(per[i]) && per[i].length));
  console.log(`Thu ${rows.length} mốc · ${serials.length - quiet.length}/${serials.length} công tơ có số · lỗi API ${apiErr}`);
  if (quiet.length) console.log(`Không có bản ghi: ${quiet.join(', ')}`);
  if (!rows.length) { console.error('Không có dữ liệu — dừng, không đụng file cũ.'); process.exit(1); }

  if (dry) {
    const byDay = {};
    for (const r of rows) { const d = r.DATE_TIME.slice(0, 10); if (d >= from && d <= to) byDay[d] = (byDay[d] ?? 0) + 1; }
    console.log('[dry-run] sẽ ghi:', Object.entries(byDay).sort().map(([d, n]) => `${d}:${n}`).join(' '));
    return;
  }
  const w = writeByDay(OUT_DIR, rows, { from, to });
  console.log(`✔ ${w.days.length} file, ${w.rows} dòng trong ${OUT_DIR}/ · đang giữ ${w.all.length} ngày`
    + `${w.removed.length ? ` · xoá ${w.removed.length} ngày quá hạn` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(e => { console.error(e); process.exit(1); });
}

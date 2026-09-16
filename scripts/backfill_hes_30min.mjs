#!/usr/bin/env node
/**
 * Lấp KHOẢNG TRỐNG nhiều ngày cho `public/hes_30min/`.
 *
 * `fetch_hes_index.mjs` chạy hằng đêm cho ĐÚNG MỘT ngày. Khi pipeline nghỉ vài
 * ngày, hoặc khi mới bật tính năng và muốn có sẵn lịch sử, gọi script này.
 *
 * Vì sao không lặp `fetch_hes_index.mjs` 21 lần: `GetMeterDataByDate` nhận cửa
 * sổ dài tuỳ ý, nên MỘT lời gọi cho mỗi công tơ lấy được trọn khoảng. 21 ngày ×
 * 123 công tơ = 2.583 lời gọi nếu lặp theo ngày, so với 123 lời gọi ở đây.
 *
 * Ghi bằng chính `writeCsv30ByDay` + `writeIndex30` của script hằng đêm, nên
 * định dạng file và luật khử trùng giống hệt — không sinh ra nhánh thứ hai.
 *
 * Chạy:
 *   PB_EMAIL=... PB_PASS=... API_TOKEN=... \
 *   FROM=2026-08-27 TO=2026-09-17 node scripts/backfill_hes_30min.mjs
 *   ... thêm --dry-run để chỉ xem sẽ ghi gì.
 *
 * TO là cận trên KHÔNG bao gồm. Ngày quá `KEEP_DAYS_30` vẫn bị dọn như thường,
 * nên đừng backfill xa hơn cửa sổ giữ ngày — ghi xong lại xoá ngay.
 */
import { getJson, getToken, mapLimit, stamp } from './lib/hes_api.mjs';
import { pbLogin, liveMeters } from './lib/pb_meters.mjs';
import { writeCsv30ByDay, writeIndex30 } from './fetch_hes_index.mjs';

const OUT_30_DIR = process.env.HES_30MIN_DIR || 'public/hes_30min';
const FROM = process.env.FROM || '';
const TO = process.env.TO || '';
const DRY_RUN = process.argv.includes('--dry-run');

const FIELD_MAP = {
  PG: 'ACTIVE_KW_INDICATE_TOTAL',
  BT: 'ACTIVE_KW_INDICATE_RATE1',
  CD: 'ACTIVE_KW_INDICATE_RATE2',
  TD: 'ACTIVE_KW_INDICATE_RATE3',
  VC: 'REACTIVE_KVAR_INDICATE_TOTAL',
};

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
if (!isDay(FROM) || !isDay(TO)) {
  console.error('Cần FROM và TO dạng YYYY-MM-DD (TO là cận trên, không bao gồm).');
  process.exit(1);
}
const day0 = (s) => new Date(`${s}T00:00:00`);
if (day0(TO) <= day0(FROM)) { console.error('TO phải sau FROM.'); process.exit(1); }

const pbToken = await pbLogin();
const { meters } = await liveMeters(pbToken);
console.log(`Danh mục: ${meters.length} công tơ ĐANG TREO (nguồn PocketBase).`);
if (!meters.length) { console.error('Không có công tơ nào — dừng.'); process.exit(1); }

const token = await getToken();
console.log(`Lấy ${FROM} → ${TO} (không gồm ${TO}), mỗi công tơ MỘT lời gọi…`);

const perMeter = await mapLimit(meters, 6, async (m) => {
  const data = await getJson('GetMeterDataByDate', {
    MeterNo: m.serial, StartDate: stamp(day0(FROM)), EndDate: stamp(day0(TO)), Token: token,
  });
  if (!Array.isArray(data)) {
    console.log(`[WARN] ${m.serial}: ${data?.MESSAGE ?? 'API không trả mảng'}`);
    return [];
  }
  const hsn = m.hsn == null ? '' : String(m.hsn);
  return data
    .filter(r => r.DATE_TIME && Number(r.ACTIVE_KW_INDICATE_TOTAL) > 0)
    .map(r => {
      const row = { METER_NO: m.serial, DATE_TIME: r.DATE_TIME, HSN: hsn };
      for (const [k, src] of Object.entries(FIELD_MAP)) row[k] = r[src] ?? '';
      return row;
    });
});

const rows = perMeter.flat().filter(Boolean);
const days = [...new Set(rows.map(r => String(r.DATE_TIME).slice(0, 10)))].sort();
const quiet = meters.filter((_, i) => !perMeter[i]?.length);
console.log(`Thu được ${rows.length} mốc, trải ${days.length} ngày (${days[0]} → ${days[days.length - 1]}).`);
if (quiet.length) {
  console.log(`${quiet.length} công tơ KHÔNG có bản ghi nào trong khoảng: ${quiet.map(m => m.serial).join(', ')}`);
}
if (!rows.length) { console.error('Không có dữ liệu — dừng, không đụng file cũ.'); process.exit(1); }

if (DRY_RUN) {
  console.log('\n[dry-run] sẽ ghi các file:');
  for (const d of days) {
    console.log(`   ${d}.csv — ${rows.filter(r => String(r.DATE_TIME).startsWith(d)).length} dòng`);
  }
  process.exit(0);
}

const w = writeCsv30ByDay(OUT_30_DIR, rows);
console.log(`\n✔ Ghi ${w.days.length} file, tổng ${w.rows} dòng trong ${OUT_30_DIR}/`);
if (w.removed.length) console.log(`Đã xoá ${w.removed.length} ngày quá hạn: ${w.removed.join(', ')}`);
const all = writeIndex30(OUT_30_DIR);
console.log(`Danh mục: ${all.length} ngày (${all[0]} → ${all[all.length - 1]}).`);

#!/usr/bin/env node
/**
 * Đẩy lịch sử `public/hes_index_daily.csv` lên collection `hes_index`.
 *
 * Chạy MỘT LẦN khi chuyển nguồn. Chạy lại an toàn: bản ghi đã có (theo cặp
 * `meter_no` + `date`) thì BỎ QUA, không sửa đè — dữ liệu trên PB sau này do
 * `fetch_hes_index.mjs` ghi với HSN từ Danh mục, còn CSV cũ mang HSN từ HES;
 * đè ngược lại là kéo cái sai quay về.
 *
 * CHỈ TẠO bản ghi trong `hes_index`. Không sửa, không xóa, không chạm collection
 * nào khác.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/hes_index_migrate.mjs --dry-run
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/hes_index_migrate.mjs
 *   ... --from 2026-01-01 --to 2026-03-31     (giới hạn khoảng ngày)
 */
import { readFileSync, existsSync } from 'node:fs';

const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || process.env.PB_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || process.env.PB_PASS || '';
const CSV_PATH = process.env.HES_INDEX_PATH || 'public/hes_index_daily.csv';
const DRY_RUN = process.argv.includes('--dry-run');

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
};
const FROM = argOf('--from');
const TO = argOf('--to');

const NAME = 'hes_index';

async function call(method, path, token, body) {
  const res = await fetch(`${PB_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${path}\n${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** CSV của pipeline không có dấu phẩy trong ô nên tách thô là đủ. */
function readCsv(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map(l => {
    const cells = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h.trim(), (cells[i] ?? '').trim()]));
  });
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Thiếu PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD (hoặc PB_EMAIL/PB_PASS)');
    process.exit(1);
  }
  if (!existsSync(CSV_PATH)) { console.error(`Không thấy ${CSV_PATH}`); process.exit(1); }

  let rows = readCsv(CSV_PATH);
  if (FROM) rows = rows.filter(r => r.DATE >= FROM);
  if (TO) rows = rows.filter(r => r.DATE <= TO);
  const days = new Set(rows.map(r => r.DATE));
  console.log(`PB: ${PB_URL}`);
  console.log(`${CSV_PATH}: ${rows.length} dòng, ${days.size} ngày`
    + `${FROM || TO ? ` (lọc ${FROM || '…'} → ${TO || '…'})` : ''}`);
  if (!rows.length) { console.log('Không có dòng nào để đẩy.'); return; }

  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });

  /* Tải trước các cặp (meter_no, date) ĐÃ CÓ — rẻ hơn nhiều so với hỏi từng dòng. */
  const existing = new Set();
  for (let page = 1; ; page++) {
    const r = await call('GET',
      `/api/collections/${NAME}/records?perPage=500&page=${page}&fields=meter_no,date`, token);
    for (const it of r.items) existing.add(`${it.meter_no}|${it.date}`);
    if (page >= (r.totalPages ?? 1)) break;
  }
  console.log(`Trên PB đang có ${existing.size} bản ghi.`);

  const todo = rows.filter(r => !existing.has(`${r.METER_NO}|${r.DATE}`));
  console.log(`Cần đẩy ${todo.length} bản ghi (bỏ qua ${rows.length - todo.length} đã có).`);
  if (DRY_RUN) {
    for (const r of todo.slice(0, 5)) console.log(`   [dry-run] ${r.METER_NO} ${r.DATE}`);
    if (todo.length > 5) console.log(`   [dry-run] … và ${todo.length - 5} dòng nữa`);
    return;
  }

  let done = 0, failed = 0;
  for (const r of todo) {
    const body = {
      meter_no: r.METER_NO, date: r.DATE, hsn: num(r.HSN),
      start_time: r.START_TIME, end_time: r.END_TIME,
      pg_start: num(r.PG_START), bt_start: num(r.BT_START), cd_start: num(r.CD_START),
      td_start: num(r.TD_START), vc_start: num(r.VC_START),
      pg_end: num(r.PG_END), bt_end: num(r.BT_END), cd_end: num(r.CD_END),
      td_end: num(r.TD_END), vc_end: num(r.VC_END),
      /* CSV cũ không có 2 cột này — để trống, không bịa. */
      regress: '', no_data: false,
    };
    try {
      await call('POST', `/api/collections/${NAME}/records`, token, body);
      done++;
      if (done % 500 === 0) console.log(`   … ${done}/${todo.length}`);
    } catch (e) {
      failed++;
      if (failed <= 5) console.log(`[WARN] ${r.METER_NO} ${r.DATE}: ${String(e).slice(0, 160)}`);
    }
  }
  console.log(`\n✔ Đã đẩy ${done} bản ghi${failed ? `, lỗi ${failed}` : ''}.`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });

#!/usr/bin/env node
/**
 * Lấy chỉ số công tơ đầu/cuối kỳ theo NGÀY từ `GetMeterDataByDate`, ghi ra
 * `public/hes_index_daily.csv` và (nếu có tài khoản) collection `hes_index`.
 *
 * Thay cho `fetch_hes_index.py`. Khác bản Python ở hai chỗ:
 *   1. Danh sách công tơ lấy từ DANH MỤC PocketBase (công tơ ĐANG TREO), không
 *      phải `metterinfo.csv` — bản kết xuất HES trễ một ngày và không biết gì
 *      về những gì vừa khai trong Danh mục.
 *   2. HSN lấy từ `dm_point.hsn` (suy theo bộ TI/TU đang treo), không phải
 *      `METER_NAME` của HES. Đây chính là chỗ sai đã làm phần tổn thất phải
 *      dừng ngày 16/09/2026.
 *
 * Quy ước kỳ (giữ nguyên bản Python):
 *   đầu kỳ  = 00:00 ngày D      (mặc định D = hôm qua theo giờ VN)
 *   cuối kỳ = 00:00 ngày D+1
 *   Sản lượng ngày D = (chỉ số cuối − chỉ số đầu) × HSN — nơi đọc tự nhân.
 *
 * 5 chỉ số lấy là chiều ACTIVE, tức phần TÍNH TIỀN ĐIỆN (xem `document/API_HES.md`;
 * tài liệu gọi theo góc nhìn bên bán là "chiều giao"):
 *   PG = ACTIVE_KW_INDICATE_TOTAL     BT = ACTIVE_KW_INDICATE_RATE1
 *   CD = ACTIVE_KW_INDICATE_RATE2     TD = ACTIVE_KW_INDICATE_RATE3
 *   VC = REACTIVE_KVAR_INDICATE_TOTAL
 * Lưu RAW, CHƯA nhân HSN.
 *
 * Biến môi trường:
 *   TARGET_DATE   rỗng = hôm qua · "YYYY-MM-DD" · số N = lùi N ngày
 *   KEEP_DAYS     0 = giữ toàn bộ lịch sử trong CSV (mặc định — xem ghi chú dưới)
 *   WINDOW_STEPS  các bước nới rộng cửa sổ quanh mốc 00:00, phút. Mặc định 60,180,1440
 *   HES_INDEX_PATH  đường dẫn CSV. Mặc định public/hes_index_daily.csv
 *   PB_EMAIL/PB_PASS (hoặc PB_ADMIN_*), API_TOKEN hoặc API_USER/API_PASS
 *
 * Vì sao KEEP_DAYS mặc định 0 chứ không phải 7: màn "Lấy chỉ số HES" cho người
 * dùng chọn kỳ tùy ý (thường là cả tháng) và tính theo `row[đến].END −
 * row[từ].START`. Cắt CSV còn 7 ngày TRƯỚC KHI app chuyển sang đọc `hes_index`
 * trên PB là làm hỏng màn đó. Đổi mặc định khi app đã đọc PB.
 *
 * Ghi PocketBase: chỉ đụng collection `hes_index`. Thiếu tài khoản thì bỏ qua
 * phần PB và vẫn ghi CSV, không làm hỏng lần chạy.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getJson, getToken, mapLimit, stamp } from './lib/hes_api.mjs';
import { pbLogin, liveMeters, PB_URL } from './lib/pb_meters.mjs';

const OUT_PATH = process.env.HES_INDEX_PATH || 'public/hes_index_daily.csv';
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 0);
const WINDOW_STEPS = (process.env.WINDOW_STEPS || '60,180,1440').split(',').map(Number);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const PB_COLLECTION = 'hes_index';

/** Cột CSV → trường HES. Thứ tự này cũng là thứ tự cột trong file. */
const FIELD_MAP = {
  PG: 'ACTIVE_KW_INDICATE_TOTAL',
  BT: 'ACTIVE_KW_INDICATE_RATE1',
  CD: 'ACTIVE_KW_INDICATE_RATE2',
  TD: 'ACTIVE_KW_INDICATE_RATE3',
  VC: 'REACTIVE_KVAR_INDICATE_TOTAL',
};
const KEYS = Object.keys(FIELD_MAP);
const OUT_FIELDS = [
  'METER_NO', 'DATE', 'HSN', 'START_TIME', 'END_TIME',
  ...KEYS.map(k => `${k}_START`), ...KEYS.map(k => `${k}_END`),
  /* Hai cột mới NỐI VÀO CUỐI để reader cũ (đọc theo tên cột) không phải sửa. */
  'REGRESS', 'NO_DATA',
];

/* ----------------------------- ngày tháng ----------------------------- */
/** Hôm nay theo giờ VN, bất kể máy chạy ở múi nào. */
function todayVn() {
  const now = new Date();
  const vn = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60000);
  return new Date(vn.getFullYear(), vn.getMonth(), vn.getDate());
}

function targetDay() {
  const raw = (process.env.TARGET_DATE || '').trim();
  const today = todayVn();
  if (!raw) return new Date(today.getTime() - 86400000);
  if (/^\d+$/.test(raw)) return new Date(today.getTime() - Number(raw) * 86400000);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) {
    console.error(`TARGET_DATE không hợp lệ: ${raw}. Dùng "YYYY-MM-DD" hoặc số ngày lùi.`);
    process.exit(1);
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  + `-${String(d.getDate()).padStart(2, '0')}`;

/* ------------------------------- lấy dữ liệu ------------------------------- */
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const recTime = (r) => r?.DATE_TIME || r?.DATA_TIME || '';

/**
 * Bản ghi hợp lệ GẦN mốc `boundary` nhất; nới rộng cửa sổ dần theo WINDOW_STEPS.
 * `null` nếu không tìm thấy ở mọi bước.
 */
async function fetchBoundary(token, meterNo, boundary) {
  const start = stamp(boundary);
  for (const win of WINDOW_STEPS) {
    let data;
    try {
      data = await getJson('GetMeterDataByDate', {
        MeterNo: meterNo, StartDate: start,
        EndDate: stamp(new Date(boundary.getTime() + win * 60000)), Token: token,
      });
    } catch (e) {
      console.log(`[WARN] ${meterNo} @ ${start}: lỗi API (${String(e).slice(0, 80)})`);
      return null;
    }
    if (!Array.isArray(data)) {
      if (String(data?.MESSAGE ?? '').toLowerCase() === 'invalid token') throw new Error('invalid token');
      continue;
    }
    const valid = data.filter(r => toNum(r.ACTIVE_KW_INDICATE_TOTAL) > 0);
    if (!valid.length) continue;
    valid.sort((a, b) =>
      Math.abs(new Date(recTime(a).replace(' ', 'T')) - boundary)
      - Math.abs(new Date(recTime(b).replace(' ', 'T')) - boundary));
    return valid[0];
  }
  return null;
}

function buildRow(meterNo, hsn, day, startRec, endRec) {
  const row = {
    METER_NO: meterNo, DATE: ymd(day),
    HSN: hsn == null ? '' : String(hsn),
    START_TIME: recTime(startRec), END_TIME: recTime(endRec),
    /* REGRESS tính ở T6 — chưa có thì để rỗng, không bịa. */
    REGRESS: '',
    NO_DATA: startRec && endRec ? '' : '1',
  };
  for (const [k, src] of Object.entries(FIELD_MAP)) {
    row[`${k}_START`] = startRec?.[src] ?? '';
    row[`${k}_END`] = endRec?.[src] ?? '';
  }
  return row;
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

/** Gộp với file cũ theo khóa (METER_NO, DATE) → chạy lại an toàn. */
export function writeCsv(path, newRows) {
  const merged = new Map();
  for (const r of readCsv(path)) merged.set(`${r.METER_NO}|${r.DATE}`, r);
  for (const r of newRows) merged.set(`${r.METER_NO}|${r.DATE}`, r);

  let rows = [...merged.values()];
  if (KEEP_DAYS > 0) {
    const cutoff = ymd(new Date(todayVn().getTime() - KEEP_DAYS * 86400000));
    const kept = rows.filter(r => (r.DATE ?? '') >= cutoff);
    /*
      Chốt chặn: pipeline nghỉ vài ngày (Actions hỏng, token hết hạn) là mọi dòng
      đều cũ hơn mốc cắt, prune sẽ quét sạch file. Thà giữ dữ liệu cũ còn hơn
      đưa ra một file rỗng — nơi đọc không phân biệt được "chưa có" với "vừa mất".
    */
    if (kept.length) rows = kept;
    else if (rows.length) {
      console.log(`[CẢNH BÁO] Mọi dòng đều cũ hơn ${cutoff} — GIỮ NGUYÊN ${rows.length} dòng `
        + 'thay vì cắt sạch. Kiểm tra xem pipeline có đang chạy không.');
    }
  }
  rows.sort((a, b) => (a.DATE + a.METER_NO).localeCompare(b.DATE + b.METER_NO));

  mkdirSync(dirname(path), { recursive: true });
  const body = rows.map(r => OUT_FIELDS.map(f => r[f] ?? '').join(','));
  writeFileSync(path, [OUT_FIELDS.join(','), ...body].join('\n') + '\n', 'utf8');
  return rows.length;
}

/* ------------------------------ PocketBase ------------------------------ */
const pbNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Ghi vào `hes_index`: có rồi thì cập nhật, chưa có thì tạo. Chỉ đụng collection này. */
async function writePb(token, rows) {
  const api = `${PB_URL}/api/collections/${PB_COLLECTION}/records`;
  const headers = { Authorization: token, 'Content-Type': 'application/json' };
  let created = 0, updated = 0, failed = 0;

  for (const r of rows) {
    const body = {
      meter_no: r.METER_NO, date: r.DATE, hsn: pbNum(r.HSN),
      start_time: r.START_TIME, end_time: r.END_TIME,
      regress: r.REGRESS, no_data: r.NO_DATA === '1',
    };
    for (const k of KEYS) {
      body[`${k.toLowerCase()}_start`] = pbNum(r[`${k}_START`]);
      body[`${k.toLowerCase()}_end`] = pbNum(r[`${k}_END`]);
    }
    try {
      const q = `${api}?perPage=1&filter=`
        + encodeURIComponent(`meter_no=${JSON.stringify(r.METER_NO)} && date=${JSON.stringify(r.DATE)}`);
      const found = await (await fetch(q, { headers })).json();
      const id = found.items?.[0]?.id;
      const res = id
        ? await fetch(`${api}/${id}`, { method: 'PATCH', headers, body: JSON.stringify(body) })
        : await fetch(api, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) { failed++; if (failed <= 3) console.log(`[WARN] PB ${r.METER_NO}: ${res.status}`); }
      else if (id) updated++; else created++;
    } catch (e) {
      failed++;
      if (failed <= 3) console.log(`[WARN] PB ${r.METER_NO}: ${String(e).slice(0, 100)}`);
    }
  }
  return { created, updated, failed };
}

/* --------------------------------- main --------------------------------- */
/*
  Chỉ chạy khi gọi thẳng file này. Import từ nơi khác (script kiểm thử, hoặc
  script backfill dùng lại `writeCsv`) thì không tự nổ ra một lượt gọi API.
*/
async function main() {
const day = targetDay();
const startBoundary = day;
const endBoundary = new Date(day.getTime() + 86400000);
console.log(`Kỳ ngày ${ymd(day)}: đầu=${ymd(startBoundary)} 00:00, cuối=${ymd(endBoundary)} 00:00`);

const pbToken = await pbLogin();
const { meters } = await liveMeters(pbToken);
console.log(`Danh mục: ${meters.length} công tơ ĐANG TREO (nguồn PocketBase).`);
if (!meters.length) { console.error('Không có công tơ nào — dừng, không ghi đè file cũ.'); process.exit(1); }

const noHsn = meters.filter(m => m.hsn == null);
if (noHsn.length) {
  console.log(`[CẢNH BÁO] ${noHsn.length} công tơ chưa có HSN trong Danh mục — `
    + `sản lượng của chúng sẽ không tính được: ${noHsn.map(m => m.serial).join(', ')}`);
}

const hesToken = await getToken();
const results = await mapLimit(meters, CONCURRENCY, async (m) => {
  const [s, e] = [await fetchBoundary(hesToken, m.serial, startBoundary),
                  await fetchBoundary(hesToken, m.serial, endBoundary)];
  return buildRow(m.serial, m.hsn, day, s, e);
});

const rows = results.filter(r => r && r.METER_NO);
const noData = rows.filter(r => r.NO_DATA === '1');
console.log(`Lấy được ${rows.length - noData.length}/${rows.length} công tơ có đủ chỉ số hai đầu.`);
if (noData.length) {
  console.log(`Thiếu chỉ số (NO_DATA=1): ${noData.map(r => r.METER_NO).join(', ')}`);
}
if (rows.length === noData.length) {
  console.error('Không công tơ nào có chỉ số — dừng, không ghi đè file cũ.');
  process.exit(1);
}

const total = writeCsv(OUT_PATH, rows);
console.log(`Ghi ${rows.length} dòng. Tổng file: ${total} dòng → ${OUT_PATH}`);

const pb = await writePb(pbToken, rows);
console.log(`PocketBase \`${PB_COLLECTION}\`: tạo ${pb.created}, cập nhật ${pb.updated}`
  + `${pb.failed ? `, lỗi ${pb.failed}` : ''}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

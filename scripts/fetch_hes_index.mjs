#!/usr/bin/env node
/**
 * Lấy chỉ số công tơ từ `GetMeterDataByDate` và ghi ra BA nơi:
 *   - `public/hes_index_30min.csv`  chi tiết 30 phút, giữ 7 ngày (file nóng)
 *   - `public/hes_index_daily.csv`  đầu/cuối kỳ theo ngày (giữ như cũ)
 *   - collection `hes_index` trên PocketBase — bản NGÀY, lịch sử dài
 *
 * Một lời gọi API cho mỗi công tơ trả sẵn 49 bản ghi (48 mốc 30 phút + mốc
 * 00:00 hôm sau), rút ra được cả ba. Bản Python cũ gọi HAI lần với hai cửa sổ
 * nhỏ rồi vứt 47 bản ghi.
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
 *   KEEP_DAYS_30  số ngày giữ trong file 30 phút. Mặc định 7
 *   HES_INDEX_PATH  đường dẫn CSV ngày.     Mặc định public/hes_index_daily.csv
 *   HES_30MIN_PATH  đường dẫn CSV 30 phút.  Mặc định public/hes_index_30min.csv
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
/** Chi tiết 30 phút — file nóng, chỉ giữ ít ngày vì nó nặng gấp 48 lần bản ngày. */
const OUT_30_PATH = process.env.HES_30MIN_PATH || 'public/hes_index_30min.csv';
const KEEP_DAYS_30 = Number(process.env.KEEP_DAYS_30 || 7);
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

/** Cột của file 30 phút. Một dòng = một công tơ tại một mốc. */
const OUT_30_FIELDS = ['METER_NO', 'DATE_TIME', 'HSN', ...KEYS];

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
 * TOÀN BỘ bản ghi của một công tơ trong ngày D, sắp theo thời gian tăng dần.
 *
 * API trả sẵn 49 bản ghi cho một ngày: 48 mốc 30 phút + mốc 00:00 hôm sau. Bản
 * cũ gọi HAI lần với hai cửa sổ nhỏ quanh 00:00 rồi vứt 47 bản ghi — vừa tốn
 * gấp đôi lời gọi, vừa sinh ra lỗi CHỒNG MỐC (cuối kỳ vớt phải bản 00:30 trong
 * khi đầu kỳ hôm sau là 00:00, nên 30 phút đó tính sản lượng vào cả hai ngày).
 * Lấy trọn ngày thì mốc nào cũng có sẵn, lấy đúng mốc cần.
 */
export async function fetchDay(token, meterNo, day) {
  let data;
  try {
    data = await getJson('GetMeterDataByDate', {
      MeterNo: meterNo, StartDate: stamp(day),
      EndDate: stamp(new Date(day.getTime() + 86400000)), Token: token,
    });
  } catch (e) {
    console.log(`[WARN] ${meterNo} @ ${ymd(day)}: lỗi API (${String(e).slice(0, 80)})`);
    return [];
  }
  if (!Array.isArray(data)) {
    if (String(data?.MESSAGE ?? '').toLowerCase() === 'invalid token') throw new Error('invalid token');
    return [];
  }
  return data
    .filter(r => recTime(r) && toNum(r.ACTIVE_KW_INDICATE_TOTAL) > 0)
    .sort((a, b) => recTime(a).localeCompare(recTime(b)));
}

/**
 * Hai bản ghi biên của ngày D: đúng mốc 00:00 ngày D và 00:00 ngày D+1.
 *
 * Thiếu mốc đúng thì lùi về bản ghi sớm nhất / muộn nhất trong ngày và GHI LẠI
 * thời điểm thật vào `START_TIME`/`END_TIME` — nơi đọc còn biết kỳ này không
 * trọn ngày, thay vì tưởng là đủ.
 */
export function boundariesOf(recs, day) {
  if (!recs.length) return [null, null];
  const at = (d) => `${ymd(d)} 00:00:00`;
  const start = recs.find(r => recTime(r) === at(day)) ?? recs[0];
  const endStamp = at(new Date(day.getTime() + 86400000));
  const end = recs.find(r => recTime(r) === endStamp) ?? recs[recs.length - 1];
  /* Một bản ghi duy nhất thì không đủ hai biên — coi như thiếu dữ liệu. */
  return start === end ? [null, null] : [start, end];
}

/* ------------------------------ thụt lùi ------------------------------ */
/**
 * Dung sai khi so chỉ số — chênh dưới mức này coi như sai số làm tròn của công
 * tơ, không phải thụt lùi.
 */
const EPS = Number(process.env.REGRESS_EPS || 0.001);

/**
 * Các chỉ số CHẠY THỤT LÙI của một dòng, dạng "PG,VC". Rỗng = bình thường.
 *
 * Chỉ số lũy kế chỉ được phép tăng, nên xét hai chiều:
 *   1. Trong ngày : X_END < X_START
 *   2. Liên ngày  : X_START hôm nay < X_END hôm qua
 *
 * Công tơ vừa THAY hoặc vừa RESET cũng rơi vào trường hợp 2 và KHÔNG phân biệt
 * được tự động — dữ liệu không mang thông tin đó. Vì vậy `REGRESS` là tín hiệu
 * để người dùng tra, KHÔNG phải kết luận công tơ lỗi. Dòng vẫn lưu số liệu thật
 * (user chốt 16/09/2026), không xoá, không sửa.
 *
 * Ô rỗng (thiếu chỉ số) thì bỏ qua, không coi là thụt lùi — đã có `NO_DATA` lo.
 */
export function regressOf(cur, prev) {
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
  const bad = [];
  /*
    So liên ngày chỉ có nghĩa khi hai mốc KHÔNG chồng nhau. Cuối kỳ hôm qua có
    thể rơi vào 00:30 (lúc chạy chưa có bản ghi 00:00, cửa sổ nới rộng vớt được
    bản muộn hơn) trong khi đầu kỳ hôm nay là 00:00 — chỉ số hôm nay thấp hơn là
    ĐƯƠNG NHIÊN, không phải thụt lùi. Xem `overlapOf`.
  */
  const overlapped = overlapOf(cur, prev);
  for (const k of KEYS) {
    const s = cur[`${k}_START`], e = cur[`${k}_END`];
    if (has(s) && has(e) && Number(e) < Number(s) - EPS) { bad.push(k); continue; }
    if (overlapped) continue;
    const p = prev?.[`${k}_END`];
    if (has(s) && has(p) && Number(s) < Number(p) - EPS) bad.push(k);
  }
  return bad.join(',');
}

/**
 * Hai kỳ liên tiếp có CHỒNG MỐC không: cuối kỳ hôm qua muộn hơn đầu kỳ hôm nay.
 *
 * Khi đó khoảng [đầu hôm nay → cuối hôm qua] bị tính vào CẢ HAI ngày, tức sản
 * lượng cộng trùng. Đây là lỗi dữ liệu riêng, không phải thụt lùi, nên chỉ cảnh
 * báo chứ không gắn cờ `REGRESS`.
 */
export function overlapOf(cur, prev) {
  const a = prev?.END_TIME, b = cur?.START_TIME;
  if (!a || !b) return false;
  return new Date(String(a).replace(' ', 'T')) > new Date(String(b).replace(' ', 'T'));
}

/**
 * Chỉ số ngày liền trước theo công tơ, để xét thụt lùi liên ngày.
 * Ưu tiên PocketBase (không phụ thuộc cửa sổ giữ ngày của CSV); PB chưa có dữ
 * liệu thì lùi về đọc chính file CSV.
 */
async function prevDayRows(pbToken, day) {
  const prev = ymd(new Date(day.getTime() - 86400000));
  const out = new Map();
  try {
    const headers = { Authorization: pbToken };
    for (let page = 1; ; page++) {
      const url = `${PB_URL}/api/collections/${PB_COLLECTION}/records?perPage=500&page=${page}`
        + `&filter=${encodeURIComponent(`date=${JSON.stringify(prev)}`)}`;
      const r = await (await fetch(url, { headers })).json();
      for (const it of r.items ?? []) {
        const row = { END_TIME: it.end_time };
        for (const k of KEYS) row[`${k}_END`] = it[`${k.toLowerCase()}_end`];
        out.set(it.meter_no, row);
      }
      if (page >= (r.totalPages ?? 1)) break;
    }
  } catch { /* PB chưa có collection hoặc mất mạng — dùng CSV bên dưới */ }

  if (out.size) return { prev, rows: out, src: 'PocketBase' };
  for (const r of readCsv(OUT_PATH)) if (r.DATE === prev) out.set(r.METER_NO, r);
  return { prev, rows: out, src: out.size ? 'CSV' : 'không có' };
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

/**
 * Ghi file chi tiết 30 phút. Khóa gộp là (METER_NO, DATE_TIME) nên chạy lại
 * cùng ngày chỉ ghi đè đúng các mốc của ngày đó.
 *
 * Cắt theo `KEEP_DAYS_30` (mặc định 7): ~115 công tơ × 48 mốc = 5.520 dòng/ngày,
 * tức ~385 KB/ngày. Giữ cả năm là 137 MB trong thư mục CÔNG KHAI — không được.
 * Lịch sử dài nằm ở bản NGÀY trên PocketBase.
 */
export function writeCsv30(path, rows) {
  const merged = new Map();
  for (const r of readCsv(path)) merged.set(`${r.METER_NO}|${r.DATE_TIME}`, r);
  for (const r of rows) merged.set(`${r.METER_NO}|${r.DATE_TIME}`, r);

  let out = [...merged.values()];
  if (KEEP_DAYS_30 > 0) {
    const cutoff = ymd(new Date(todayVn().getTime() - KEEP_DAYS_30 * 86400000));
    const kept = out.filter(r => String(r.DATE_TIME ?? '').slice(0, 10) >= cutoff);
    /* Cùng chốt chặn như bản ngày: thà giữ dữ liệu cũ còn hơn ra file rỗng. */
    if (kept.length) out = kept;
    else if (out.length) {
      console.log(`[CẢNH BÁO] File 30 phút: mọi mốc đều cũ hơn ${cutoff} — giữ nguyên ${out.length} dòng.`);
    }
  }
  out.sort((a, b) => (a.DATE_TIME + a.METER_NO).localeCompare(b.DATE_TIME + b.METER_NO));

  mkdirSync(dirname(path), { recursive: true });
  const body = out.map(r => OUT_30_FIELDS.map(f => r[f] ?? '').join(','));
  writeFileSync(path, [OUT_30_FIELDS.join(','), ...body].join('\n') + '\n', 'utf8');
  return out.length;
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
/*
  MỘT lời gọi cho mỗi công tơ, lấy trọn ngày. Từ cùng một mẻ bản ghi rút ra cả
  hai thứ: chi tiết 30 phút, và hai biên của ngày. Vì hai biên lấy từ chính mẻ
  này nên không thể lệch mốc như cách gọi hai lần trước đây.
*/
const results = await mapLimit(meters, CONCURRENCY, async (m) => {
  const recs = await fetchDay(hesToken, m.serial, day);
  const [s, e] = boundariesOf(recs, day);
  const hsn = m.hsn == null ? '' : String(m.hsn);
  const detail = recs.map(r => {
    const row = { METER_NO: m.serial, DATE_TIME: recTime(r), HSN: hsn };
    for (const [k, src] of Object.entries(FIELD_MAP)) row[k] = r[src] ?? '';
    return row;
  });
  return { daily: buildRow(m.serial, m.hsn, day, s, e), detail };
});

const rows = results.filter(r => r?.daily?.METER_NO).map(r => r.daily);
const rows30 = results.flatMap(r => r?.detail ?? []);

/* Cờ thụt lùi — cần chỉ số ngày liền trước, nên làm sau khi đã có cả mẻ. */
const { prev, rows: prevRows, src } = await prevDayRows(pbToken, day);
console.log(`Chỉ số ngày liền trước (${prev}): ${prevRows.size} công tơ, nguồn ${src}.`);
for (const r of rows) r.REGRESS = regressOf(r, prevRows.get(r.METER_NO));

const overlapped = rows.filter(r => overlapOf(r, prevRows.get(r.METER_NO)));
if (overlapped.length) {
  console.log(`\n[CẢNH BÁO] ${overlapped.length} công tơ CHỒNG MỐC với ngày ${prev}: cuối kỳ hôm đó `
    + 'muộn hơn đầu kỳ hôm nay, nên phần chồng bị tính sản lượng vào cả hai ngày.');
  for (const r of overlapped) {
    console.log(`   ${r.METER_NO.padEnd(12)} cuối ${prevRows.get(r.METER_NO).END_TIME} > đầu ${r.START_TIME}`);
  }
}

const regressed = rows.filter(r => r.REGRESS);
if (regressed.length) {
  console.log(`\n[CẢNH BÁO] ${regressed.length} công tơ có chỉ số CHẠY THỤT LÙI `
    + '(có thể do thay/reset công tơ — cần tra, không phải kết luận lỗi):');
  for (const r of regressed) console.log(`   ${r.METER_NO.padEnd(12)} ${r.REGRESS}`);
}

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

const total30 = writeCsv30(OUT_30_PATH, rows30);
console.log(`Chi tiết 30 phút: ghi ${rows30.length} mốc, giữ ${KEEP_DAYS_30} ngày. `
  + `Tổng file: ${total30} dòng → ${OUT_30_PATH}`);

const pb = await writePb(pbToken, rows);
console.log(`PocketBase \`${PB_COLLECTION}\`: tạo ${pb.created}, cập nhật ${pb.updated}`
  + `${pb.failed ? `, lỗi ${pb.failed}` : ''}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

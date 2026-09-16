#!/usr/bin/env node
/**
 * Lấy chỉ số công tơ từ `GetMeterDataByDate`, ghi chi tiết 30 phút vào thư mục
 * `public/hes_30min/` — MỖI NGÀY MỘT FILE `YYYY-MM-DD.csv`, giữ 30 ngày gần
 * nhất, kèm `index.json` liệt kê các ngày đang có.
 *
 * Một lời gọi API cho mỗi công tơ trả sẵn 49 bản ghi (48 mốc 30 phút + mốc
 * 00:00 hôm sau). Bản Python cũ gọi HAI lần với hai cửa sổ nhỏ rồi vứt 47 bản
 * ghi — vừa tốn gấp đôi lời gọi, vừa sinh lỗi chồng mốc.
 *
 * KHÔNG còn ghi `hes_index_daily.csv` (bỏ 16/09/2026). Tab đọc file đó đã thay
 * bằng "Chỉ số theo hóa đơn" lấy từ `invoice` — nguồn chuẩn hơn; còn file ngày
 * bắt trình duyệt tải trọn 2,9 MB rồi chỉ dùng 2 dòng mỗi công tơ. Cần lại bản
 * cũ thì lấy từ lịch sử git: `git show <commit>:public/hes_index_daily.csv`.
 *
 * Chỉ số ngày vẫn TÍNH trong bộ nhớ để dò thụt lùi và báo công tơ thiếu dữ
 * liệu — chỉ là không ghi ra file nữa.
 *
 * KHÔNG ghi PocketBase. Đã thử collection `hes_index` ngày 16/09/2026 rồi bỏ:
 * chỉ số đầu/cuối kỳ có giá trị pháp lý đã nằm ở `invoice` (màn Biên bản xác
 * nhận chỉ số ghi vào đó), nên thêm một bản sao chi tiết hơn trên PB là thừa.
 * PocketBase giữ dữ liệu nghiệp vụ; CSV giữ số liệu thô của pipeline.
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
 *   KEEP_DAYS_30  số ngày giữ trong file 30 phút. Mặc định 30
 *   HES_30MIN_DIR   thư mục CSV 30 phút.   Mặc định public/hes_30min
 *   PB_EMAIL/PB_PASS (hoặc PB_ADMIN_*), API_TOKEN hoặc API_USER/API_PASS
 *
 * Vẫn cần tài khoản PocketBase, nhưng CHỈ ĐỂ ĐỌC danh mục công tơ (`dm_*`).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getJson, getToken, mapLimit, stamp } from './lib/hes_api.mjs';
import { pbLogin, liveMeters } from './lib/pb_meters.mjs';
import { raiseAlert, zoneOf } from './lib/pb_alert.mjs';

/**
 * Chi tiết 30 phút — 115 công tơ × 48 mốc ≈ 5.520 dòng ≈ 385 KB MỘT NGÀY.
 *
 * Gom 30 ngày vào một file là 11,7 MB, mà app chỉ cần 2 ngày cho mỗi lần tra.
 * Nên tách mỗi ngày một file (user chốt 16/09/2026): tra một kỳ chỉ tải 2 file
 * ~770 KB, và mỗi đêm Git chỉ nhận thêm một blob nhỏ thay vì ghi lại cả file.
 */
const OUT_30_DIR = process.env.HES_30MIN_DIR || 'public/hes_30min';
const KEEP_DAYS_30 = Number(process.env.KEEP_DAYS_30 || 30);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);

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
 * MỌI thanh ghi chỉ số lũy kế mà HES trả về — cả chiều giao lẫn chiều nhận.
 *
 * Bản đầu chỉ soi 5 trường chiều giao nên bỏ sót hẳn các ca lùi ở "vô công
 * nhận" (phát hiện khi đối chiếu báo cáo của user ngày 16/09/2026).
 */
const REGISTERS = {
  'Hữu công giao – tổng':   'ACTIVE_KW_INDICATE_TOTAL',
  'Hữu công giao – biểu 1': 'ACTIVE_KW_INDICATE_RATE1',
  'Hữu công giao – biểu 2': 'ACTIVE_KW_INDICATE_RATE2',
  'Hữu công giao – biểu 3': 'ACTIVE_KW_INDICATE_RATE3',
  'Hữu công nhận – tổng':   'NEGACTIVE_KW_INDICATE_TOTAL',
  'Hữu công nhận – biểu 1': 'NEGACTIVE_KW_INDICATE_RATE1',
  'Hữu công nhận – biểu 2': 'NEGACTIVE_KW_INDICATE_RATE2',
  'Hữu công nhận – biểu 3': 'NEGACTIVE_KW_INDICATE_RATE3',
  'Vô công giao – tổng':    'REACTIVE_KVAR_INDICATE_TOTAL',
  'Vô công nhận – tổng':    'NEGACTIVE_KVAR_INDICATE_TOTAL',
};

/**
 * Cột CSV → tên biểu đọc được, suy từ FIELD_MAP + REGISTERS.
 *
 * Dùng cho ca lùi ở CHỖ NỐI NGÀY: chỗ đó so hai cột CSV (`PG_END` hôm trước với
 * `PG_START` hôm nay) chứ không so bản ghi thô, nên chỉ có mã cột trong tay.
 */
const LABEL_OF_KEY = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([key, field]) => [
    key,
    Object.entries(REGISTERS).find(([, f]) => f === field)?.[0] ?? key,
  ]));


/**
 * Bước của chữ số cuối cùng mà HES trả về (3 chữ số thập phân).
 *
 * Lùi ĐÚNG một bước là sai số làm tròn của hệ thống, không phải công tơ chạy
 * ngược: đối chiếu 21 ngày (27/08–16/09/2026) cho 102 ca lùi thì CẢ 102 đều
 * đúng −0.001, và dồn vào vài mốc giờ (76 ca cùng lúc 15/09 02:30) — dấu hiệu
 * của tác vụ nền bên HES, không phải hỏng công tơ.
 *
 * Quy ra sản lượng, 0.001 × HSN lớn nhất (3000) = 3 kWh, không ảnh hưởng hóa đơn.
 */
const ROUNDING_STEP = Number(process.env.REGRESS_ROUNDING || 0.001);
/** Nới một chút cho sai số dấu phẩy động khi trừ hai số thập phân. */
const FLOAT_SLOP = 1e-9;

const _n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };

/**
 * Soi TỪNG CẶP MỐC LIÊN TIẾP trong ngày, trên mọi thanh ghi. Chỉ số lũy kế chỉ
 * được phép tăng; giảm là bất thường.
 *
 * Quan trọng: KHÔNG dùng dung sai để bỏ qua. Bản đầu đặt `EPS = 0.001` với điều
 * kiện `b < a - EPS`, mà mức lùi thực tế đúng bằng 0.001 → không ca nào lọt
 * lưới, soát 249 ngày vẫn ra 0. Giờ so thẳng `b < a` rồi mới PHÂN LOẠI theo mức.
 *
 * Bản đầu còn chỉ so hai mốc biên của ngày (00:00 và 00:00 hôm sau) nên chỉ số
 * tụt rồi phục hồi trong ngày là mất dấu. Soi hết 48 mốc thì không.
 */
export function scanRegress(recs) {
  const out = [];
  for (let i = 1; i < recs.length; i++) {
    for (const [label, src] of Object.entries(REGISTERS)) {
      const a = _n(recs[i - 1][src]);
      const b = _n(recs[i][src]);
      if (a === null || b === null || b >= a) continue;
      const gap = a - b;
      out.push({
        label, at: recTime(recs[i]), from: a, to: b, gap,
        /* Mốc TRƯỚC — bảng cảnh báo cần khoảng "từ mấy giờ đến mấy giờ", một
           mốc đơn không nói được chỉ số tụt trong khoảng nào. */
        fromAt: recTime(recs[i - 1]),
        /* Lùi đúng một bước chữ số cuối = sai số làm tròn của HES, không phải công tơ ngược. */
        rounding: gap <= ROUNDING_STEP + FLOAT_SLOP,
      });
    }
  }
  return out;
}

/**
 * Chỉ số ngày liền trước theo công tơ, để xét thụt lùi liên ngày.
 *
 * Đọc từ chính file CSV ngày. Trước đây ưu tiên PocketBase, nhưng chỉ số đầu/
 * cuối kỳ có giá trị pháp lý đã nằm ở `invoice` rồi — thêm một bản sao chi tiết
 * hơn trên PB là thừa (user chốt 16/09/2026).
 *
 */
function prevDayRows(day) {
  const prev = ymd(new Date(day.getTime() - 86400000));
  const out = new Map();
  /*
    Lấy MỐC MUỘN NHẤT của ngày hôm trước (thường 23:30) trong file ngày đó.

    Không so với "cuối kỳ hôm qua" nữa: từ khi lấy trọn ngày, cuối kỳ ngày D−1
    và đầu kỳ ngày D là CÙNG một bản ghi 00:00 — so với chính nó thì không phát
    hiện được gì. So với mốc 23:30 hôm trước mới bắt được công tơ bị reset hoặc
    thay trong đêm.
  */
  const byMeter = new Map();
  for (const r of readCsv(join(OUT_30_DIR, `${prev}.csv`))) {
    const cur = byMeter.get(r.METER_NO);
    if (!cur || r.DATE_TIME > cur.DATE_TIME) byMeter.set(r.METER_NO, r);
  }
  for (const [no, r] of byMeter) {
    const row = { END_TIME: r.DATE_TIME };
    for (const k of KEYS) row[`${k}_END`] = r[k];
    out.set(no, row);
  }
  return { prev, rows: out, src: out.size ? `file ${prev}.csv` : 'không có' };
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

/**
 * Ghi chi tiết 30 phút, MỖI NGÀY MỘT FILE trong `public/hes_30min/`.
 *
 * Vì sao tách (user chốt 16/09/2026): app chỉ cần chỉ số ở mốc đầu kỳ và mốc
 * cuối kỳ, tức đúng HAI ngày. Gộp 30 ngày vào một file thì mỗi lần tra phải tải
 * trọn ~11,7 MB rồi vứt 28 ngày không dùng. Tách ra, mỗi lần tra tải 2 file
 * ~385 KB. Tổng dung lượng đĩa không đổi.
 *
 * Bản ghi rơi vào file theo NGÀY CỦA CHÍNH NÓ, không theo ngày đang chạy: mốc
 * 00:00 hôm sau (bản ghi thứ 49 mà API trả kèm) thuộc file hôm sau. Nhờ vậy mỗi
 * mốc nằm ở đúng một file, không nhân đôi giữa hai file.
 *
 * Trả về `{ days, rows, removed }` để nơi gọi in ra và dựng danh mục.
 */
export function writeCsv30ByDay(dir, rows) {
  const byDay = new Map();
  for (const r of rows) {
    const d = String(r.DATE_TIME ?? '').slice(0, 10);
    if (!d) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(r);
  }

  mkdirSync(dir, { recursive: true });
  let written = 0;
  for (const [d, list] of byDay) {
    const path = join(dir, `${d}.csv`);
    /* Gộp với file cũ theo (METER_NO, DATE_TIME) → chạy lại cùng ngày không nhân đôi. */
    const merged = new Map();
    for (const r of readCsv(path)) merged.set(`${r.METER_NO}|${r.DATE_TIME}`, r);
    for (const r of list) merged.set(`${r.METER_NO}|${r.DATE_TIME}`, r);
    const out = [...merged.values()]
      .sort((x, y) => (x.DATE_TIME + x.METER_NO).localeCompare(y.DATE_TIME + y.METER_NO));
    const body = out.map(r => OUT_30_FIELDS.map(f => r[f] ?? '').join(','));
    writeFileSync(path, [OUT_30_FIELDS.join(','), ...body].join('\n') + '\n', 'utf8');
    written += out.length;
  }

  /* Dọn file quá hạn. Tách file nên xoá là xoá cả ngày, không phải lọc từng dòng. */
  const removed = [];
  if (KEEP_DAYS_30 > 0) {
    const cutoff = ymd(new Date(todayVn().getTime() - KEEP_DAYS_30 * 86400000));
    for (const f of readdirSync(dir)) {
      const m = /^(\d{4}-\d{2}-\d{2})\.csv$/.exec(f);
      if (m && m[1] < cutoff) { rmSync(join(dir, f)); removed.push(m[1]); }
    }
  }

  return { days: [...byDay.keys()].sort(), rows: written, removed };
}

/**
 * Danh mục các ngày đang có, để app biết tra được từ đâu tới đâu mà không phải
 * dò từng file. Nhỏ (~1 KB) nên tải một lần là đủ.
 */
export function writeIndex30(dir) {
  const days = readdirSync(dir)
    .map(f => /^(\d{4}-\d{2}-\d{2})\.csv$/.exec(f)?.[1])
    .filter(Boolean)
    .sort();
  writeFileSync(join(dir, 'index.json'),
    JSON.stringify({ days, first: days[0] ?? '', last: days[days.length - 1] ?? '' }, null, 0) + '\n',
    'utf8');
  return days;
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
const { meters, customers } = await liveMeters(pbToken);
console.log(`Danh mục: ${meters.length} công tơ ĐANG TREO (nguồn PocketBase).`);

/*
  Tên tắt khách hàng cho bảng chi tiết trên màn Cảnh báo.

  Ưu tiên `short_name` — bảng cảnh báo hẹp, còn `name` là tên pháp nhân dài cả
  dòng ("Công ty đầu tư hạ tầng và đô thị Viglacera - Chi nhánh…"). Thiếu tên tắt
  thì mới lùi về `name`, cùng quy ước với các bảng chỉ số bên app.
*/
const byMkh = new Map(customers.map(c => [c.mkh, c]));
const shortNameOf = (mkh) => {
  const c = byMkh.get(mkh);
  return c?.short_name || c?.name || '';
};
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
  return { daily: buildRow(m.serial, m.hsn, day, s, e), detail, drops: scanRegress(recs) };
});

const rows = results.filter(r => r?.daily?.METER_NO).map(r => r.daily);
const rows30 = results.flatMap(r => r?.detail ?? []);

/**
 * Chi tiết từng CA lùi để dựng bảng trên màn Cảnh báo.
 *
 * MỘT DÒNG = MỘT CA, không gộp theo công tơ: bảng cần "lùi từ bao nhiêu về bao
 * nhiêu" trong khoảng "từ mấy giờ đến mấy giờ" ở "biểu nào" — cả ba đều thuộc
 * về từng ca, gộp về mỗi công tơ một dòng thì phải vứt hết.
 *
 * `value` là lượng đã ×HSN: số thô không so sánh được giữa các công tơ.
 */
function detailsOfDrops(list, meters, shortNameOf) {
  return list
    .map(d => {
      const m = meters.find(x => x.serial === d.serial);
      return {
        meter: d.serial,
        customer: shortNameOf(m?.mkh),
        /* Trạm/điểm đo hiện dưới tên khách trong cùng một ô. */
        station: m?.code ?? '',
        zone: m?.zone ?? '',
        /* Ngày lấy từ chính mốc của ca, không lấy ngày đang xử lý: ca ở chỗ
           nối 23:30 → 00:00 thuộc về ngày HÔM SAU, ghi nhầm là sai. */
        day: String(d.at).slice(0, 10),
        fromTime: String(d.fromAt).slice(11, 16),
        toTime: String(d.at).slice(11, 16),
        register: d.label,
        fromIndex: d.from,
        toIndex: d.to,
        value: Number((d.gap * (m?.hsn || 1)).toFixed(3)),
        unit: 'kWh',
      };
    })
    /* Sắp theo KCN rồi công tơ rồi giờ — bảng gom nhóm theo KCN nên thứ tự này
       giữ mỗi công tơ liền một khối thay vì rải rác. */
    .sort((a, b) => a.zone.localeCompare(b.zone) || a.meter.localeCompare(b.meter)
      || a.fromTime.localeCompare(b.fromTime));
}

/* ---------------------------- Soát thụt lùi ---------------------------- */
/*
  Soi từng cặp mốc liên tiếp trong ngày trên MỌI thanh ghi (xem `scanRegress`),
  rồi tách hai loại: lùi đúng một bước chữ số cuối là sai số làm tròn của HES,
  lùi nhiều hơn mới đáng gọi là công tơ chạy ngược.
*/
const drops = results.flatMap((r, i) =>
  (r?.drops ?? []).map(d => ({ ...d, serial: meters[i].serial, hsn: meters[i].hsn })));
const real = drops.filter(d => !d.rounding);
const rounding = drops.filter(d => d.rounding);

/* Cờ REGRESS chỉ mang các thanh ghi lùi THẬT — ca làm tròn mà gắn cờ thì cờ mất giá trị. */
const realBySerial = new Map();
for (const d of real) realBySerial.set(d.serial, [...(realBySerial.get(d.serial) ?? []), d]);
for (const r of rows) {
  r.REGRESS = [...new Set((realBySerial.get(r.METER_NO) ?? []).map(d => d.label))].join(' · ');
}

if (rounding.length) {
  const meterCount = new Set(rounding.map(d => d.serial)).size;
  console.log(`\nSai số làm tròn: ${rounding.length} lần lùi đúng ${ROUNDING_STEP} trên ${meterCount} công tơ `
    + '— của hệ thống HES, không phải công tơ chạy ngược.');

  /*
    CẢNH BÁO RIÊNG cho ca làm tròn (user chốt 16/09/2026), tách hẳn khỏi nhóm
    lùi thật.

    Trước đây chỉ in ra log rồi thôi, nên người dùng không thấy gì trên app và
    tưởng hệ thống bỏ sót. Nhưng gộp chung với lùi thật cũng sai: HES sinh ~80 ca
    mỗi ngày, ca lùi THẬT sẽ lẫn vào giữa 80 dòng vô hại và không ai nhìn ra.

    Nội dung nêu luôn các KHUNG GIỜ: 80 ca dồn vào một hai mốc thì thủ phạm là
    HES, còn rải đều cả ngày lại là chuyện khác hẳn — người đọc cần phân biệt
    được ngay ở dòng tóm tắt, không phải mở bảng ra đếm.
  */
  if (process.argv.includes('--notify')) {
    const byTime = new Map();
    for (const d of rounding) {
      const t = String(d.at).slice(11, 16);
      byTime.set(t, (byTime.get(t) ?? 0) + 1);
    }
    const windows = [...byTime.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const zone = zoneOf(rounding.map(d => meters.find(x => x.serial === d.serial)?.zone ?? ''));

    const ok = await raiseAlert(pbToken, {
      kind: 'lamtron',
      title: 'Sai số làm tròn hàng loạt từ HES',
      message: `Ngày ${ymd(day)}: ${rounding.length} ca chỉ số giảm đúng ${ROUNDING_STEP}`
        + ` trên ${meterCount} công tơ, dồn vào ${windows.length} khung giờ`
        + ` (${windows.map(([t, n]) => `${t}: ${n} ca`).join(', ')})`,
      zone,
      meters: [...new Set(rounding.map(d => d.serial))],
      details: detailsOfDrops(rounding, meters, shortNameOf),
      day: ymd(day),
    });
    console.log(`Cảnh báo sai số làm tròn: ${ok ? 'đã ghi 1 bản' : 'bỏ qua (đã có bản cho ngày này)'}`
      + ` · ${windows.length} khung giờ.`);
  }
}

if (real.length) {
  console.log(`\n[CẢNH BÁO] ${realBySerial.size} công tơ có chỉ số CHẠY THỤT LÙI thật `
    + `(${real.length} lần, lùi hơn ${ROUNDING_STEP}) — có thể do thay/reset công tơ, cần tra:`);
  for (const [serial, list] of realBySerial) {
    for (const d of list.slice(0, 5)) {
      console.log(`   ${serial.padEnd(12)} ${d.at}  ${d.label.padEnd(24)} `
        + `${d.from} → ${d.to}  (−${d.gap.toFixed(3)}, ≈${Math.round(d.gap * (d.hsn || 1))} sau ×HSN)`);
    }
    if (list.length > 5) console.log(`   ${' '.repeat(12)} … và ${list.length - 5} lần nữa`);
  }

  /*
    Ghi cảnh báo vào collection `alerts` (màn Cảnh báo) — CHỈ ca lùi THẬT.

    Ca sai số làm tròn (0.001) tuyệt đối không gửi: 21 ngày cuối tháng 8 có 102
    ca như vậy, gửi hết thì chuông ngập ngay ngày đầu và mất sạch tác dụng cảnh
    báo. Chúng đã có một dòng đếm ở log là đủ.

    Gộp MỘT thông báo cho cả mẻ, không phải mỗi công tơ một cái. Nội dung có kèm
    NGÀY nên `raiseAlert` (chống trùng theo `kind` + `day` + `message`) vẫn cho
    ra cảnh báo riêng từng ngày khi sai lệch kéo dài.
  */
  if (process.argv.includes('--notify')) {
    /*
      MỘT bản ghi cho cả mẻ, không nhân bản theo KCN nữa (A2, 16/09/2026): màn
      Cảnh báo ai đăng nhập cũng xem được và `zone` chỉ để lọc, nên nhân đôi chỉ
      tạo ra hai bản của cùng một sự cố — đánh dấu đã xử lý một bản là lệch ngay.
    */
    const serials = [...realBySerial.keys()];
    const zones = serials.map(sn => meters.find(m => m.serial === sn)?.zone ?? '');
    const zone = zoneOf(zones);

    const details = detailsOfDrops(real, meters, shortNameOf);

    const ok = await raiseAlert(pbToken, {
      kind: 'lui',
      details,
      title: 'Cảnh báo chỉ số công tơ chạy lùi',
      message: `Ngày ${ymd(day)}: ${serials.length} công tơ có chỉ số chạy lùi`
        + `${zone ? ` tại ${zone}` : ''} — ${serials.join(', ')}`,
      zone,
      meters: serials,
      day: ymd(day),
    });
    console.log(`Cảnh báo chỉ số lùi: ${ok ? 'đã ghi 1 bản' : 'bỏ qua (đã có bản cho ngày này)'}`
      + `${zone ? ` · KCN ${zone}` : ' · trải nhiều KCN'}.`);
  } else {
    console.log('(Thêm --notify để đẩy cảnh báo này vào màn Cảnh báo.)');
  }
}

/*
  Nối ngày: `scanRegress` chỉ soi trong mẻ của HÔM NAY, nên chỗ nối với hôm qua
  (23:30 hôm qua → 00:00 hôm nay) phải xét riêng. Đây chính là chỗ bắt được công
  tơ bị thay hoặc reset trong đêm.

  Chỉ so được 5 thanh ghi mà file 30 phút lưu — chiều nhận không nằm trong file.
*/
const { prev, rows: prevRows, src } = prevDayRows(day);
console.log(`Mốc cuối ngày liền trước (${prev}): ${prevRows.size} công tơ, nguồn ${src}.`);
const crossDay = [];
for (const r of rows) {
  const p = prevRows.get(r.METER_NO);
  if (!p) continue;
  for (const k of KEYS) {
    const a = Number(p[`${k}_END`]), b = Number(r[`${k}_START`]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b >= a) continue;
    const gap = a - b;
    crossDay.push({
      serial: r.METER_NO, gap, from: a, to: b,
      /* Cùng hình dạng với `drops` của scanRegress để dùng chung detailsOfDrops:
         `fromAt` là mốc cuối hôm trước, `at` là mốc đầu hôm nay. */
      fromAt: p.END_TIME, at: r.START_TIME,
      label: LABEL_OF_KEY[k] ?? k,
      rounding: gap <= ROUNDING_STEP + FLOAT_SLOP,
    });
  }
}
const crossReal = crossDay.filter(d => !d.rounding);
if (crossReal.length) {
  console.log(`\n[CẢNH BÁO] ${new Set(crossReal.map(d => d.serial)).size} công tơ lùi chỉ số Ở CHỖ NỐI `
    + `với ngày ${prev} — dấu hiệu thay/reset công tơ trong đêm:`);
  for (const d of crossReal) {
    console.log(`   ${d.serial.padEnd(12)} ${d.label.padEnd(24)} ${d.from} (${d.fromAt}) → ${d.to}  (−${d.gap.toFixed(3)})`);
  }

  /*
    GHI CẢNH BÁO — trước đây chỗ này chỉ `console.log` rồi thôi (sửa 16/09/2026).

    Đây là loại lùi NẶNG NHẤT: công tơ bị thay hoặc reset trong đêm, sản lượng cả
    kỳ sai theo. Vậy mà nó là loại DUY NHẤT không bao giờ đến được màn Cảnh báo —
    nhánh trong ngày thì có `raiseAlert`, nhánh nối ngày thì không. Phát hiện khi
    backfill 19 ngày: 4 ngày (03/09, 04/09, 11/09, 14/09) có ca nối ngày mà app
    không hiện gì.
  */
  if (process.argv.includes('--notify')) {
    const serials = [...new Set(crossReal.map(d => d.serial))];
    const zone = zoneOf(serials.map(sn => meters.find(x => x.serial === sn)?.zone ?? ''));
    const ok = await raiseAlert(pbToken, {
      kind: 'lui',
      title: 'Chỉ số lùi ở chỗ nối ngày — nghi thay hoặc reset công tơ',
      message: `Đêm ${prev} → ${ymd(day)}: ${serials.length} công tơ có chỉ số đầu ngày`
        + ` THẤP HƠN chỉ số cuối ngày hôm trước${zone ? ` tại ${zone}` : ''}`
        + ` — ${serials.join(', ')}`,
      zone,
      meters: serials,
      details: detailsOfDrops(crossReal, meters, shortNameOf),
      day: ymd(day),
    });
    console.log(`Cảnh báo nối ngày: ${ok ? 'đã ghi 1 bản' : 'bỏ qua (đã có bản cho ngày này)'}.`);
  }
} else if (crossDay.length) {
  console.log(`Nối ngày: ${crossDay.length} ca lùi nhưng đều ở mức làm tròn.`);
}

const noData = rows.filter(r => r.NO_DATA === '1');
console.log(`Lấy được ${rows.length - noData.length}/${rows.length} công tơ có đủ chỉ số hai đầu.`);
if (noData.length) {
  console.log(`Thiếu chỉ số (NO_DATA=1): ${noData.map(r => r.METER_NO).join(', ')}`);
}

/*
  KHÔNG cảnh báo công tơ thiếu chỉ số (user chốt 16/09/2026, sau khi đã thử).

  Không có chỉ số KHÔNG đồng nghĩa với bất thường: khách hàng tắt trạm là
  chuyện bình thường, và đó là phần lớn trong 17 công tơ im lặng mỗi ngày. Báo
  hết thì mục Cảnh báo đầy những việc không ai cần làm gì, rồi người dùng quen
  bỏ qua — lúc có sự cố thật cũng bị bỏ qua nốt.

  Vẫn in ra log ở trên để tra khi cần.
*/

if (rows.length === noData.length) {
  console.error('Không công tơ nào có chỉ số — dừng, không ghi đè file cũ.');
  process.exit(1);
}

const w = writeCsv30ByDay(OUT_30_DIR, rows30);
console.log(`Chi tiết 30 phút: ${rows30.length} mốc → ${w.days.length} file `
  + `(${w.days.join(', ')}), tổng ${w.rows} dòng trong ${OUT_30_DIR}/`);
if (w.removed.length) console.log(`Đã xoá ${w.removed.length} ngày quá hạn: ${w.removed.join(', ')}`);
const days = writeIndex30(OUT_30_DIR);
console.log(`Danh mục: ${days.length} ngày (${days[0]} → ${days[days.length - 1]}), giữ ${KEEP_DAYS_30} ngày.`);

}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

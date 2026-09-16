#!/usr/bin/env node
/**
 * Soi CHỈ SỐ BẤT THƯỜNG trong toàn bộ `public/hes_30min/` — chỉ ĐỌC, không ghi
 * gì vào PocketBase và không sửa file.
 *
 * Khác `scanRegress` trong `fetch_hes_index.mjs`: hàm kia soi bản ghi THÔ từ API
 * (tên trường HES, có cả chiều nhận), còn đây soi FILE CSV đã ghi (tên cột
 * PG/BT/CD/TD/VC) và soi LIÊN NGÀY — nối mốc 23:30 hôm trước với 00:00 hôm sau,
 * chỗ bắt được công tơ bị thay hoặc reset trong đêm.
 *
 * HAI LOẠI BẤT THƯỜNG, tách bạch vì ý nghĩa khác hẳn nhau:
 *
 *   LÙI THẬT       chỉ số giảm nhiều hơn một bước chữ số cuối → công tơ bị thay,
 *                  bị reset, hoặc dữ liệu sai. Đây là thứ cần đi kiểm tra.
 *   SAI SỐ LÀM TRÒN  giảm đúng 0.001 → HES làm tròn chỗ chữ số cuối. Vô hại,
 *                  nhưng đếm riêng để biết nó chiếm bao nhiêu.
 *
 * Bản đầu dùng `b < a - EPS` với EPS = 0.001 nên loại sạch chính các ca −0.001,
 * báo "0 ca" trong khi thực tế có hàng trăm (phát hiện khi đối chiếu báo cáo của
 * user ngày 16/09/2026). So `b < a` KHÔNG dung sai, rồi mới phân loại.
 *
 * PHẠM VI: file 30 phút chỉ lưu 5 thanh ghi chiều ACTIVE (phần tính tiền điện).
 * Chiều nhận (NEGACTIVE) không có trong file, nên KHÔNG soi được ở đây — muốn
 * soi phải gọi lại API.
 *
 *   node scripts/scan_30min.mjs                 # toàn bộ file đang có
 *   node scripts/scan_30min.mjs --real          # chỉ ca lùi thật, bỏ sai số làm tròn
 *   node scripts/scan_30min.mjs --from 2026-09-01 --to 2026-09-10
 *   node scripts/scan_30min.mjs --meter 2410320615
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.HES_30MIN_DIR || 'public/hes_30min';
/** Lùi đúng một bước chữ số cuối = sai số làm tròn của HES. */
const ROUNDING_STEP = Number(process.env.REGRESS_ROUNDING || 0.001);
const FLOAT_SLOP = 1e-9;

/** Cột chỉ số → tên đọc được. Thứ tự này cũng là thứ tự hiện trong báo cáo. */
const COLS = {
  PG: 'Hữu công – tổng',
  BT: 'Hữu công – bình thường',
  CD: 'Hữu công – cao điểm',
  TD: 'Hữu công – thấp điểm',
  VC: 'Vô công – tổng',
};

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
};
const FROM = arg('--from');
const TO = arg('--to');
const ONLY_METER = arg('--meter');
const REAL_ONLY = process.argv.includes('--real');

if (!existsSync(DIR)) {
  console.error(`Không thấy thư mục ${DIR}.`);
  process.exit(1);
}

const days = readdirSync(DIR)
  .filter(f => f.endsWith('.csv'))
  .map(f => f.slice(0, -4))
  .filter(d => (!FROM || d >= FROM) && (!TO || d <= TO))
  .sort();

if (!days.length) {
  console.error('Không có file nào trong khoảng đã chọn.');
  process.exit(1);
}

function readCsv(path) {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return [];
  const [head, ...lines] = text.split(/\r?\n/);
  const cols = head.split(',');
  return lines.map(line => {
    const cells = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/*
  Gom TOÀN BỘ mốc của từng công tơ qua mọi ngày rồi mới soi, thay vì soi từng
  ngày một. Chỉ có cách này mới bắt được ca lùi ở chỗ NỐI hai ngày — cũng là chỗ
  hay xảy ra nhất vì công tơ thường được thay vào ban đêm.
*/
const byMeter = new Map();
let rows = 0;
for (const d of days) {
  for (const r of readCsv(join(DIR, `${d}.csv`))) {
    if (ONLY_METER && r.METER_NO !== ONLY_METER) continue;
    rows++;
    if (!byMeter.has(r.METER_NO)) byMeter.set(r.METER_NO, []);
    byMeter.get(r.METER_NO).push(r);
  }
}

const hits = [];
for (const [meter, recs] of byMeter) {
  recs.sort((a, b) => a.DATE_TIME.localeCompare(b.DATE_TIME));
  for (let i = 1; i < recs.length; i++) {
    for (const [col, label] of Object.entries(COLS)) {
      const a = num(recs[i - 1][col]);
      const b = num(recs[i][col]);
      if (a === null || b === null || b >= a) continue;
      const gap = a - b;
      hits.push({
        meter, col, label, gap,
        at: recs[i].DATE_TIME,
        prevAt: recs[i - 1].DATE_TIME,
        from: a, to: b,
        rounding: gap <= ROUNDING_STEP + FLOAT_SLOP,
        /* Nối ngày = hai mốc khác ngày; đây là chỗ công tơ hay bị thay/reset. */
        crossDay: recs[i].DATE_TIME.slice(0, 10) !== recs[i - 1].DATE_TIME.slice(0, 10),
      });
    }
  }
}

const real = hits.filter(h => !h.rounding);
const round = hits.filter(h => h.rounding);
const shown = REAL_ONLY ? real : hits;

console.log(`Thư mục : ${DIR}`);
console.log(`Ngày    : ${days[0]} → ${days[days.length - 1]} (${days.length} file)`);
console.log(`Dữ liệu : ${rows.toLocaleString('vi-VN')} dòng · ${byMeter.size} công tơ`
  + `${ONLY_METER ? ` (lọc công tơ ${ONLY_METER})` : ''}`);
console.log(`\nLÙI THẬT        : ${real.length} ca trên ${new Set(real.map(h => h.meter)).size} công tơ`);
console.log(`Sai số làm tròn : ${round.length} ca trên ${new Set(round.map(h => h.meter)).size} công tơ`
  + ` (giảm đúng ${ROUNDING_STEP} — của HES, không phải công tơ ngược)`);

if (!shown.length) {
  console.log('\nKhông có ca nào trong phạm vi đã chọn.');
  process.exit(0);
}

/* Gộp theo công tơ: một công tơ hỏng sinh hàng loạt ca, liệt kê phẳng thì
   không thấy được là ít công tơ hay nhiều công tơ bị. */
const perMeter = new Map();
for (const h of shown) {
  if (!perMeter.has(h.meter)) perMeter.set(h.meter, []);
  perMeter.get(h.meter).push(h);
}
const order = [...perMeter.entries()].sort((a, b) => b[1].length - a[1].length);

console.log(`\n=== CHI TIẾT (${shown.length} ca trên ${perMeter.size} công tơ`
  + `${REAL_ONLY ? ', chỉ lùi thật' : ''}) ===`);
for (const [meter, list] of order) {
  const nReal = list.filter(h => !h.rounding).length;
  console.log(`\n${meter} — ${list.length} ca`
    + `${nReal && !REAL_ONLY ? ` (${nReal} lùi thật)` : ''}`);
  /* Ca lùi thật lên trước: đó là thứ người đọc cần thấy ngay. */
  const sorted = [...list].sort((a, b) =>
    (a.rounding ? 1 : 0) - (b.rounding ? 1 : 0) || a.at.localeCompare(b.at));
  for (const h of sorted.slice(0, 12)) {
    console.log(`  ${h.rounding ? 'làm tròn' : 'LÙI THẬT'} ${h.at}`
      + `${h.crossDay ? ' [nối ngày]' : '         '}`
      + ` ${h.label.padEnd(24)} ${h.from} → ${h.to}  (−${h.gap.toFixed(3)})`);
  }
  if (sorted.length > 12) console.log(`  … và ${sorted.length - 12} ca nữa`);
}

/* Cụm thời điểm: nhiều công tơ cùng lùi tại một mốc thì thủ phạm là hệ thống
   thu thập, không phải từng công tơ. Phân biệt được điều này mới biết nên đi
   kiểm tra công tơ hay đi hỏi HES. */
const byTime = new Map();
for (const h of shown) byTime.set(h.at, (byTime.get(h.at) ?? 0) + 1);
/*
  LIỆT KÊ ĐỦ MỌI KHUNG, không lọc theo ngưỡng. Bản đầu chỉ hiện cụm ≥5 ca cho
  gọn, nhưng thế là giấu mất 3 trong 5 khung — người đọc tưởng chỉ có hai khung
  trong khi thực tế có năm (user phát hiện 16/09/2026). Đặt ngưỡng tuỳ tiện
  trong chính báo cáo soi lỗi thì báo cáo thành nguồn sai mới.
*/
const times = [...byTime.entries()].sort((a, b) => a[0].localeCompare(b[0]));
if (times.length) {
  console.log(`\n=== KHUNG GIỜ (${times.length} khung — cùng một mốc nhiều ca là nghi do HES) ===`);
  for (const [t, n] of times) console.log(`  ${t}  ${String(n).padStart(3)} ca`);
  console.log('\nLƯU Ý: chỉ soi 5 biểu chiều ACTIVE có trong file. Chiều NHẬN'
    + ' (vô công nhận) KHÔNG nằm trong file 30 phút nên số ở đây THẤP HƠN thực tế;'
    + ' muốn đủ phải soi thẳng từ API.');
}

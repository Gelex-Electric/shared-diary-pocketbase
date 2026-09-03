/**
 * Đối chiếu luật sinh lịch (`buildSchedule`) với file theo dõi hợp đồng đang dùng.
 *
 *   npx tsx scripts/qlvh_check_excel.ts "<đường dẫn file .xlsx>"
 *
 * In ra từng hợp đồng mà lịch tính được KHÁC bảng tính — để rà xem bên nào sai.
 * Chỉ ĐỌC file, không ghi gì, không đụng PocketBase.
 *
 * Đường dẫn truyền qua tham số, KHÔNG hard-code: repo đang public.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// xlsx phát hành dạng CommonJS — ESM import * chỉ ra namespace rỗng khi chạy tsx.
const XLSX = require('xlsx');
import { buildSchedule, dayOf } from '../src/lib/qlvhRules';

const file = process.argv[2];
if (!file) {
  console.error('Thiếu đường dẫn file. Ví dụ:\n  npx tsx scripts/qlvh_check_excel.ts "D:/... /Theo dõi Hợp đồng dịch vụ.xlsx"');
  process.exit(1);
}

const fm = (n: number) => new Intl.NumberFormat('vi-VN').format(Math.round(n));

/** Excel để ngày kiểu M/D/YY → đổi sang YYYY-MM-DD. */
function toDay(v: unknown): string {
  const p = (n: number) => String(n).padStart(2, '0');

  // Đọc raw nên ô ngày về dạng SỐ SERIAL của Excel (số ngày kể từ 30/12/1899),
  // không phải chuỗi "M/D/YY" như khi đọc formatted.
  if (typeof v === 'number' && v > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }

  const s = String(v || '').trim();
  if (!s) return '';
  const [m, d, y] = s.split('/').map(Number);
  if (!m || !d || !y) return '';
  return `${y < 100 ? 2000 + y : y}-${p(m)}-${p(d)}`;
}

const wb = XLSX.readFile(file, { raw: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets['TH-QLVH'], { header: 1, raw: true, defval: '' }) as any[][];
const body = rows.slice(6).filter(r => String(r[2] || '').trim());

const COL = { kh: 1, so: 2, ky: 4, thang: 5, hieuLuc: 6, ketThuc: 7, giaTri: 9, d1: 11, t1: 12, d2: 15, t2: 16, d3: 19, t3: 20 };

let same = 0;
const diffs: string[] = [];

for (const r of body) {
  const from = toDay(r[COL.hieuLuc]);
  const to = toDay(r[COL.ketThuc]);
  const value = Number(r[COL.giaTri]) || 0;
  if (!from || !value) continue;

  const mine = buildSchedule(from, to, value);
  const theirs = [
    { due: toDay(r[COL.d1]), amt: Number(r[COL.t1]) || 0 },
    { due: toDay(r[COL.d2]), amt: Number(r[COL.t2]) || 0 },
    { due: toDay(r[COL.d3]), amt: Number(r[COL.t3]) || 0 },
  ].filter(x => x.amt > 0 || x.due);

  const problems: string[] = [];
  if (mine.length !== theirs.length) problems.push(`số đợt: bảng ${theirs.length} ↔ tính ra ${mine.length}`);
  mine.forEach((m, i) => {
    const t = theirs[i];
    if (!t) return;
    if (t.due && dayOf(t.due) !== m.due_date) problems.push(`đợt ${i + 1} ngày: bảng ${t.due} ↔ tính ra ${m.due_date}`);
    if (Math.abs(t.amt - m.amount_due) > 1000) {
      problems.push(`đợt ${i + 1} tiền: bảng ${fm(t.amt)} ↔ tính ra ${fm(m.amount_due)} (lệch ${fm(t.amt - m.amount_due)})`);
    }
  });

  if (problems.length === 0) same++;
  else diffs.push(`• ${String(r[COL.kh]).slice(0, 42)} — ${String(r[COL.so]).slice(0, 30)} (${r[COL.thang]} tháng, ${fm(value)}đ)\n    ${problems.join('\n    ')}`);
}

console.log(`Đối chiếu ${body.length} hợp đồng QLVH:`);
console.log(`  khớp hoàn toàn : ${same}`);
console.log(`  lệch           : ${diffs.length}\n`);
diffs.forEach(d => console.log(d + '\n'));

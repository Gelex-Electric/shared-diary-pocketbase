#!/usr/bin/env node
/**
 * Xoá số liệu tổn thất TỪ một mốc ngày trở đi, để tính lại bằng lõi mới.
 *
 * Vì sao cần (user chốt 23/09/2026): đổi nguồn sang PocketBase làm ĐỔI MÃ TRẠM
 * (`03.TMD.3000KVA` → `03.TMD.T1.3000kVA`, `03.LOGOS` → `03.LOGOI`…). User chấp
 * nhận ĐỨT MẠCH trước tháng 9 và tính lại từ 01/09.
 *
 * Không xoá phần cũ trước khi tính lại thì tháng 9 có CẢ HAI hệ mã:
 * 01–15/09 mã cũ + 01–23/09 mã mới ⇒ bảng tháng **cộng trùng**, số tổn thất
 * tháng 9 gần như gấp đôi mà vẫn trông hợp lý. Đó là lý do file này tồn tại.
 *
 * Số liệu TRƯỚC mốc giữ nguyên với mã cũ — đó là đứt mạch có chủ ý, đã ghi vào
 * `logs/2026-09-23-t3-loi-tinh-ton-that-moi.md`.
 *
 * Mặc định CHẠY THỬ. Phải `--apply` mới ghi. Ba file đều nằm trong git nên lỡ
 * tay vẫn `git checkout` lại được.
 *
 *   node scripts/loss_drop_from.mjs --from 2026-09-01
 *   node scripts/loss_drop_from.mjs --from 2026-09-01 --apply
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (n, d = '') => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? d) : d;
};
const FROM = arg('--from', '');
const APPLY = process.argv.includes('--apply');
const DIR = arg('--dir', 'public');

if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM)) {
  console.error('Thiếu --from YYYY-MM-DD');
  process.exit(1);
}
const FROM_MONTH = FROM.slice(0, 7);

/* [file, cột chứa ngày, cách lấy phần ngày để so sánh] */
const TARGETS = [
  ['transformer_loss_daily.csv', 'DATE', v => v],
  ['transformer_loss_30min.csv', 'DATE_TIME', v => v.slice(0, 10)],
  /* File tháng cộng từ file ngày. Xoá từ THÁNG chứa mốc, rồi để
     `monthly_transformer_loss.py` dựng lại — không sửa tay số tháng. */
  ['transformer_loss_monthly.csv', 'MONTH', v => v],
];

console.log(`\nXOÁ SỐ LIỆU TỔN THẤT TỪ ${FROM} (tháng ${FROM_MONTH}) TRỞ ĐI`);
console.log(`Thư mục: ${DIR}/\n`);

let tongXoa = 0;
for (const [name, col, toDay] of TARGETS) {
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) { console.log(`  ${name.padEnd(32)} (không có file)`); continue; }

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const header = lines[0];
  const H = header.split(',');
  const idx = H.indexOf(col);
  if (idx < 0) { console.error(`  ${name}: không thấy cột ${col} — DỪNG.`); process.exit(1); }

  const body = lines.slice(1).filter(l => l.trim());
  const moc = col === 'MONTH' ? FROM_MONTH : FROM;
  const giu = body.filter(l => toDay(l.split(',')[idx] ?? '') < moc);
  const xoa = body.length - giu.length;
  tongXoa += xoa;

  console.log(`  ${name.padEnd(32)} ${String(body.length).padStart(7)} dòng → xoá ${String(xoa).padStart(6)} · giữ ${giu.length}`);

  if (APPLY && xoa > 0) {
    fs.writeFileSync(file, `${header}\n${giu.join('\n')}\n`, 'utf8');
  }
}

console.log(`\nTổng sẽ xoá: ${tongXoa} dòng`);
if (!APPLY) {
  console.log('\n[CHẠY THỬ] Chưa ghi gì. Thêm --apply để xoá thật.');
  console.log('Sau khi xoá: chạy `loss_daily.mjs --from … --to …` rồi `monthly_transformer_loss.py`.\n');
} else {
  console.log('\nĐÃ XOÁ. Bước tiếp: tính lại bằng loss_daily.mjs, rồi dựng lại file tháng.\n');
}

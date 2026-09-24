/**
 * Bộ kiểm thử `scripts/lib/hes30.mjs` — chạy: node scripts/dm_test_hes30.mjs
 *
 * Dựng file CSV giả trong thư mục tạm để kiểm đúng ba cái bẫy đã trả giá ở đợt
 * Pmax lộ: chia Δt thực, gom mốc, và KHÔNG lấy max khi tích phân. Thêm một lượt
 * chạy trên dữ liệu THẬT (nếu có) để chắc module đọc được file của pipeline.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDaySeries, readDayFile, slotLabel, SLOTS_PER_DAY } from './lib/hes30.mjs';

let pass = 0, fail = 0;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ok = (ten, dk) => { if (dk) { pass++; console.log(`  ok   ${ten}`); } else { fail++; console.log(`  SAI  ${ten}`); } };
const eq = (ten, thuc, mong, eps = 1e-6) => {
  const good = typeof mong === 'number' ? near(thuc, mong, eps) : JSON.stringify(thuc) === JSON.stringify(mong);
  if (good) { pass++; console.log(`  ok   ${ten}`); }
  else { fail++; console.log(`  SAI  ${ten}\n       nhận : ${JSON.stringify(thuc)}\n       mong : ${JSON.stringify(mong)}`); }
};

/* ---------- dựng dữ liệu giả ---------- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hes30-'));
const write = (day, rows) => fs.writeFileSync(path.join(dir, `${day}.csv`),
  ['METER_NO,DATE_TIME,HSN,PG,BT,CD,TD,VC',
    ...rows.map(r => `${r[0]},${day} ${r[1]},${r[2]},${r[3]},0,0,0,${r[4] ?? 0}`)].join('\n'));

/* M1: đều đặn 30 phút, mỗi khoảng +1 kWh thô, HSN 100 → P = 1×100/0,5 = 200 kW.
   M2: mốc LỆCH NHỊP 14:01 → 14:45 (44 phút) — chia 0,5h cố định sẽ vống 36%.
   M3: chỉ số LÙI (thay công tơ) giữa ngày.  */
write('2026-09-21', [['M1', '23:30:00', 100, 100, 10]]);
write('2026-09-22', [
  ['M1', '00:00:00', 100, 101, 10.5],
  ['M1', '00:30:00', 100, 102, 11],
  ['M1', '01:00:00', 100, 103, 11.5],
  ['M2', '14:01:00', 200, 50, 5],
  ['M2', '14:45:00', 200, 51, 5],
  ['M3', '08:00:00', 100, 900, 0],
  ['M3', '08:30:00', 100, 10, 0],
  ['M3', '09:00:00', 100, 11, 0],
]);
write('2026-09-23', [['M1', '00:00:00', 100, 104, 12]]);

const r = buildDaySeries('2026-09-22', { dir });
const M1 = r.meters.get('M1'), M2 = r.meters.get('M2'), M3 = r.meters.get('M3');

console.log('\nCơ bản');
eq('đọc đúng 3 công tơ', r.meters.size, 3);
eq('M1: P tại mốc 00:00 = 200 kW', M1.slots.get(0).p, 200);
eq('M1: Q tại mốc 00:00 = 100 kVar (ΔVC 0,5 × 100 ÷ 0,5h)', M1.slots.get(0).q, 100);

console.log('\nBẫy 1 — chia Δt THỰC, không chia 0,5h cố định');
/* 1 kWh thô × HSN 200 trong 44 phút = 200 ÷ (44/60) = 272,727… kW.
   Chia 0,5h cố định sẽ ra 400 kW — vống 47%. */
eq('M2: P = 272,73 kW chứ không phải 400', M2.slots.get(28).p, 200 / (44 / 60), 1e-9);

console.log('\nBẫy 2 — gom về lưới 48 mốc');
ok('nhãn mốc đúng', slotLabel(0) === '00:00' && slotLabel(28) === '14:00' && slotLabel(47) === '23:30');
/* Khoảng 14:01→14:45 phủ mốc 14:00 và 14:30, dù chỉ có 2 bản đọc. */
eq('M2 phủ đúng 2 mốc', [...M2.slots.keys()].sort((a, b) => a - b), [28, 29]);

console.log('\nBẫy 3 — SẢN LƯỢNG không được nhân đôi khi khoảng phủ 2 mốc');
/* Đúng: 1 kWh thô × 200 = 200 kWh. Nếu lấy p × 0,5h × 2 mốc thì ra 272,7 — sai 36%. */
eq('M2: sản lượng = 200 kWh', M2.energyKwh, 200, 1e-9);

console.log('\nNửa đêm — chia theo mốc');
/* M1 có khoảng 21/09 23:30 → 22/09 00:00 (ngày trước) và 22/09 01:00 → 23/09 00:00.
   Mốc 00:00 của ngày 22 CHỈ phủ được nhờ đọc kèm ngày 21. */
ok('mốc 00:00 được phủ nhờ đọc kèm ngày trước', M1.slots.has(0));
ok('mốc 23:30 được phủ nhờ đọc kèm ngày sau', M1.slots.has(47));
/* Sản lượng ngày 22 của M1 = (104 − 101) × 100 = 300 kWh: phần của ngày 21 và
   ngày 23 KHÔNG được tính sang. */
eq('M1: sản lượng ngày = 300 kWh (không lấn sang ngày khác)', M1.energyKwh, 300, 1e-6);

console.log('\nChỉ số lùi (thay/reset công tơ)');
eq('M3: đếm được 1 khoảng lùi', M3.regress, 1);
ok('M3: mốc 08:00 bị bỏ, không bịa số âm', !M3.slots.has(16));
eq('M3: mốc 08:30 vẫn tính bình thường', M3.slots.get(17).p, 200);

console.log('\nThiếu file / mất điện');
const r2 = buildDaySeries('2026-09-25', { dir });
eq('ngày không có file → rỗng, không ném lỗi', r2.meters.size, 0);
ok('có báo thiếu file', r2.missingFiles.includes('2026-09-25'));
eq('readDayFile ngày không tồn tại → []', readDayFile('2099-01-01', dir), []);

/* ---------- chạy thử trên dữ liệu THẬT ---------- */
console.log('\nDữ liệu thật (public/ChiSo_30min)');
/* Chọn ngày MỚI NHẤT đang có thay vì cố định: cây làm việc có thể sau `main`
   vài commit dữ liệu, cố định một ngày là test tự im lặng bỏ qua. */
const realDir = 'public/ChiSo_30min';
const realDay = fs.existsSync(realDir)
  ? fs.readdirSync(realDir).filter(f => /^\d{4}-\d{2}-\d{2}\.csv$/.test(f))
      .sort().slice(-1)[0]?.replace('.csv', '')
  : null;
if (realDay) {
  const rr = buildDaySeries(realDay);
  const m = rr.meters.get('2510633411');            // JOHNSON.T1, HSN 800
  ok(`đọc được ${rr.meters.size} công tơ ngày ${realDay}`, rr.meters.size > 90);
  ok('mọi mốc đều nằm trong 0..47',
    [...rr.meters.values()].every(x => [...x.slots.keys()].every(s => s >= 0 && s < SLOTS_PER_DAY)));
  ok('sản lượng công tơ mẫu > 0', m && m.energyKwh > 0);

  /* Ngày MỚI NHẤT luôn thiếu file ngày sau ⇒ hụt đúng mốc 23:30. Đây là hành vi
     ĐÚNG (không bịa số), và module phải BÁO ra để lõi tính còn biết. */
  ok('ngày mới nhất: có báo thiếu file ngày sau', rr.nextDayMissing === true);
  ok('thiếu ngày sau ⇒ mốc 23:30 rỗng', m && !m.slots.has(SLOTS_PER_DAY - 1));
  console.log(`       ${realDay}: ${rr.meters.size} công tơ · mẫu 2510633411 `
    + `${m.covered}/48 mốc · ${m.energyKwh.toFixed(0)} kWh · HSN ${m.hsn}`);

  /* Ngày ở GIỮA dải thì có đủ hai file hàng xóm ⇒ phải phủ trọn 48 mốc. */
  const days = fs.readdirSync(realDir).filter(f => /^\d{4}-\d{2}-\d{2}\.csv$/.test(f)).sort();
  if (days.length >= 3) {
    const midDay = days[days.length - 2].replace('.csv', '');
    const rm = buildDaySeries(midDay);
    const mm = rm.meters.get('2510633411');
    ok(`ngày giữa dải (${midDay}): đủ hai file hàng xóm`,
      rm.prevDayMissing === false && rm.nextDayMissing === false);
    ok('ngày giữa dải: công tơ mẫu phủ ĐỦ 48 mốc', mm && mm.covered === SLOTS_PER_DAY);
    console.log(`       ${midDay}: mẫu 2510633411 ${mm.covered}/48 mốc · ${mm.energyKwh.toFixed(0)} kWh`);
  }
} else {
  console.log('       (bỏ qua — không thấy file thật)');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} ok · ${fail} sai\n`);
process.exit(fail ? 1 : 0);

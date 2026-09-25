/**
 * Bộ kiểm thử `scripts/lib/thongso.mjs` — chạy: node scripts/dm_test_thongso.mjs
 */
import { rawRow, scaleRow, buildHsnResolver, metersForRange, THONGSO_COLUMNS } from './lib/thongso.mjs';

let pass = 0, fail = 0;
const eq = (ten, thuc, mong) => {
  const good = JSON.stringify(thuc) === JSON.stringify(mong);
  if (good) { pass++; console.log(`  ok   ${ten}`); }
  else { fail++; console.log(`  SAI  ${ten}\n       nhận : ${JSON.stringify(thuc)}\n       mong : ${JSON.stringify(mong)}`); }
};

console.log('Lưu RAW: đúng chuỗi HES trả, không nhân gì');
const rec = {
  METER_NO: '2510203103', DATE_TIME: '2026-09-18 11:00:00',
  PHASE_A_VOLTS: '228.690', PHASE_B_VOLTS: '226.740', PHASE_C_VOLTS: '227.570', TOTAL_CURRENT: '',
  PHASE_A_AMPERE: '1.900', PHASE_B_AMPERE: '1.870', PHASE_C_AMPERE: '1.800',
  TOTAL_KW: '-1.385', PHASE_A_KW: '-0.467', PHASE_B_KW: '-0.462', PHASE_C_KW: '-0.455',
  TOTAL_KVAR: '0.176', PHASE_A_KVAR: '0.062', PHASE_B_KVAR: '0.063', PHASE_C_KVAR: '0.050',
  TOTAL_PF: '0.990', FREQUENCE: '50.140', PHASE_A_VOLT_ANGLE: '172.307', CTString: '1/1',
};
const raw = rawRow('2510203103', rec);
eq('cột đúng thứ tự', Object.keys(raw), THONGSO_COLUMNS);
eq('P, I, U giữ nguyên chuỗi', [raw.P, raw.I_A, raw.U_A], ['-1.385', '1.900', '228.690']);
eq('bỏ góc pha / CTString', ['PHASE_A_VOLT_ANGLE' in raw, 'CTString' in raw], [false, false]);

console.log('Nhân HSN lúc đọc: I, P, Q ×HSN; U, PF, tần số giữ nguyên');
{
  const s = scaleRow(raw, 400);
  const r2 = (x) => Math.round(x * 1000) / 1000;
  eq('P = −1,385 × 400 = −554 (khớp datametter 18/09 11:00)', r2(s.P), -554);
  eq('I_A = 1,9 × 400 = 760 A', r2(s.I_A), 760);
  eq('Q = 0,176 × 400 = 70,4', r2(s.Q), 70.4);
  eq('U giữ nguyên', s.U_A, 228.69);
  eq('PF giữ nguyên (không thành 396)', s.PF, 0.99);
  eq('tần số giữ nguyên', s.F, 50.14);
  eq('ô rỗng = null, không phải 0', scaleRow({ ...raw, P: '' }, 400).P, null);
}

console.log('Tra HSN theo điểm đo tại THỜI ĐIỂM của mốc');
const points = [
  { id: 'pA', hsn: 400 }, { id: 'pB', hsn: 80 }, { id: 'pC', hsn: null },
];
const assets = [
  /* công tơ X: treo ở A tới 28/07, sang B từ 21/09 */
  { type: 'CONGTO', serial: 'X', point: 'pA', date_on: '2024-02-29 00:00:00.000Z', date_off: '2026-07-28 00:00:00.000Z' },
  { type: 'CONGTO', serial: 'X', point: 'pB', date_on: '2026-09-21 00:00:00.000Z', date_off: '' },
  /* công tơ Y: thiếu ngày treo */
  { type: 'CONGTO', serial: 'Y', point: 'pA', date_on: '', date_off: '' },
  /* công tơ Z: điểm đo chưa khai HSN */
  { type: 'CONGTO', serial: 'Z', point: 'pC', date_on: '2026-01-01', date_off: '' },
  /* tháo và treo lại CÙNG ngày ở điểm khác ⇒ lấy lần treo muộn */
  { type: 'CONGTO', serial: 'W', point: 'pA', date_on: '2026-01-01', date_off: '2026-09-10' },
  { type: 'CONGTO', serial: 'W', point: 'pB', date_on: '2026-09-10', date_off: '' },
  { type: 'TI', serial: 'X', point: 'pC', date_on: '2026-01-01' },
];
const hsnAt = buildHsnResolver(assets, points);
eq('X ngày 01/07 → điểm A, HSN 400', hsnAt('X', '2026-07-01 10:00:00').hsn, 400);
eq('X đúng ngày tháo 28/07 → vẫn A', hsnAt('X', '2026-07-28 09:00:00').hsn, 400);
eq('X ngày 15/08 (giữa hai lần treo) → không nhân', hsnAt('X', '2026-08-15 10:00:00'), { reason: 'KHONG_TREO_NGAY_NAY' });
eq('X ngày 22/09 → điểm B, HSN 80', hsnAt('X', '2026-09-22 10:00:00').hsn, 80);
eq('Y thiếu ngày treo → không đoán', hsnAt('Y', '2026-09-22 10:00:00'), { reason: 'THIEU_NGAY_TREO' });
eq('Z điểm đo chưa có HSN', hsnAt('Z', '2026-09-22 10:00:00'), { reason: 'DIEM_DO_THIEU_HSN' });
eq('W tháo/treo cùng ngày → lần treo muộn (B)', hsnAt('W', '2026-09-10 12:00:00').hsn, 80);
eq('công tơ lạ', hsnAt('Q', '2026-09-22 10:00:00'), { reason: 'KHONG_CO_TRONG_DANH_MUC' });
eq('bản ghi TI cùng serial không lẫn vào', hsnAt('X', '2026-09-22 10:00:00').point.id, 'pB');

console.log('Công tơ cần lấy cho khoảng ngày');
eq('01/08 → 20/09: X (không lần nào giao), Y, Z, W', metersForRange(assets, '2026-08-01', '2026-09-20'), ['W', 'Y', 'Z']);
eq('01/07 → 30/09: có X', metersForRange(assets, '2026-07-01', '2026-09-30'), ['W', 'X', 'Y', 'Z']);

console.log('Điểm ĐẦU NGUỒN (role dau_nguon, không trạm) tra HSN như mọi điểm đo');
{
  const pts = [...points, { id: 'pH', hsn: 8800, role: 'dau_nguon', station: '', line: 'L1' }];
  const as = [...assets, { type: 'CONGTO', serial: 'H', point: 'pH', date_on: '2025-06-05', date_off: '' }];
  eq('HSN 8800 theo điểm đo (TI 200/5 × TU 22/0,1)', buildHsnResolver(as, pts)('H', '2026-09-22 10:00:00').hsn, 8800);
  eq('trước ngày treo → không nhân', buildHsnResolver(as, pts)('H', '2025-06-01 10:00:00').reason, 'KHONG_TREO_NGAY_NAY');
  eq('nằm trong danh sách cần lấy', metersForRange(as, '2026-08-01', '2026-09-20').includes('H'), true);
}

console.log(`\n${pass} ok, ${fail} sai`);
process.exit(fail ? 1 : 0);

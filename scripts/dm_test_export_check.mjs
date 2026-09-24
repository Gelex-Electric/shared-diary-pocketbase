/**
 * Bộ kiểm thử `scripts/lib/exportCheck.mjs` — chạy: node scripts/dm_test_export_check.mjs
 */
import { detectReverse, peakNote, buildReverseAlert } from './lib/exportCheck.mjs';

let pass = 0, fail = 0;
const eq = (ten, thuc, mong) => {
  const good = typeof mong === 'number' ? Math.abs(thuc - mong) < 1e-6 : JSON.stringify(thuc) === JSON.stringify(mong);
  if (good) { pass++; console.log(`  ok   ${ten}`); }
  else { fail++; console.log(`  SAI  ${ten}\n       nhận : ${JSON.stringify(thuc)}\n       mong : ${JSON.stringify(mong)}`); }
};

const D = '2026-09-18';
const t = (i) => `${D} ${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00`;
/** 48 mốc; neg(i)/nvar(i) = chỉ số thô chiều nhận tại mốc i. */
const day = (neg, nvar = () => 0) => Array.from({ length: 48 }, (_, i) => ({
  DATE_TIME: t(i), ACTIVE_KW_INDICATE_TOTAL: 1000 + i,
  NEGACTIVE_KW_INDICATE_TOTAL: neg(i), NEGACTIVE_KVAR_INDICATE_TOTAL: nvar(i),
}));

console.log('Công tơ không phát (đối chứng JOHNSON1: 0,000 cả ngày)');
{
  const r = detectReverse(day(() => 0), 400);
  eq('phatnguoc = null', r.phatnguoc, null);
  eq('dubu = null', r.dubu, null);
}

console.log('FOT-giả 18/09: hồ sơ phát ngược theo nửa giờ, HSN 400');
{
  /* kWh sau ×400 theo mốc ĐẦU khoảng — đúng hồ sơ gọi tay 24/09 */
  const prof = { '06:00': 4, '06:30': 28, '07:00': 16, '07:30': 36, '08:00': 16, '08:30': 100,
    '09:00': 76, '09:30': 100, '10:00': 120, '10:30': 172, '11:00': 188, '11:30': 152,
    '13:00': 4, '15:30': 4 };
  const base = 50;
  const cum = [base];
  for (let i = 1; i < 48; i++) cum[i] = cum[i - 1] + (prof[t(i - 1).slice(11, 16)] ?? 0) / 400;
  const r = detectReverse(day(i => cum[i].toFixed(3), i => (i < 12 ? i * 0.2 : 2.2).toFixed(3)), 400);
  eq('kWh = 1.016', r.phatnguoc.value, 1016);
  eq('chỉ số thô 50 → 52,54', [r.phatnguoc.fromIndex, r.phatnguoc.toIndex], [50, 52.54]);
  eq('từ 06:00', r.phatnguoc.fromTime, `${D} 06:00:00`);
  eq('đến 16:00 (cuối khoảng 15:30)', r.phatnguoc.toTime, `${D} 16:00:00`);
  eq('đỉnh 188 lúc 11:00', r.phatnguoc.peak, { value: 188, at: `${D} 11:00:00` });
  eq('ghi chú đỉnh', peakNote(r.phatnguoc), 'đỉnh 188 kWh lúc 11:00');
  eq('đơn vị/biểu', [r.phatnguoc.unit, r.phatnguoc.register], ['kWh', 'Hữu công nhận – tổng']);
  eq('dư bù 2,2 × 400 = 880 kVArh (vô công giao = 0 ⇒ tỷ lệ vô cực)', r.dubu.value, 880);
  eq('dư bù đơn vị', r.dubu.unit, 'kVArh');
  eq('dư bù khung 00:00 → 05:30 (chỉ số đạt 2,2 tại mốc 11)', [r.dubu.fromTime, r.dubu.toTime], [`${D} 00:00:00`, `${D} 05:30:00`]);
}

console.log('Chỉ số nhận LÙI (thay công tơ) — không báo bừa, không cộng số âm');
{
  const r = detectReverse(day(i => (i < 20 ? 5000 : 0).toFixed(3)), 400);
  eq('lùi thuần → null', r.phatnguoc, null);
  const r2 = detectReverse(day(i => (i < 20 ? 5000 : i === 20 ? 0 : 0.01).toFixed(3)), 400);
  eq('lùi rồi nhích 0,01 → chỉ 4 kWh', r2.phatnguoc.value, 4);
}

console.log('Nhích 1 nấc (0,001) vẫn báo — ngưỡng "> 0"');
{
  const r = detectReverse(day(i => (i >= 30 ? 7.001 : 7).toFixed(3)), 100);
  eq('0,001 × 100 = 0,1 kWh', r.phatnguoc.value, 0.1);
}

console.log('Dữ liệu thiếu / hỏng');
{
  eq('mảng rỗng', detectReverse([], 400), { phatnguoc: null, dubu: null });
  eq('HSN rỗng', detectReverse(day(i => i), ''), { phatnguoc: null, dubu: null });
  const noField = day(i => i).map(({ NEGACTIVE_KW_INDICATE_TOTAL, ...x }) => x);
  eq('API không trả trường nhận', detectReverse(noField, 400).phatnguoc, null);
  const shuffled = day(i => i * 0.01).reverse();
  eq('thứ tự lộn xộn vẫn đúng (47 × 0,01 × 10 = 4,7)', detectReverse(shuffled, 10).phatnguoc.value, 4.7);
}

console.log('Dư bù theo TỶ LỆ với vô công giao (ngưỡng 10%)');
{
  /* vô công giao +1 thô mỗi khoảng × 100 = 4.700 kVArh/ngày */
  const mk = (nvarStep) => Array.from({ length: 48 }, (_, i) => ({
    DATE_TIME: t(i), ACTIVE_KW_INDICATE_TOTAL: 1000 + i, NEGACTIVE_KW_INDICATE_TOTAL: 0,
    REACTIVE_KVAR_INDICATE_TOTAL: 500 + i, NEGACTIVE_KVAR_INDICATE_TOTAL: (i * nvarStep).toFixed(3),
  }));
  eq('5% (235 / 4.700) → KHÔNG báo', detectReverse(mk(0.05), 100).dubu, null);
  const r = detectReverse(mk(0.2), 100).dubu;
  eq('20% (940 / 4.700) → báo', [r.value, r.giao, Math.round(r.ratio * 100)], [940, 4700, 20]);
  eq('đúng 10% → báo (≥)', detectReverse(mk(0.1), 100).dubu?.value, 470);
  eq('20% nhưng chỉ 188 kVArh (< 200) → KHÔNG báo', detectReverse(mk(0.2), 20).dubu, null);
  eq('FOT-giả đêm 88 kVArh, giao = 0 → KHÔNG báo (dưới 200)', detectReverse(day(() => 0, i => (i < 12 ? i * 0.02 : 0.22).toFixed(3)), 400).dubu, null);
  eq('ghi chú có tỷ lệ', peakNote(r), '= 20% vô công giao (4.700 kVArh) · đỉnh 20 kVArh lúc 00:00');
  const a = buildReverseAlert(D, [{ m: { serial: 'X', code: 'T1', zone: 'KCN A', mkh: 'k' }, r }], () => 'KH', z => z[0], 'dubu');
  eq('cảnh báo dư bù: kind/đơn vị/biểu', [a.kind, a.details[0].unit, a.details[0].register], ['dubu', 'kVArh', 'Vô công nhận – tổng']);
}

console.log(`\n${pass} ok, ${fail} sai`);
process.exit(fail ? 1 : 0);

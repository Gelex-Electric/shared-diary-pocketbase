/**
 * Bộ kiểm thử `scripts/lib/headBalance.mjs` — chạy: node scripts/dm_test_head_balance.mjs
 */
import { balanceOfDay, alertsOfRow } from './lib/headBalance.mjs';

let pass = 0, fail = 0;
const eq = (ten, thuc, mong) => {
  const good = JSON.stringify(thuc) === JSON.stringify(mong);
  if (good) { pass++; console.log(`  ok   ${ten}`); }
  else { fail++; console.log(`  SAI  ${ten}\n       nhận : ${JSON.stringify(thuc)}\n       mong : ${JSON.stringify(mong)}`); }
};
/** Công tơ giả: P cố định mỗi mốc trên `n` mốc ⇒ E = P × 0,5 × n. */
const meter = (p, n = 48, peak) => {
  const slots = new Map(Array.from({ length: n }, (_, i) => [i, { p: i === peak?.[0] ? peak[1] : p, q: 0 }]));
  const e = [...slots.values()].reduce((t, v) => t + v.p * 0.5, 0);
  return { hsn: 1, slots, energyKwh: e, energyKvarh: 0, covered: n, regress: 0 };
};
const head = { code: 'TTI.DN', lineCode: '473', serials: ['H'] };

console.log('Ngày đủ số: đầu nguồn 1.000 kW, hai điểm đo 480 + 470 kW');
{
  const s = { day: '2026-09-23', meters: new Map([['H', meter(1000, 48, [28, 1500])], ['A', meter(480)], ['B', meter(470)]]) };
  const r = balanceOfDay(s, head, [{ serial: 'A' }, { serial: 'B' }], { PMAX_KW: '1440', AT: '14:00' });
  eq('E_HEAD = 1000×24 + 500×0,5 = 24.250', r.E_HEAD_KWH, 24250);
  eq('E_SUM = 950×24 = 22.800', r.E_SUM_KWH, 22800);
  eq('tổn thất 1.450 kWh = 5,98 %', [r.LOSS_KWH, r.LOSS_PCT], [1450, 5.98]);
  eq('Pmax đầu nguồn 1.500 kW lúc 14:00', [r.PMAX_HEAD_KW, r.AT_HEAD], [1500, '14:00']);
  eq('Pmax lộ / đầu nguồn = 96 %', r.PMAX_RATIO, 96);
  eq('phủ 2/2/2', [r.COVERED, r.WITH_DATA, r.TOTAL], [2, 2, 2]);
}

console.log('Ngày thiếu số: một điểm đo mất sạch, một điểm đo thiếu nửa ngày');
{
  const s = { day: '2026-09-23', meters: new Map([['H', meter(1000)], ['A', meter(480, 24)]]) };
  const r = balanceOfDay(s, head, [{ serial: 'A' }, { serial: 'B' }], undefined);
  eq('phủ: 0 đủ 48 mốc / 1 có số / 2 tổng', [r.COVERED, r.WITH_DATA, r.TOTAL], [0, 1, 2]);
  eq('không có Pmax lộ ⇒ ô trống, không chia bừa', [r.PMAX_LINE_KW, r.PMAX_RATIO], ['', '']);
}

console.log('Thiếu file hôm sau: mọi công tơ cùng 47 mốc ⇒ vẫn tính là đủ số');
{
  const s = { day: 'd', meters: new Map([['H', meter(1000, 47)], ['A', meter(480, 47)]]) };
  eq('phủ 1/1/1', [balanceOfDay(s, head, [{ serial: 'A' }]).COVERED], [1]);
}
console.log('Đầu nguồn mới có số từ giữa ngày (<24 mốc) ⇒ không sinh dòng rác');
eq('null', balanceOfDay({ day: 'd', meters: new Map([['H', meter(1000, 10)], ['A', meter(480)]]) }, head, [{ serial: 'A' }]), null);

console.log('Đầu nguồn không có số ⇒ không sinh dòng');
eq('null', balanceOfDay({ day: 'x', meters: new Map([['A', meter(1)]]) }, head, [{ serial: 'A' }]), null);

console.log('Tổng điểm đo LỚN HƠN đầu nguồn (sai HSN / đếm trùng) ⇒ tổn thất âm, giữ nguyên dấu');
{
  const s = { day: 'd', meters: new Map([['H', meter(100)], ['A', meter(120)]]) };
  eq('−20 %', balanceOfDay(s, head, [{ serial: 'A' }]).LOSS_PCT, -20);
}

console.log('Cảnh báo: lệch trung vị 7 ngày, Pmax ngoài [90,105], thiếu dữ liệu');
{
  const day = (d, pct, extra = {}) => ({ DATE: `2026-09-${String(d).padStart(2, '0')}`, LOSS_PCT: pct, PMAX_RATIO: 98,
    COVERED: 11, TOTAL: 11, HEAD_SLOTS: 48, ...extra });
  const hist = [1, 2, 3, 4, 5, 6, 7].map(d => day(d, 2.3));
  eq('2,4 % (lệch 0,1) → im lặng', alertsOfRow(day(8, 2.4), hist), []);
  eq('4,3 % (lệch 2,0 > 1,5) → lệch', alertsOfRow(day(8, 4.3), hist), [{ type: 'lech', median: 2.3, dev: 2 }]);
  eq('−0,5 % (lệch −2,8) → lệch', alertsOfRow(day(8, -0.5), hist)[0].type, 'lech');
  eq('chưa đủ 7 ngày lịch sử → chưa xét lệch', alertsOfRow(day(8, 9), hist.slice(1)), []);
  eq('ngày thiếu số trong lịch sử không tính vào 7 ngày', alertsOfRow(day(9, 9), [...hist.slice(1), day(8, 2.3, { COVERED: 10 })]), []);
  eq('Pmax 88 % → pmax', alertsOfRow(day(8, 2.3, { PMAX_RATIO: 88 }), hist), [{ type: 'pmax', ratio: 88 }]);
  eq('Pmax 105 % (biên) → im lặng', alertsOfRow(day(8, 2.3, { PMAX_RATIO: 105 }), hist), []);
  eq('thiếu số → CHỈ thẻ thiếu, không xét lệch dù 9 %', alertsOfRow(day(8, 9, { COVERED: 10, missing: [{ serial: 'A', slots: 20 }] }), hist),
    [{ type: 'thieu', missing: [{ serial: 'A', slots: 20 }] }]);
  eq('đầu nguồn chưa đủ mốc (30) → không báo gì', alertsOfRow(day(8, 50, { HEAD_SLOTS: 30 }), hist), []);
  eq('47 mốc kèm dấu * (thiếu file hôm sau) vẫn xét', alertsOfRow(day(8, 4.3, { HEAD_SLOTS: '47*' }), hist)[0].type, 'lech');
}

console.log(`\n${pass} ok, ${fail} sai`);
process.exit(fail ? 1 : 0);

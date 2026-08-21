/**
 * Bộ kiểm thử luật QLVH — chạy: npx tsx scripts/qlvh_test.ts
 *
 * Chỉ import `src/lib/qlvhRules.ts` (module thuần, không đụng PocketBase).
 * Chạy trước mỗi lần commit: sửa giao diện mà ca đỏ nghĩa là đã lỡ đụng nghiệp vụ.
 */

import {
  addYears, allocatePayment, buildSchedule, computeVat, durationMonths,
  isLocked, overdueDays, paymentStatus, remainingOf, scheduleWarning, summarize,
  type PaymentLike,
} from '../src/lib/qlvhRules';

let pass = 0;
const fails: string[] = [];

function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fails.push(`${label}\n     mong đợi: ${b}\n     nhận được: ${a}`);
}

/* ------------------------------------------------------------- addYears */

eq(addYears('2026-01-01', 1), '2027-01-01', 'addYears: cộng năm thường');
eq(addYears('2028-02-29', 1), '2029-02-28', 'addYears: 29/02 năm nhuận → kẹp về 28/02');
eq(addYears('2028-02-29', 4), '2032-02-29', 'addYears: 29/02 + 4 năm vẫn là năm nhuận');
eq(addYears('2026-08-21', 0), '2026-08-21', 'addYears: cộng 0 năm giữ nguyên');

/* -------------------------------------------------------- buildSchedule */

const s12 = buildSchedule('2026-01-01', '2026-12-31', 120_000_000);
eq(s12.length, 1, 'buildSchedule: 12 tháng ⇒ 1 đợt');
eq(s12[0], { seq: 1, due_date: '2026-01-01', amount_due: 120_000_000 }, 'buildSchedule: 12 tháng, đợt 1 đúng ngày + đủ tiền');

const s24 = buildSchedule('2026-01-01', '2027-12-31', 240_000_000);
eq(s24.map(r => r.due_date), ['2026-01-01', '2027-01-01'], 'buildSchedule: 24 tháng ⇒ 2 đợt, cách nhau 1 năm');
eq(s24.map(r => r.amount_due), [120_000_000, 120_000_000], 'buildSchedule: 24 tháng chia đôi');

const s36 = buildSchedule('2026-03-15', '2029-03-14', 300_000_000);
eq(s36.length, 3, 'buildSchedule: 36 tháng ⇒ 3 đợt');
eq(s36.map(r => r.due_date), ['2026-03-15', '2027-03-15', '2028-03-15'], 'buildSchedule: 36 tháng, mốc kỷ niệm hằng năm');

const s18 = buildSchedule('2026-01-01', '2027-06-30', 180_000_000);
eq(s18.length, 2, 'buildSchedule: 18 tháng (lẻ) ⇒ 2 đợt');

const sOdd = buildSchedule('2026-01-01', '2028-12-31', 100_000_000);
eq(sOdd.map(r => r.amount_due), [33_333_333, 33_333_333, 33_333_334], 'buildSchedule: chia lẻ, phần dư dồn vào đợt cuối');
eq(sOdd.reduce((s, r) => s + r.amount_due, 0), 100_000_000, 'buildSchedule: tổng đợt luôn khớp tuyệt đối giá trị HĐ');

const sLeap = buildSchedule('2028-02-29', '2030-02-28', 100_000_000);
eq(sLeap.map(r => r.due_date), ['2028-02-29', '2029-02-28'], 'buildSchedule: hiệu lực từ 29/02 vẫn sinh đúng mốc');

eq(buildSchedule('', '2027-12-31', 10).length, 0, 'buildSchedule: thiếu ngày hiệu lực ⇒ rỗng');
eq(buildSchedule('2026-01-01', '', 10).length, 1, 'buildSchedule: vô thời hạn ⇒ 1 đợt');

/* ------------------------------------------------------ durationMonths */

eq(durationMonths('2026-01-01', '2026-12-31'), 12, 'durationMonths: ghi tới ngày cuối năm = 12 tháng');
eq(durationMonths('2026-01-01', '2027-12-31'), 24, 'durationMonths: 2 năm = 24 tháng');
eq(durationMonths('2026-03-15', '2027-03-14'), 12, 'durationMonths: tròn năm lệch ngày = 12 tháng');
eq(durationMonths('2025-07-17', '2028-07-17'), 36, 'durationMonths: ghi tới ngày kỷ niệm = 36 tháng (không phải 37)');
eq(durationMonths('2026-01-01', '2027-06-30'), 18, 'durationMonths: 18 tháng');
eq(durationMonths('2026-01-01', ''), 0, 'durationMonths: thiếu ngày ⇒ 0');
eq(durationMonths('2026-12-31', '2026-01-01'), 0, 'durationMonths: ngày ngược ⇒ 0, không ra số âm');

/* -------------------------------------------------------- paymentStatus */

const TODAY = '2026-08-21';
const mk = (o: Partial<PaymentLike>): PaymentLike => ({ seq: 1, due_date: '2026-08-01', amount_due: 100, ...o });

eq(paymentStatus(mk({ paid_date: '2026-08-10', amount_paid: 100 }), TODAY), 'da_thu', 'status: thu đủ ⇒ đã thu');
eq(paymentStatus(mk({ paid_date: '2026-08-10', amount_paid: 150 }), TODAY), 'da_thu', 'status: thu dư vẫn tính đã thu');
eq(paymentStatus(mk({ paid_date: '2026-08-10', amount_paid: 40 }), TODAY), 'thu_thieu', 'status: thu thiếu');
eq(paymentStatus(mk({ due_date: '2026-08-01' }), TODAY), 'qua_han', 'status: quá hạn khi chưa thu và đã qua ngày');
eq(paymentStatus(mk({ due_date: '2026-08-30' }), TODAY), 'sap_den_han', 'status: còn 9 ngày ⇒ sắp đến hạn');
eq(paymentStatus(mk({ due_date: '2026-09-30' }), TODAY), 'chua_den_han', 'status: còn 40 ngày ⇒ chưa đến hạn');
eq(paymentStatus(mk({ due_date: '2026-08-21' }), TODAY), 'sap_den_han', 'status: đến hạn đúng hôm nay chưa tính quá hạn');
eq(paymentStatus(mk({ due_date: '2026-09-05' }), TODAY), 'sap_den_han', 'status: đúng ngưỡng 15 ngày vẫn là sắp đến hạn');
eq(paymentStatus(mk({ due_date: '2026-09-06' }), TODAY), 'chua_den_han', 'status: quá ngưỡng 1 ngày ⇒ chưa đến hạn');
eq(paymentStatus(mk({ due_date: '2026-08-01', amount_paid: 40 }), TODAY), 'thu_thieu',
   'status: đã thu một phần thì KHÔNG còn báo quá hạn (có tiền vào là đã động tới)');
eq(paymentStatus(mk({ due_date: '2026-08-01 00:00:00.000Z', paid_date: '' }), TODAY), 'qua_han',
   'status: chịu được định dạng ngày của PocketBase');

eq(overdueDays(mk({ due_date: '2026-08-01' }), TODAY), 20, 'overdueDays: quá hạn 20 ngày');
eq(overdueDays(mk({ due_date: '2026-09-30' }), TODAY), 0, 'overdueDays: chưa quá hạn ⇒ 0');
eq(remainingOf(mk({ amount_paid: 40 })), 60, 'remainingOf: còn phải thu');
eq(remainingOf(mk({ amount_paid: 150 })), 0, 'remainingOf: thu dư không ra số âm');

/* ------------------------------------------------------ allocatePayment */

const sched = (): PaymentLike[] => [
  { id: 'a', seq: 1, due_date: '2026-01-01', amount_due: 100 },
  { id: 'b', seq: 2, due_date: '2027-01-01', amount_due: 100 },
  { id: 'c', seq: 3, due_date: '2028-01-01', amount_due: 100 },
];

const exact = allocatePayment(sched(), 100, '2026-01-05');
eq(exact.changes.length, 1, 'allocate: thu đúng 1 đợt ⇒ chỉ đụng đợt 1');
eq(exact.changes[0], { id: 'a', seq: 1, amount_paid: 100, paid_date: '2026-01-05' }, 'allocate: đợt 1 thu đủ');
eq(exact.leftover, 0, 'allocate: không thừa tiền');

const over = allocatePayment(sched(), 250, '2026-01-05');
eq(over.changes.map(c => [c.seq, c.amount_paid]), [[1, 100], [2, 100], [3, 50]],
   'allocate: một cục tiền tràn qua nhiều đợt, đợt cuối thành thu thiếu');
eq(over.leftover, 0, 'allocate: 250 rải hết vào 3 đợt');

const under = allocatePayment(sched(), 30, '2026-01-05');
eq(under.changes, [{ id: 'a', seq: 1, amount_paid: 30, paid_date: '2026-01-05' }], 'allocate: thu thiếu thì dừng ở đợt 1');

const partial: PaymentLike[] = [
  { id: 'a', seq: 1, due_date: '2026-01-01', amount_due: 100, amount_paid: 40, paid_date: '2026-01-02' },
  { id: 'b', seq: 2, due_date: '2027-01-01', amount_due: 100 },
];
const topUp = allocatePayment(partial, 80, '2026-02-01');
eq(topUp.changes.map(c => [c.seq, c.amount_paid]), [[1, 100], [2, 20]],
   'allocate: đợt đang thu thiếu được CỘNG DỒN (40+60), phần dư sang đợt sau');

const done: PaymentLike[] = [{ id: 'a', seq: 1, due_date: '2026-01-01', amount_due: 100, amount_paid: 100 }];
eq(allocatePayment(done, 50, '2026-02-01'), { changes: [], leftover: 50 },
   'allocate: mọi đợt đã thu đủ ⇒ không đụng gì, báo tiền thừa 50');

const unordered: PaymentLike[] = [
  { id: 'c', seq: 3, due_date: '2028-01-01', amount_due: 100 },
  { id: 'a', seq: 1, due_date: '2026-01-01', amount_due: 100 },
];
eq(allocatePayment(unordered, 100, '2026-01-05').changes[0].seq, 1,
   'allocate: dữ liệu vào lộn xộn vẫn trả đợt theo thứ tự seq');

/* -------------------------------------------------------------- tổng hợp */

const totals = summarize([
  { seq: 1, due_date: '2026-01-01', amount_due: 100, amount_paid: 100, paid_date: '2026-01-01' },
  { seq: 2, due_date: '2026-08-01', amount_due: 100 },
  { seq: 3, due_date: '2026-08-30', amount_due: 100 },
  { seq: 4, due_date: '2027-01-01', amount_due: 100 },
], TODAY);
eq([totals.valueTotal, totals.paid, totals.remaining], [400, 100, 300], 'summarize: tổng / đã thu / còn lại');
eq([totals.overdueCount, totals.overdueAmount], [1, 100], 'summarize: đếm đúng đợt quá hạn');
eq([totals.dueSoonCount, totals.dueSoonAmount], [1, 100], 'summarize: đếm đúng đợt sắp đến hạn');

/* ------------------------------------------------------- cảnh báo & khoá */

eq(scheduleWarning([{ seq: 1, due_date: '', amount_due: 100_000_000 }], 100_000_000), '',
   'scheduleWarning: khớp thì im lặng');
eq(scheduleWarning([{ seq: 1, due_date: '', amount_due: 100_000_500 }], 100_000_000), '',
   'scheduleWarning: lệch trong ngưỡng làm tròn 1.000đ thì bỏ qua');
eq(scheduleWarning([{ seq: 1, due_date: '', amount_due: 90_000_000 }], 100_000_000).includes('THIẾU'), true,
   'scheduleWarning: thiếu tiền thì báo');

eq(isLocked({ seq: 1, due_date: '', amount_due: 100 }), false, 'isLocked: chưa thu ⇒ sửa được');
eq(isLocked({ seq: 1, due_date: '', amount_due: 100, amount_paid: 10 }), true, 'isLocked: đã thu một phần ⇒ khoá');

eq(computeVat(100_000_000, 8), { value_vat: 8_000_000, value_total: 108_000_000 }, 'computeVat: VAT 8%');
eq(computeVat(100_000_000, 0), { value_vat: 0, value_total: 100_000_000 }, 'computeVat: không thuế');

/* ------------------------------------------------------------------ báo */

console.log(`\nQLVH rules: ${pass} ca xanh, ${fails.length} ca đỏ`);
if (fails.length) {
  console.error('\n' + fails.map((f, i) => ` ${i + 1}. ${f}`).join('\n\n'));
  process.exit(1);
}

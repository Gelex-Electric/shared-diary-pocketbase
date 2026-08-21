/**
 * Bộ kiểm thử luật QLVH — chạy: npx tsx scripts/qlvh_test.ts
 *
 * Chỉ import `src/lib/qlvhRules.ts` (module thuần, không đụng PocketBase).
 * Chạy trước mỗi lần commit: sửa giao diện mà ca đỏ nghĩa là đã lỡ đụng nghiệp vụ.
 */

import {
  addYears, buildSchedule, computeVat, durationMonths,
  isLocked, overdueDays, paymentStatus, remainingOf, scheduleWarning, summarize,
  withVat, withoutVat,
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
/* Luật: đợt 1 = ngày hiệu lực + 7 ngày (điều khoản HĐ); đợt sau = mốc kỷ niệm
   năm. Tiền = số tháng đợt phủ × đơn giá tháng, tính trên giá trị TRƯỚC THUẾ. */

const s12 = buildSchedule('2026-01-01', '2026-12-31', 120_000_000);
eq(s12.length, 1, 'buildSchedule: 12 tháng ⇒ 1 đợt');
eq(s12[0], { seq: 1, due_date: '2026-01-08', amount_due: 120_000_000, months: 12 },
   'buildSchedule: 12 tháng — đợt 1 đến hạn sau ngày hiệu lực 7 ngày, đủ tiền');

const s24 = buildSchedule('2026-01-01', '2027-12-31', 240_000_000);
eq(s24.map(r => r.due_date), ['2026-01-08', '2027-01-01'],
   'buildSchedule: đợt 1 +7 ngày, đợt 2 đúng mốc kỷ niệm (KHÔNG +7)');
eq(s24.map(r => r.amount_due), [120_000_000, 120_000_000], 'buildSchedule: 24 tháng chia đôi');

const s36 = buildSchedule('2026-03-15', '2029-03-14', 300_000_000);
eq(s36.length, 3, 'buildSchedule: 36 tháng ⇒ 3 đợt');
eq(s36.map(r => r.due_date), ['2026-03-22', '2027-03-15', '2028-03-15'],
   'buildSchedule: 36 tháng, mốc kỷ niệm hằng năm');
eq(s36.map(r => r.amount_due), [100_000_000, 100_000_000, 100_000_000], 'buildSchedule: 36 tháng chia ba');

/* Ca lẻ — chỗ "chia đều" sai và "đơn giá tháng" đúng. Số liệu lấy từ 2 hợp đồng
   thật trong file theo dõi (SOL E&C 18 tháng, An T 7 tháng). */
const s18 = buildSchedule('2025-10-03', '2027-04-03', 28_928_573);
eq(s18.length, 2, 'buildSchedule: 18 tháng ⇒ 2 đợt');
eq(s18.map(r => r.months), [12, 6], 'buildSchedule: 18 tháng phủ 12 + 6 tháng');
eq(s18.map(r => r.amount_due), [19_285_715, 9_642_858],
   'buildSchedule: 18 tháng — đợt 2 chỉ bằng NỬA đợt 1 (chia đều là sai)');
eq(s18.reduce((s, r) => s + r.amount_due, 0), 28_928_573, 'buildSchedule: 18 tháng, Σ khớp tuyệt đối');

const s7 = buildSchedule('2024-12-19', '2025-07-19', 13_696_865);
eq(s7.length, 1, 'buildSchedule: 7 tháng ⇒ 1 đợt');
eq(s7[0].amount_due, 13_696_865, 'buildSchedule: 7 tháng thu trọn 7 tháng, không phải 6');

const sOdd = buildSchedule('2026-01-01', '2028-12-31', 100_000_000);
eq(sOdd.reduce((s, r) => s + r.amount_due, 0), 100_000_000, 'buildSchedule: chia lẻ, Σ vẫn khớp tuyệt đối');

const sLeap = buildSchedule('2028-02-29', '2030-02-28', 100_000_000);
eq(sLeap.map(r => r.due_date), ['2028-03-07', '2029-02-28'],
   'buildSchedule: hiệu lực 29/02 — đợt 1 +7 ngày sang tháng 3, đợt 2 kẹp về 28/02');

eq(buildSchedule('2026-01-01', '2026-12-31', 120_000_000, 0)[0].due_date, '2026-01-01',
   'buildSchedule: cho phép tắt ân hạn (graceDays = 0)');
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

const mk = (o: Partial<PaymentLike>): PaymentLike => ({ seq: 1, due_date: '2026-08-01', amount_due: 100, ...o });
const TODAY = '2026-08-21';
/* Luật mới (21/08/2026): NGÀY THANH TOÁN quyết định — có ngày = đã thu. */
eq(paymentStatus(mk({ paid_date: '2026-08-10', amount_paid: 100 }), TODAY), 'da_thu', 'status: có ngày thanh toán ⇒ đã thu');
eq(paymentStatus(mk({ paid_date: '2026-08-10', amount_paid: 0 }), TODAY), 'da_thu',
   'status: có ngày nhưng chưa điền tiền vẫn là ĐÃ THU (ngày quyết định)');
eq(paymentStatus(mk({ due_date: '2026-01-01', paid_date: '2026-08-10' }), TODAY), 'da_thu',
   'status: quá hạn nhưng đã có ngày thanh toán ⇒ đã thu, không báo quá hạn nữa');

eq(paymentStatus(mk({ due_date: '2026-08-01' }), TODAY), 'qua_han', 'status: quá hạn khi chưa thu và đã qua ngày');
eq(paymentStatus(mk({ due_date: '2026-08-30' }), TODAY), 'sap_den_han', 'status: còn 9 ngày ⇒ sắp đến hạn');
eq(paymentStatus(mk({ due_date: '2026-09-30' }), TODAY), 'chua_den_han', 'status: còn 40 ngày ⇒ chưa đến hạn');
eq(paymentStatus(mk({ due_date: '2026-08-21' }), TODAY), 'sap_den_han', 'status: đến hạn đúng hôm nay chưa tính quá hạn');
eq(paymentStatus(mk({ due_date: '2026-09-05' }), TODAY), 'sap_den_han', 'status: đúng ngưỡng 15 ngày vẫn là sắp đến hạn');
eq(paymentStatus(mk({ due_date: '2026-09-06' }), TODAY), 'chua_den_han', 'status: quá ngưỡng 1 ngày ⇒ chưa đến hạn');
eq(paymentStatus(mk({ due_date: '2026-08-01', amount_paid: 40 }), TODAY), 'qua_han',
   'status: có tiền nhưng CHƯA có ngày thanh toán ⇒ vẫn là chưa thu / quá hạn');
eq(paymentStatus(mk({ due_date: '2026-08-01 00:00:00.000Z', paid_date: '' }), TODAY), 'qua_han',
   'status: chịu được định dạng ngày của PocketBase');

eq(overdueDays(mk({ due_date: '2026-08-01' }), TODAY), 20, 'overdueDays: quá hạn 20 ngày');
eq(overdueDays(mk({ due_date: '2026-09-30' }), TODAY), 0, 'overdueDays: chưa quá hạn ⇒ 0');
eq(remainingOf(mk({ amount_paid: 40 })), 100, 'remainingOf: chưa có ngày thanh toán ⇒ nợ TRỌN đợt');
eq(remainingOf(mk({ paid_date: '2026-08-10', amount_paid: 0 })), 0, 'remainingOf: có ngày thanh toán ⇒ hết nợ');

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
eq(summarize([{ seq: 1, due_date: "2026-01-01", amount_due: 100, amount_paid: 40 }], TODAY).paid, 0,
   "summarize: có tiền nhưng chưa có ngày thanh toán ⇒ CHƯA tính là đã thu");
eq(summarize([{ seq: 1, due_date: "2026-01-01", amount_due: 100, paid_date: "2026-01-05" }], TODAY).paid, 100,
   "summarize: có ngày thanh toán ⇒ tính đã thu TRỌN đợt dù ô tiền để trống");

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

/* --------------------------------------------------- quy đổi trước/sau thuế */

eq(withVat(108_000_000, 8), 116_640_000, 'withVat: 108tr + 8% = 116,64tr');
eq(withVat(108_000_000, 0), 108_000_000, 'withVat: chế xuất 0% giữ nguyên');
eq(withoutVat(116_640_000, 8), 108_000_000, 'withoutVat: quay ngược đúng số gốc');
eq(withoutVat(withVat(28_928_573, 8), 8), 28_928_573, 'withVat rồi withoutVat về đúng số cũ');
eq(withVat(0, 8), 0, 'withVat: 0 vẫn là 0');
/* ------------------------------------------------------------------ báo */

console.log(`\nQLVH rules: ${pass} ca xanh, ${fails.length} ca đỏ`);
if (fails.length) {
  console.error('\n' + fails.map((f, i) => ` ${i + 1}. ${f}`).join('\n\n'));
  process.exit(1);
}

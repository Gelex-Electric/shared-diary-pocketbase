/**
 * Luật nghiệp vụ module QLVH (hợp đồng quản lý vận hành) — MODULE THUẦN.
 *
 * KHÔNG import PocketBase / React ở đây: để chạy được bằng `npx tsx` trong bộ
 * test (`scripts/qlvh_test.ts`). Mọi luật về lịch thanh toán, trạng thái thu
 * tiền và phân bổ tiền thu nằm ở file này — sửa luật thì sửa một chỗ, đừng rải
 * điều kiện ra giao diện.
 */

/* ------------------------------------------------------------------ Kiểu */

/** Một đợt thanh toán, ở dạng tối giản mà các luật cần biết. */
export interface PaymentLike {
  id?: string;
  seq: number;
  /** 'YYYY-MM-DD' */
  due_date: string;
  /** % giá trị hợp đồng — chỉ để nhớ cách người dùng nhập; tiền luôn lưu ở `amount_due`. */
  pct?: number;
  amount_due: number;
  /** 'YYYY-MM-DD' — rỗng = chưa thu đồng nào */
  paid_date?: string;
  amount_paid?: number;
}

export type PaymentStatus =
  | 'da_thu'
  | 'thu_thieu'
  | 'qua_han'
  | 'sap_den_han'
  | 'chua_den_han';

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  da_thu:        'Đã thu',
  thu_thieu:     'Thu thiếu',
  qua_han:       'Quá hạn',
  sap_den_han:   'Sắp đến hạn',
  chua_den_han:  'Chưa đến hạn',
};

/**
 * Lớp badge dùng chung của app — không tự đặt màu.
 * `vl-badge-*` trong index.css CHỈ cấp màu, phần hình dạng do nơi gọi thêm vào
 * (xem CustomerManager/PowerOutageManager), nên gói sẵn cả hai ở đây để mọi màn
 * hình của module hiện giống nhau.
 */
const BADGE_BASE = 'inline-flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded';

export const STATUS_BADGE: Record<PaymentStatus, string> = {
  da_thu:        `${BADGE_BASE} vl-badge-success`,
  thu_thieu:     `${BADGE_BASE} vl-badge-warning`,
  qua_han:       `${BADGE_BASE} vl-badge-danger`,
  sap_den_han:   `${BADGE_BASE} vl-badge-warning`,
  chua_den_han:  `${BADGE_BASE} vl-badge-info`,
};

/** Số ngày trước hạn thì coi là "sắp đến hạn" (user chốt 21/08/2026). */
export const SOON_DAYS = 15;

/* ------------------------------------------------------------- Ngày tháng */

/**
 * Cắt lấy phần ngày 'YYYY-MM-DD'. PocketBase trả date dạng
 * '2026-08-21 00:00:00.000Z', còn <input type=date>/DatePicker trả 'YYYY-MM-DD'
 * — gom về một dạng để so sánh bằng chuỗi (an toàn hơn so Date vì không dính
 * múi giờ).
 */
export function dayOf(value: string | undefined | null): string {
  if (!value) return '';
  return String(value).slice(0, 10);
}

export function todayStr(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Cộng thêm `years` năm, kẹp ngày khi tháng đích ngắn hơn:
 * 29/02/2028 + 1 năm = 28/02/2029 (không nhảy sang 01/03).
 */
export function addYears(day: string, years: number): string {
  const [y, m, d] = dayOf(day).split('-').map(Number);
  if (!y || !m || !d) return '';
  const targetYear = y + years;
  const lastDay = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${targetYear}-${p(m)}-${p(Math.min(d, lastDay))}`;
}

/** Số ngày từ `from` đến `to` (âm = đã qua). Chỉ dùng để hiển thị "quá N ngày". */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${dayOf(from)}T00:00:00Z`);
  const b = Date.parse(`${dayOf(to)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/** Thời hạn hợp đồng tính theo tháng — chỉ để hiển thị, không dùng chia đợt. */
export function durationMonths(from: string, to: string): number {
  const [y1, m1, d1] = dayOf(from).split('-').map(Number);
  const [y2, m2, d2] = dayOf(to).split('-').map(Number);
  if (!y1 || !y2) return 0;
  return (y2 - y1) * 12 + (m2 - m1) + (d2 >= d1 ? 1 : 0);
}

/* --------------------------------------------------- Sinh lịch thanh toán */

export interface ScheduleRow {
  seq: number;
  due_date: string;
  amount_due: number;
}

/**
 * Sinh lịch thanh toán: **thu 1 lần/năm**, số đợt suy ra từ thời hạn hợp đồng
 * (user chốt 21/08/2026 — 12 tháng ⇒ 1 đợt, 24 ⇒ 2, 36 ⇒ 3).
 *
 * Cách đếm: đợt 1 đến hạn ngay ngày hiệu lực, sau đó **mỗi mốc kỷ niệm năm còn
 * nằm TRONG thời hạn là thêm một đợt**. Đếm bằng mốc kỷ niệm thay vì chia số
 * tháng cho 12 để khỏi phải xử lý các ca lẻ ngày/tháng: hợp đồng 01/01/26 →
 * 31/12/26 ra đúng 1 đợt, còn 01/01/26 → 30/06/27 (18 tháng) ra 2 đợt.
 *
 * Tiền chia đều, **phần lẻ dồn vào đợt cuối** để tổng luôn khớp tuyệt đối giá
 * trị hợp đồng — không đẻ ra lệch làm tròn.
 *
 * Kết quả chỉ là BẢN NHÁP: form vẫn cho sửa tay từng dòng, vì hợp đồng thật hay
 * có điều khoản riêng ("đợt 1 thu 30% ngay khi ký").
 */
export function buildSchedule(
  effectiveFrom: string,
  effectiveTo: string,
  valueTotal: number,
): ScheduleRow[] {
  const from = dayOf(effectiveFrom);
  const to = dayOf(effectiveTo);
  if (!from) return [];

  let n = 1;
  if (to) {
    while (n < 50 && addYears(from, n) < to) n++;
  }

  const total = Math.round(valueTotal || 0);
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    due_date: addYears(from, i),
    amount_due: i === n - 1 ? total - base * (n - 1) : base,
  }));
}

/* ------------------------------------------------------ Trạng thái thu tiền */

/**
 * Trạng thái một đợt — **TÍNH TẠI CHỖ, KHÔNG LƯU DB**.
 *
 * Lưu vào DB thì phải có ai đó chạy định kỳ cập nhật, không có thì sai vĩnh
 * viễn: đã thấy đúng cái bẫy này trong `morghim/contract-payment` — schema có
 * cờ `is_late` nhưng không dòng code nào set, cờ nằm chết ở 0.
 */
export function paymentStatus(
  p: PaymentLike,
  today: string = todayStr(),
  soonDays: number = SOON_DAYS,
): PaymentStatus {
  const due = dayOf(p.due_date);
  const paid = dayOf(p.paid_date);
  const amountPaid = p.amount_paid || 0;

  if (paid || amountPaid > 0) {
    return amountPaid >= (p.amount_due || 0) ? 'da_thu' : 'thu_thieu';
  }
  if (due && due < today) return 'qua_han';
  if (due && daysBetween(today, due) <= soonDays) return 'sap_den_han';
  return 'chua_den_han';
}

/** Số tiền còn phải thu của một đợt. */
export function remainingOf(p: PaymentLike): number {
  return Math.max(0, (p.amount_due || 0) - (p.amount_paid || 0));
}

/** Số ngày quá hạn (0 nếu chưa quá hạn). */
export function overdueDays(p: PaymentLike, today: string = todayStr()): number {
  if (paymentStatus(p, today) !== 'qua_han') return 0;
  return daysBetween(dayOf(p.due_date), today);
}

/* -------------------------------------------------- Phân bổ tiền thu vào đợt */

export interface AllocationChange {
  id?: string;
  seq: number;
  amount_paid: number;
  paid_date: string;
}

export interface AllocationResult {
  changes: AllocationChange[];
  /** Tiền thừa sau khi đã trả hết mọi đợt — phải hiện cho người nhập biết. */
  leftover: number;
}

/**
 * Rải một khoản tiền thu vào các đợt chưa thu đủ, **theo thứ tự đợt**.
 *
 * Nghiệp vụ thật: khách chuyển một cục cho nhiều đợt. Ba nhánh:
 *  - tiền ≥ phần còn thiếu của đợt → đóng đợt đó, mang phần dư sang đợt kế;
 *  - tiền < phần còn thiếu → cộng vào đợt đó (thành "thu thiếu"), dừng;
 *  - đợt vốn đã thu thiếu → tính trên **phần còn lại** và **cộng dồn** vào số đã
 *    thu cũ, không ghi đè.
 *
 * (Mô hình lấy từ `morghim/contract-payment` — đọc logic, viết lại bằng TS; repo
 * đó không có giấy phép nên không chép code.)
 */
export function allocatePayment(
  payments: PaymentLike[],
  amount: number,
  paidDate: string = todayStr(),
): AllocationResult {
  const changes: AllocationChange[] = [];
  let left = Math.round(amount || 0);

  const queue = [...payments].sort((a, b) => a.seq - b.seq);
  for (const p of queue) {
    if (left <= 0) break;
    const remaining = remainingOf(p);
    if (remaining <= 0) continue;

    const pay = Math.min(left, remaining);
    left -= pay;
    changes.push({
      id: p.id,
      seq: p.seq,
      amount_paid: (p.amount_paid || 0) + pay,
      paid_date: dayOf(paidDate),
    });
  }

  return { changes, leftover: left };
}

/* ------------------------------------------------------------- Tổng hợp KPI */

export interface ContractTotals {
  valueTotal: number;
  paid: number;
  remaining: number;
  overdueCount: number;
  overdueAmount: number;
  dueSoonCount: number;
  dueSoonAmount: number;
}

export function summarize(
  payments: PaymentLike[],
  today: string = todayStr(),
): ContractTotals {
  const t: ContractTotals = {
    valueTotal: 0, paid: 0, remaining: 0,
    overdueCount: 0, overdueAmount: 0, dueSoonCount: 0, dueSoonAmount: 0,
  };
  for (const p of payments) {
    t.valueTotal += p.amount_due || 0;
    t.paid += p.amount_paid || 0;
    const st = paymentStatus(p, today);
    if (st === 'qua_han') { t.overdueCount++; t.overdueAmount += remainingOf(p); }
    if (st === 'sap_den_han') { t.dueSoonCount++; t.dueSoonAmount += remainingOf(p); }
  }
  t.remaining = Math.max(0, t.valueTotal - t.paid);
  return t;
}

/* ----------------------------------------------------------- Kiểm tra nhập */

/** Lệch cho phép giữa Σ đợt và giá trị hợp đồng — hợp đồng thật hay làm tròn. */
export const TOLERANCE_VND = 1000;

/**
 * Cảnh báo mềm, KHÔNG chặn lưu: trả về chuỗi mô tả nếu lệch quá ngưỡng.
 * (Cố ý khác `morghim/contract-payment` — họ chặn cứng bằng exception.)
 */
export function scheduleWarning(payments: PaymentLike[], valueTotal: number): string {
  const sum = payments.reduce((s, p) => s + (p.amount_due || 0), 0);
  const diff = Math.round(sum - (valueTotal || 0));
  if (Math.abs(diff) <= TOLERANCE_VND) return '';
  const fmt = (n: number) => n.toLocaleString('vi-VN');
  return diff > 0
    ? `Tổng các đợt (${fmt(sum)}đ) LỚN HƠN giá trị hợp đồng ${fmt(diff)}đ.`
    : `Tổng các đợt (${fmt(sum)}đ) THIẾU ${fmt(-diff)}đ so với giá trị hợp đồng.`;
}

/** Đợt đã ghi nhận thu tiền thì khoá sửa ngày/số tiền — không sửa hồi tố. */
export function isLocked(p: PaymentLike): boolean {
  return Boolean(dayOf(p.paid_date)) || (p.amount_paid || 0) > 0;
}

/** Tính VAT — form gọi hàm này, không cho gõ tay hai ô dẫn xuất. */
export function computeVat(valueBeforeVat: number, vatRate: number) {
  const before = Math.round(valueBeforeVat || 0);
  const vat = Math.round((before * (vatRate || 0)) / 100);
  return { value_vat: vat, value_total: before + vat };
}

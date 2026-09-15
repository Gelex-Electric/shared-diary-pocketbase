/**
 * Tên khách hàng viết thường (`dm_customer.low_name`) — sinh và SOÁT.
 *
 * Vì sao có cột này: `name` được nhập viết HOA theo hóa đơn ("CÔNG TY TNHH …"),
 * nhưng nhiều chỗ cần bản viết thường để lọc/tìm phía server — PocketBase
 * không có hàm `lower()` trong biểu thức filter, nên phải lưu sẵn thành cột.
 *
 * Cột lưu sẵn thì sẽ LỆCH theo thời gian (sửa `name` mà quên sửa `low_name`,
 * hoặc gõ tay thiếu chữ). `checkLowName` là bộ soát cho đúng việc đó.
 *
 * File thuần logic, KHÔNG import React và KHÔNG gọi PocketBase — để còn dùng
 * lại được từ script Node lẫn từ component.
 */
import type { Customer } from './types';

/**
 * Bản viết thường CHUẨN của một tên.
 *
 * Chỉ hạ hoa→thường, GIỮ NGUYÊN dấu tiếng Việt và khoảng trắng bên trong.
 * Không bỏ dấu (đã có `short_name` lo việc đó), không gộp space — vì soát phải
 * phát hiện được chênh lệch khoảng trắng chứ không âm thầm sửa nó.
 */
export const toLowName = (name: string): string => (name ?? '').toLowerCase();

/** Lý do một bản ghi bị coi là lệch. `ok` = khớp tuyệt đối. */
export type LowNameIssue = 'ok' | 'missing' | 'case' | 'chars' | 'space';

export const ISSUE_LABEL: Record<LowNameIssue, string> = {
  ok:      'Khớp',
  missing: 'Chưa có tên viết thường',
  case:    'Còn sót chữ hoa',
  chars:   'Khác ký tự',
  space:   'Khác khoảng trắng',
};

export interface LowNameCheck {
  issue: LowNameIssue;
  /** Giá trị đang lưu (rỗng nếu chưa có). */
  current: string;
  /** Giá trị đề nghị ghi đè. */
  expected: string;
  /** Mô tả chi tiết cho người đọc — vd "23 ký tự / 25 ký tự". */
  detail: string;
}

/** Bỏ mọi khoảng trắng, để tách "chỉ khác space" ra khỏi "khác chữ". */
const squeeze = (s: string) => s.replace(/\s+/g, '');

/**
 * Soát một khách hàng.
 *
 * Thứ tự phân loại có chủ ý — từ nặng đến nhẹ, mỗi bản ghi chỉ mang MỘT nhãn:
 * thiếu hẳn → khác chữ → khác khoảng trắng → còn sót hoa. Khác chữ đứng trước
 * vì nó là lỗi phải người đọc quyết, còn sót hoa thì sửa máy móc được.
 */
export function checkLowName(c: Pick<Customer, 'name' | 'low_name'>): LowNameCheck {
  const name = c.name ?? '';
  const current = c.low_name ?? '';
  const expected = toLowName(name);
  const base: Omit<LowNameCheck, 'issue' | 'detail'> = { current, expected };

  if (!current.trim()) {
    return { ...base, issue: 'missing', detail: `Cần điền "${expected}"` };
  }
  if (current === expected) {
    return { ...base, issue: 'ok', detail: '' };
  }

  const cLow = current.toLowerCase();
  // So sau khi đã hạ hoa cả hai vế: còn khác nữa nghĩa là khác CHỮ thật.
  if (squeeze(cLow) !== squeeze(expected)) {
    const n1 = squeeze(cLow).length;
    const n2 = squeeze(expected).length;
    const detail = n1 === n2
      ? `Sai chữ hoặc sai dấu (cùng ${n1} ký tự)`
      : `${n1} ký tự so với ${n2} ký tự ở tên gốc (${n1 > n2 ? 'thừa' : 'thiếu'} ${Math.abs(n1 - n2)})`;
    return { ...base, issue: 'chars', detail };
  }
  if (cLow !== expected) {
    return { ...base, issue: 'space', detail: 'Chỉ khác khoảng trắng' };
  }
  // Tới đây: giống hệt sau khi hạ hoa ⇒ khác biệt duy nhất là chữ hoa còn sót.
  return { ...base, issue: 'case', detail: 'Hạ chữ hoa còn sót là khớp' };
}

export interface LowNameRow extends LowNameCheck {
  id: string;
  mkh: string;
  name: string;
}

/** Soát cả danh sách, trả về CHỈ các bản ghi lệch, nặng trước nhẹ sau. */
export function planLowNameFix(customers: Customer[]): LowNameRow[] {
  const order: LowNameIssue[] = ['chars', 'missing', 'space', 'case', 'ok'];
  return customers
    .map(c => ({ id: c.id, mkh: c.mkh, name: c.name ?? '', ...checkLowName(c) }))
    .filter(r => r.issue !== 'ok')
    .sort((a, b) => order.indexOf(a.issue) - order.indexOf(b.issue) || a.mkh.localeCompare(b.mkh));
}

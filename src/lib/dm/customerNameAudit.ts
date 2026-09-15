/**
 * Rà soát TÊN khách hàng — module THUẦN, không React, không gọi PocketBase.
 *
 * Hai cột tên được soát:
 *   `name`      tên đầy đủ viết hoa, phải khớp hóa đơn MỚI NHẤT (nguồn chuẩn)
 *   `low_name`  bản viết thường của `name`, để lọc/tìm phía PocketBase
 *
 * Hai cột này lệch nhau theo thời gian vì tên công ty đổi thật (sáp nhập, đổi
 * loại hình, bỏ đuôi chi nhánh — xem `customerSync.ts`): hóa đơn kỳ mới mang
 * tên mới, còn `low_name` thì nằm im theo tên cũ.
 *
 * ⚠️ KHÔNG soát `short_name` (tên tắt) ở đây — user chốt 15/09/2026. Tên tắt do
 * người dùng tự đặt và đã dùng để sinh mã trạm rồi, nên nó "không giống tên"
 * không phải là lỗi. Luật cũ hay báo nhầm nên đã bỏ.
 *
 * Toàn bộ module CHỈ ĐỌC, đúng tinh thần tab "Rà soát".
 */
import { checkLowName } from './lowName';
import type { Customer } from './types';
import type { LatestCustomer } from './customerSync';

/** Một chỗ lệch của một khách hàng. Mỗi khách có thể có nhiều chỗ. */
export type NameIssueKind =
  | 'invoice'   // `name` khác hóa đơn mới nhất
  | 'low';      // `low_name` lệch `name`

export const NAME_ISSUE_LABEL: Record<NameIssueKind, string> = {
  invoice: 'Tên lệch hóa đơn mới nhất',
  low:     'Tên viết thường lệch',
};

export interface NameIssue {
  kind: NameIssueKind;
  /** Giá trị đang lưu trong danh mục. */
  current: string;
  /** Giá trị đối chiếu (hóa đơn / suy từ tên). */
  expected: string;
  detail: string;
}

export interface CustomerNameAudit {
  id: string;
  mkh: string;
  name: string;
  /** Ngày chốt của hóa đơn đã lấy để đối chiếu; rỗng nếu khách chưa có hóa đơn. */
  asOf: string;
  issues: NameIssue[];
}

/**
 * Soát toàn bộ danh mục khách hàng.
 *
 * `latest` là kết quả `latestByMkh()` — mỗi mã khách một dòng theo hóa đơn có
 * `EndDate` lớn nhất. Khách chưa có hóa đơn nào thì BỎ QUA phép so hóa đơn
 * (không có gì để so), nhưng vẫn soát tên viết thường.
 *
 * Trả về CHỈ khách hàng có ít nhất một chỗ lệch.
 */
export function auditCustomerNames(
  customers: Customer[],
  latest: LatestCustomer[],
): CustomerNameAudit[] {
  const latestByMkh = new Map(latest.map(l => [l.mkh, l]));

  return customers
    .map(c => {
      const name = c.name ?? '';
      const inv = latestByMkh.get(c.mkh);
      const issues: NameIssue[] = [];

      // 1. Tên đầy đủ so với hóa đơn mới nhất. Hóa đơn để trống tên thì bỏ qua,
      //    không coi khoảng trắng là "tên mới".
      if (inv?.name && inv.name !== name) {
        issues.push({
          kind: 'invoice', current: name, expected: inv.name,
          detail: `Hóa đơn chốt ngày ${inv.asOf} ghi tên khác`,
        });
      }

      // 2. Tên viết thường — dùng lại đúng bộ soát của tab Khách hàng, không
      //    chép luật sang đây.
      const low = checkLowName(c);
      if (low.issue !== 'ok') {
        issues.push({
          kind: 'low', current: low.current, expected: low.expected,
          detail: low.detail,
        });
      }

      return { id: c.id, mkh: c.mkh, name, asOf: inv?.asOf ?? '', issues };
    })
    .filter(r => r.issues.length > 0)
    .sort((a, b) => a.mkh.localeCompare(b.mkh, 'vi', { numeric: true }));
}

/** Tổng số chỗ lệch (một khách có thể góp nhiều chỗ) — để đếm trên thẻ. */
export const countNameIssues = (rows: CustomerNameAudit[]): number =>
  rows.reduce((n, r) => n + r.issues.length, 0);

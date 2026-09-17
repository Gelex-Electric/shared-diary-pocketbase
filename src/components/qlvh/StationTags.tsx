/**
 * Nhãn các TRẠM một hợp đồng nhận quản lý vận hành.
 *
 * Dùng chung cho màn Tổng hợp và màn Danh sách hợp đồng để hai nơi hiện giống
 * hệt nhau — trước đây chip trạm viết thẳng trong ContractListManager, thêm chỗ
 * thứ hai là bắt đầu lệch nhau.
 *
 * Màu: cố ý TRUNG TÍNH (xám), không tô màu theo KCN. Nhãn KCN (`ZoneTag`) đã
 * mang màu rồi; hai cụm màu cạnh nhau trên cùng một dòng thì không cụm nào nổi.
 */

import { Factory } from 'lucide-react';

export function StationTags({ codes, max = 2 }: {
  codes: string[];
  /** Hiện tối đa ngần này mã rồi gộp phần dư thành "＋N" — hợp đồng nhiều trạm
   *  sẽ đội dòng lên nhiều hàng và phá bố cục bảng. */
  max?: number;
}) {
  if (codes.length === 0) return null;
  const shown = codes.slice(0, max);
  const rest = codes.length - shown.length;
  return (
    <span className="inline-flex items-center gap-1 align-middle" title={codes.join(', ')}>
      <Factory className="w-3.5 h-3.5 text-faint shrink-0" />
      {shown.map(code => (
        <span key={code}
          className="font-mono text-[11px] font-bold text-soft bg-subtle px-1.5 py-0.5 rounded whitespace-nowrap">
          {code}
        </span>
      ))}
      {rest > 0 && <span className="text-[11px] text-faint">＋{rest}</span>}
    </span>
  );
}

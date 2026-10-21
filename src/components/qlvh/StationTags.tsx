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

export function StationTags({ codes, max = 2, countOnly = false }: {
  codes: string[];
  /** Hiện tối đa ngần này mã rồi gộp phần dư thành "＋N" — hợp đồng nhiều trạm
   *  sẽ đội dòng lên nhiều hàng và phá bố cục bảng. */
  max?: number;
  /**
   * Chỉ hiện SỐ LƯỢNG ("5 trạm QLVH") thay vì liệt kê mã (user chốt 21/10/2026).
   *
   * Dùng ở thẻ khách hàng lúc thu gọn: một khách có thể gom nhiều hợp đồng với
   * cả chục trạm, liệt kê mã ra làm dòng tiêu đề dài loằng ngoằng mà chẳng ai
   * đọc hết. Mở thẻ ra thì từng hợp đồng vẫn hiện mã trạm cụ thể.
   * Danh sách đầy đủ vẫn còn ở `title` khi rê chuột.
   */
  countOnly?: boolean;
}) {
  if (codes.length === 0) return null;

  if (countOnly) {
    return (
      <span className="inline-flex items-center gap-1 align-middle" title={codes.join(', ')}>
        <Factory className="w-3.5 h-3.5 text-faint shrink-0" />
        <span className="text-[11px] font-bold text-soft bg-subtle px-1.5 py-0.5 rounded whitespace-nowrap">
          {codes.length} trạm QLVH
        </span>
      </span>
    );
  }

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

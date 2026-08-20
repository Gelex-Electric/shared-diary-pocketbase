/**
 * Dòng tiêu đề nhóm KCN trong bảng danh mục.
 *
 * Khuôn lấy nguyên từ bảng lấy chỉ số HES (`HesManualSectionCards.tsx`): một
 * `<tr>` nền màu nhạt trải hết bề ngang, chấm tròn màu KCN, tên KCN kèm số
 * lượng bản ghi. Màu do `kcnColorOf()` cấp — cùng bảng màu với các màn khác nên
 * KCN Tiền Hải ở đâu cũng xanh dương.
 */
import { kcnColorOf } from '../../lib/kcnColors';
import type { Zone } from '../../lib/dm/types';

export function ZoneGroupRow({ zone, count, unit, colSpan }: {
  /** `null` = nhóm bản ghi chưa gắn KCN nào. */
  zone: Zone | null;
  count: number;
  /** Danh từ đếm được: "trạm", "khách hàng", "điểm đo". */
  unit: string;
  colSpan: number;
}) {
  const c = kcnColorOf(zone?.name);

  return (
    <tr className={c.bg}>
      <td colSpan={colSpan} className={`px-6 py-2 pl-10 text-[11px] font-bold ${c.text}`}>
        <span className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${c.dot}`} />
        {zone ? `${zone.name} (${zone.code})` : 'Chưa gắn khu công nghiệp'}
        <span className="ml-2 font-semibold opacity-70">· {count} {unit}</span>
      </td>
    </tr>
  );
}

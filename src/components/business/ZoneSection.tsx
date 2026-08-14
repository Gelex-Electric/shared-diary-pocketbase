import type { ReactNode } from 'react';
import { kcnColorOf } from '../../lib/kcnColors';

/**
 * Một section của khối Văn phòng: thanh tiêu đề mang màu riêng của KCN
 * (chấm tròn + tên + số lượng) rồi tới nội dung.
 *
 * Dùng cho các màn hình `scope='vanphong'` chia dữ liệu theo từng KCN.
 * Màu lấy từ `lib/kcnColors` — không hard-code màu tại nơi gọi.
 */
export function ZoneSection({
  area, count, countLabel, children,
}: {
  /** Tên KCN, đồng thời là khoá tra màu. */
  area: string;
  count: number;
  /** Danh từ đếm, ví dụ 'khách hàng' hoặc 'công tơ'. */
  countLabel: string;
  children: ReactNode;
}) {
  const c = kcnColorOf(area);
  return (
    <section>
      <div className={`flex items-center gap-2.5 mb-3 px-3 py-2 rounded-lg border ${c.bg} ${c.border}`}>
        <span className={`w-3 h-3 rounded-full ${c.dot}`} />
        <h3 className={`text-sm font-bold ${c.text}`}>{area}</h3>
        <span className="text-xs font-semibold text-soft">· {count} {countLabel}</span>
      </div>
      {children}
    </section>
  );
}

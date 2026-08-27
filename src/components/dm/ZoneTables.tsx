/**
 * Bảng danh mục chia theo Khu công nghiệp — khuôn lấy nguyên từ màn
 * "Công nợ khách hàng" (`business/CustomerDebtManager.tsx`).
 *
 * Vì sao đổi khuôn: trước đây cả danh mục nằm trong MỘT bảng, các KCN chỉ ngăn
 * nhau bằng một dòng tiêu đề nhạt (`ZoneGroupRow`). Danh mục lớn dần (93 trạm,
 * ~100 khách hàng) nên cuộn mãi không thấy đầu bảng. Màn Công nợ đã giải đúng
 * bài này: MỖI KCN MỘT THẺ riêng, có đầu thẻ màu bấm đóng/mở được, bảng nằm
 * trong thẻ nên hàng tiêu đề luôn ở ngay trên dữ liệu của chính KCN đó.
 *
 * Thêm PHÂN TRANG 50 bản ghi/trang cho từng thẻ (user chốt 22/08/2026) — thanh
 * phân trang ghép từ `vl-btn` sẵn có, không tự vẽ kiểu nút mới.
 *
 * MÀU ĐẦU THẺ: dùng `--accent` cho MỌI KCN, giống hệt màn Công nợ (user chốt
 * 22/08/2026). Bản đầu tô mỗi KCN một màu theo `kcnColorOf()`, nhưng đây là
 * danh mục — tên KCN đã ghi rõ trên đầu thẻ, thêm màu chỉ làm màn hình rối.
 */
import { Fragment, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Building2, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Zone } from '../../lib/dm/types';

/**
 * Nền đầu thẻ — chép nguyên từ `CustomerDebtManager` để hai màn không lệch nhau.
 * Một màu accent cho mọi KCN, không phân màu theo KCN.
 */
const ZONE_HEADER_GRADIENT = 'from-[var(--accent)] to-[var(--accent)]';

/** Số bản ghi mỗi trang. Đếm theo TỪNG thẻ KCN, không đếm chung toàn danh mục. */
export const PAGE_SIZE = 50;

export interface ZoneGroup<T> {
  /** `null` = nhóm bản ghi chưa gắn KCN nào. */
  zone: Zone | null;
  rows: T[];
}

/** Thanh phân trang — chỉ hiện khi nhóm có nhiều hơn một trang. */
function Pager({ page, pages, total, unit, onGo }: {
  page: number; pages: number; total: number; unit: string; onGo: (p: number) => void;
}) {
  if (pages <= 1) return null;

  // Cửa sổ tối đa 5 số quanh trang hiện tại: danh mục có thể lên hàng chục
  // trang, in hết số ra thì thanh phân trang dài hơn cả bảng.
  const from = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => from + i);

  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-[var(--border)] px-6 py-3 sm:flex-row">
      <span className="text-[11px] font-semibold text-faint">
        {first}–{last} trên {total} {unit}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" className="vl-btn vl-btn-secondary vl-btn-sm"
          disabled={page === 1} onClick={() => onGo(page - 1)} aria-label="Trang trước">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {nums.map(n => (
          <button key={n} type="button" aria-current={n === page ? 'page' : undefined}
            className={`vl-btn vl-btn-sm ${n === page ? 'vl-btn-primary' : 'vl-btn-secondary'}`}
            onClick={() => onGo(n)}>
            {n}
          </button>
        ))}
        <button type="button" className="vl-btn vl-btn-secondary vl-btn-sm"
          disabled={page === pages} onClick={() => onGo(page + 1)} aria-label="Trang sau">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ZoneTables<T>({
  groups, unit, columns, renderRow, rowKey, loading, empty, minWidth = 900,
}: {
  groups: ZoneGroup<T>[];
  /** Danh từ đếm được: "trạm", "khách hàng", "điểm đo". */
  unit: string;
  /** Các `<th>` của bảng — dùng chung cho mọi thẻ KCN. */
  columns: ReactNode;
  renderRow: (row: T) => ReactNode;
  /** Khoá React của một dòng — dòng điểm đo là object bọc nên không có sẵn `id`. */
  rowKey: (row: T) => string;
  loading: boolean;
  empty: string;
  /** Bề ngang tối thiểu của bảng trước khi cho cuộn ngang. */
  minWidth?: number;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pages, setPages] = useState<Record<string, number>>({});
  const keyOf = (g: ZoneGroup<T>) => g.zone?.id ?? '__no_zone';

  if (loading) {
    return (
      <div className="vl-card px-6 py-12 text-center text-faint">
        <div className="flex items-center justify-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span>Đang tải danh sách...</span>
        </div>
      </div>
    );
  }
  if (!groups.length) {
    return <div className="vl-card px-6 py-12 text-center italic text-faint">{empty}</div>;
  }

  return (
    <div className="space-y-5">
      {groups.map(g => {
        const key = keyOf(g);
        const total = g.rows.length;
        const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
        // Kẹp lại phòng khi xóa bản ghi làm hụt số trang mà state còn trang cũ.
        const page = Math.min(pages[key] ?? 1, pageCount);
        const shown = g.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        const isOpen = !collapsed[key];

        return (
          <div key={key} className="vl-card overflow-hidden">
            {/* Đầu thẻ: nền màu của chính KCN đó, bấm để đóng/mở. */}
            <div
              onClick={() => setCollapsed(s => ({ ...s, [key]: !s[key] }))}
              className={`flex cursor-pointer select-none items-center justify-between gap-3
                bg-gradient-to-r ${ZONE_HEADER_GRADIENT} px-5 py-4 text-white md:px-7`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="shrink-0 rounded-xl bg-surface/20 p-2">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-black leading-tight tracking-tight">
                    {g.zone ? g.zone.name : 'Chưa gắn khu công nghiệp'}
                  </h3>
                  <p className="text-[11px] font-semibold text-white/80">
                    {g.zone ? `${g.zone.code} · ` : ''}{total} {unit}
                    {pageCount > 1 && ` · ${pageCount} trang`}
                  </p>
                </div>
              </div>
              <ChevronDown className={`h-5 w-5 shrink-0 text-white transition-transform duration-200
                ${isOpen ? '' : '-rotate-90'}`} />
            </div>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="overflow-x-auto">
                    <table className="vl-table w-full table-fixed border-collapse text-left"
                      style={{ minWidth }}>
                      <thead>
                        <tr className="border-b border-[var(--border)]">{columns}</tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {shown.map(r => <Fragment key={rowKey(r)}>{renderRow(r)}</Fragment>)}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={page} pages={pageCount} total={total} unit={unit}
                    onGo={p => setPages(s => ({ ...s, [key]: p }))} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

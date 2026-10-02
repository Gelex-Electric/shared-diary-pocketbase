import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2 } from 'lucide-react';

/**
 * Lớp phủ chờ toàn trang (user duyệt 02/10/2026 — bộ UI chung chưa có).
 *
 * Dùng khi một thao tác mất vài giây mà người dùng KHÔNG nên bấm gì khác trong lúc chờ,
 * ví dụ tải PDF giấy báo / hóa đơn từ CCIS. Chặn bấm xuyên qua; tự ẩn khi `open = false`.
 * Render qua portal vào `document.body` để không bị khung cuộn / overflow của màn cha cắt.
 */
export function LoadingOverlay({ open, title, hint }: {
  open: boolean;
  /** Dòng chính, ví dụ "Đang tải giấy báo từ CCIS…". */
  title: string;
  /** Dòng phụ (tùy chọn), ví dụ số hóa đơn đang tải. */
  hint?: string;
}) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="loading-overlay"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
          role="alertdialog" aria-busy="true" aria-live="assertive" aria-label={title}
        >
          <div className="vl-card flex min-w-[260px] max-w-sm flex-col items-center gap-3 px-8 py-7 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <p className="text-sm font-bold text-ink">{title}</p>
            {hint && <p className="text-xs text-soft">{hint}</p>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

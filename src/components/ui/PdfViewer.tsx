import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Download, ExternalLink, FileText, X } from 'lucide-react';

/**
 * Hộp xem PDF ngay trong app (user duyệt 02/10/2026 — bộ UI chung chưa có).
 *
 * Nhận file PDF đã tải sẵn (Blob) — hiển thị bằng trình xem PDF có sẵn của trình duyệt trong
 * iframe. Nút: Tải về (đặt đúng tên file), Mở tab mới (mở ngay trong cú bấm nên không bị chặn
 * popup), Đóng (hoặc Esc / bấm nền). Object URL tạo khi mở, thu hồi khi đóng.
 * Render qua portal để không bị khung cuộn của màn cha cắt.
 */
export function PdfViewer({ file, title, onClose }: {
  /** `null` = đóng. */
  file: { blob: Blob; fileName: string } | null;
  title: string;
  onClose: () => void;
}) {
  const url = useMemo(() => (file ? URL.createObjectURL(file.blob) : ''), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, onClose]);

  return createPortal(
    <AnimatePresence>
      {file && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-6">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}
            transition={{ duration: 0.18 }}
            role="dialog" aria-modal="true" aria-label={title}
            className="relative flex h-full max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl"
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-subtle/60 px-4 py-3 md:px-5">
              <div className="rounded-xl bg-accent-soft p-2 text-accent"><FileText className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-black text-ink">{title}</h3>
                <p className="truncate text-[11px] text-faint">{file.fileName}</p>
              </div>
              <a href={url} download={file.fileName} className="vl-btn vl-btn-secondary flex items-center gap-1.5 text-sm">
                <Download className="h-4 w-4" /> <span className="hidden sm:inline">Tải về</span>
              </a>
              <a href={url} target="_blank" rel="noopener noreferrer" className="vl-btn vl-btn-secondary flex items-center gap-1.5 text-sm">
                <ExternalLink className="h-4 w-4" /> <span className="hidden sm:inline">Tab mới</span>
              </a>
              <button onClick={onClose} title="Đóng (Esc)" className="rounded-lg p-2 text-faint transition-colors hover:bg-subtle hover:text-dim">
                <X className="h-5 w-5" />
              </button>
            </div>
            <iframe src={url} title={title} className="min-h-0 w-full flex-1 bg-subtle" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

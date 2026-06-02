import React, { useState, useLayoutEffect, useEffect, useCallback } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

interface CalloutDef {
  targetId: string;
  badge: string;
  title: string;
  desc: string;
}

// Các mục có vị trí rõ ràng trong sidebar — sẽ có mũi tên chỉ đến
const CALLOUTS: CalloutDef[] = [
  {
    targetId: 'nav-journal',
    badge: '1',
    title: 'Đổi tên → "Hồ sơ vận hành"',
    desc: 'Trước đây là "Sổ nhật ký điện tử"',
  },
  {
    targetId: 'nav-journal-sub',
    badge: '2',
    title: 'Gộp 2 mục — nay có 2 tab',
    desc: '"Tạo lịch trực" & "Quản lý nhân sự" nay trong cùng 1 trang với 2 tab',
  },
  {
    targetId: 'nav-operating-sub',
    badge: '3',
    title: 'Tab "Lấy chỉ số HES" mới',
    desc: '"Lấy chỉ số từ HES" đã chuyển vào tab thứ 3 của Thông tin chung',
  },
];

// Các thay đổi không có vị trí sidebar cụ thể
const OTHER_CHANGES = [
  'Thông báo hệ thống nay nổi (floating) ở góc trên phải',
  'Sửa lỗi bộ lọc bảng công nợ — không còn sao chép dòng',
  'Hỗ trợ lưu nhiều email cho mỗi khách hàng',
];

interface Props {
  onDismiss: () => void; // đóng + lưu PocketBase (không hiện lại)
  onClose: () => void;   // đóng phiên này (refresh vẫn hiện lại)
}

export default function NewUpdateTour({ onDismiss, onClose }: Props) {
  const [rects, setRects] = useState<Record<string, DOMRect | null>>({});
  const [checked, setChecked] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  const measure = useCallback(() => {
    const result: Record<string, DOMRect | null> = {};
    CALLOUTS.forEach(c => {
      const el = document.getElementById(c.targetId);
      result[c.targetId] = el?.getBoundingClientRect() ?? null;
    });
    setRects(result);
    setIsDesktop(window.innerWidth >= 1024);
  }, []);

  // Delay để sidebar expand animation kịp hoàn thành trước khi đo
  useLayoutEffect(() => {
    const t = setTimeout(measure, 420);
    return () => clearTimeout(t);
  }, [measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // Click bất kỳ đâu luôn đóng overlay.
  // Nếu đã tích → gọi onDismiss (lưu PocketBase, không hiện lại).
  // Nếu chưa tích → gọi onClose (chỉ đóng phiên, refresh vẫn hiện lại).
  const handleOverlayClick = () => {
    if (checked) onDismiss();
    else onClose();
  };

  return (
    <motion.div
      className="fixed inset-0 z-[150]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={handleOverlayClick}
    >
      {/* Overlay nền */}
      <div className="absolute inset-0 bg-slate-900/55" />

      {isDesktop ? (
        <>
          {CALLOUTS.map((c, idx) => {
            const rect = rects[c.targetId];
            if (!rect || rect.width === 0) return null;

            return (
              <React.Fragment key={c.targetId}>
                {/* Vòng highlight bao quanh phần tử */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.08 + 0.15 }}
                  style={{
                    position: 'fixed',
                    top: rect.top - 3,
                    left: rect.left - 3,
                    width: rect.width + 6,
                    height: rect.height + 6,
                  }}
                  className="rounded-xl ring-2 ring-blue-400 bg-blue-400/20 pointer-events-none"
                />

                {/* Callout bubble bên phải sidebar */}
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.08 + 0.25, type: 'spring', stiffness: 280, damping: 22 }}
                  style={{
                    position: 'fixed',
                    top: rect.top + rect.height / 2,
                    left: rect.right + 20,
                    transform: 'translateY(-50%)',
                    maxWidth: 230,
                    minWidth: 200,
                  }}
                  className="bg-white rounded-2xl shadow-2xl border border-blue-100 px-4 py-3 pointer-events-none"
                >
                  {/* Mũi tên CSS chỉ về phía trái (sang sidebar) */}
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: -9,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 0,
                      height: 0,
                      borderTop: '7px solid transparent',
                      borderBottom: '7px solid transparent',
                      borderRight: '9px solid #bfdbfe',
                    }}
                  />
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: -7,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 0,
                      height: 0,
                      borderTop: '6px solid transparent',
                      borderBottom: '6px solid transparent',
                      borderRight: '8px solid white',
                    }}
                  />

                  <div className="flex items-start gap-2.5">
                    <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-black flex items-center justify-center">
                      {c.badge}
                    </span>
                    <div>
                      <p className="text-[12px] font-extrabold text-slate-800 leading-snug">{c.title}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{c.desc}</p>
                    </div>
                  </div>
                </motion.div>
              </React.Fragment>
            );
          })}

          {/* Card "Thay đổi khác" — không có mũi tên chỉ vị trí cụ thể */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
            style={{ position: 'fixed', left: 344, bottom: 110 }}
            className="bg-white/90 rounded-2xl border border-slate-100 shadow-xl px-4 py-3 w-56 pointer-events-none"
          >
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Thay đổi khác</p>
            <ul className="space-y-1.5">
              {OTHER_CHANGES.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-600 leading-snug">
                  <span className="shrink-0 mt-1 w-1 h-1 rounded-full bg-blue-400" />
                  {f}
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Nút tích xác nhận — desktop */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="fixed bottom-7 left-1/2 z-[160] flex flex-col items-center gap-2"
            style={{ transform: 'translateX(-50%)' }}
            onClick={e => e.stopPropagation()}
          >
            <p className="text-white/70 text-xs font-semibold select-none">
              Nhấn bất kỳ đâu để đóng
            </p>

            <button
              onClick={() => setChecked(v => !v)}
              className={`flex items-center gap-3 px-6 py-3 rounded-2xl font-bold text-sm transition-all duration-200 shadow-2xl border-2 active:scale-[0.97] ${
                checked
                  ? 'bg-emerald-500 border-emerald-400 text-white shadow-emerald-500/40'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-emerald-300 shadow-slate-900/20'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 ${
                  checked ? 'bg-white border-white' : 'border-slate-300'
                }`}
              >
                {checked && <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={3} />}
              </div>
              {checked ? '✓ Đã tích — nhấn bất kỳ đâu để không hiện lại' : 'Tích để không hiện lại lần sau'}
            </button>
          </motion.div>
        </>
      ) : (
        // Mobile: bottom sheet đơn giản
        <div
          className="absolute inset-x-0 bottom-0 flex justify-center p-4 pb-6"
          onClick={e => e.stopPropagation()}
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl"
          >
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-blue-500" />
              <h3 className="font-black text-slate-800">Cập nhật mới</h3>
            </div>
            <ul className="space-y-2 mb-5">
              {[
                ...CALLOUTS.map(c => `${c.title} — ${c.desc}`),
                ...OTHER_CHANGES,
              ].map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-slate-600 leading-relaxed">
                  <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-blue-400" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-2xl font-bold text-sm bg-slate-100 text-slate-600 active:scale-[0.98] transition-transform"
              >
                Đóng
              </button>
              <button
                onClick={onDismiss}
                className="flex-1 py-3 rounded-2xl font-bold text-sm bg-blue-600 text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Check className="w-4 h-4" strokeWidth={3} />
                Không hiện lại
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}

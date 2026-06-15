import React, { useState } from 'react';
import {
  Check, Sparkles, X, ArrowRight, FileText,
  Palette, Zap, Wrench, Tag, Layers, CloudDownload,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

/** Tab đích để điều hướng khi nhấn "Xem ngay" — khớp với type Tab trong Dashboard */
export type UpdateTab = 'summary' | 'journal' | 'operating' | 'hes' | 'outage' | 'opchart' | 'later';

/** Đường dẫn tài liệu hướng dẫn sử dụng (mở khi đóng thông báo) */
const GUIDE_URL = '/document.pdf';

interface UpdateItem {
  title: string;
  desc?: string;
  tag?: string;
  /** Nếu có, hiển thị nút điều hướng tới trang liên quan */
  link?: { tab: UpdateTab; label: string };
}

// Phiên bản & ngày phát hành hiển thị trên header
const VERSION      = '1.2';
const RELEASE_DATE = '15/06/2026';

const UPDATES: UpdateItem[] = [
  {
    title: 'Đồ thị điện áp & công suất',
    desc: 'Trang mới trong "Thông số vận hành": vẽ điện áp 3 pha (đường) cùng công suất P (cột) theo thời gian thực tế của số liệu đo cho từng trạm.',
    tag: 'Mới',
    link: { tab: 'opchart', label: 'Xem ngay' },
  },
  {
    title: 'Chọn khách hàng & trạm trên 6 biểu đồ',
    desc: 'Mặc định hiển thị 3 khách có P max cao nhất và 3 khách thấp nhất. Khách nhiều điểm đo có thể chọn trạm qua dropdown ngay trên biểu đồ.',
    tag: 'Mới',
    link: { tab: 'opchart', label: 'Thử ngay' },
  },
  {
    title: 'Đánh dấu thời điểm & thời gian mất điện',
    desc: 'Khi điện áp 3 pha về 0, biểu đồ tô vùng "Mất điện" và hiển thị khung giờ kèm thời lượng (ví dụ 02:30–04:00 (1h30p)).',
    tag: 'Mới',
  },
  {
    title: 'Làm nổi bật công suất P lớn nhất',
    desc: 'Cột công suất đạt P max được tô màu nổi bật để dễ nhận biết thời điểm tải đỉnh trong ngày.',
    tag: 'Cải tiến',
  },
  {
    title: 'Đồng bộ giao diện chú giải biểu đồ',
    desc: 'Tooltip các biểu đồ ở trang Tổng hợp được làm lại theo bộ nhận diện chung: nền sáng, viền nhẹ, chữ rõ ràng.',
    tag: 'Giao diện',
    link: { tab: 'summary', label: 'Xem ngay' },
  },
];

/** Màu nền + chữ cho từng nhóm danh mục */
const TAG_STYLE: Record<string, string> = {
  'Mới':      'bg-blue-100 text-blue-700',
  'Đổi tên':  'bg-violet-100 text-violet-700',
  'Giao diện':'bg-indigo-100 text-indigo-700',
  'Cải tiến': 'bg-emerald-100 text-emerald-700',
  'Sửa lỗi':  'bg-rose-100 text-rose-700',
};

/** Icon + màu vòng tròn đại diện cho từng nhóm danh mục */
const TAG_ICON: Record<string, { Icon: React.ElementType; ring: string }> = {
  'Mới':      { Icon: Sparkles,      ring: 'bg-blue-600' },
  'Đổi tên':  { Icon: Tag,           ring: 'bg-violet-600' },
  'Giao diện':{ Icon: Palette,       ring: 'bg-indigo-600' },
  'Cải tiến': { Icon: Zap,           ring: 'bg-emerald-600' },
  'Sửa lỗi':  { Icon: Wrench,        ring: 'bg-rose-600' },
};
const DEFAULT_ICON = { Icon: Layers, ring: 'bg-slate-500' };

interface Props {
  onDismiss: () => void;
  onClose: () => void;
  /** Điều hướng tới một tab khi người dùng nhấn "Xem ngay" trên một mục */
  onNavigate?: (tab: UpdateTab) => void;
}

export default function NewUpdateTour({ onDismiss, onClose, onNavigate }: Props) {
  const [checked, setChecked] = useState(false);

  // Mở tài liệu hướng dẫn sử dụng trong tab mới.
  const openGuide = () => {
    window.open(GUIDE_URL, '_blank', 'noopener,noreferrer');
  };

  // Nhấn "Đóng": LUÔN mở hướng dẫn sử dụng trước, sau đó mới đóng thông báo.
  const handleClose = () => {
    openGuide();
    if (checked) onDismiss();
    else onClose();
  };

  // Nhấn "Xem ngay": điều hướng tới trang liên quan rồi đóng modal.
  // Nếu người dùng đã tích "Không hiển thị lại" thì coi như đã xem xong → dismiss.
  const handleNavigate = (tab: UpdateTab) => {
    onNavigate?.(tab);
    if (checked) onDismiss();
    else onClose();
  };

  const newCount = UPDATES.filter(u => u.tag === 'Mới').length;

  return (
    <motion.div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop — KHÔNG đóng khi nhấn ra ngoài; phải dùng nút/đường dẫn bên trong */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]" />

      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="relative z-10 bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 pt-6 pb-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="text-white font-black text-base leading-tight">Cập nhật mới</h2>
                <p className="text-blue-200 text-xs mt-0.5">Những thay đổi trong phiên bản này</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          {/* Hàng phiên bản + ngày phát hành */}
          <div className="flex items-center gap-2 mt-4">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-white/20 px-2 py-1 rounded-lg">
              <CloudDownload className="w-3 h-3" />
              Phiên bản {VERSION}
            </span>
            <span className="text-[11px] font-medium text-blue-100">
              Phát hành {RELEASE_DATE}
            </span>
            {newCount > 0 && (
              <span className="ml-auto text-[10px] font-bold text-blue-700 bg-white px-2 py-1 rounded-lg">
                {newCount} tính năng mới
              </span>
            )}
          </div>
        </div>

        {/* Update list */}
        <div className="px-6 py-4 space-y-3 max-h-[55vh] overflow-y-auto">
          {UPDATES.map((item, idx) => {
            const { Icon, ring } = item.tag ? (TAG_ICON[item.tag] ?? DEFAULT_ICON) : DEFAULT_ICON;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 + 0.1 }}
                className="flex items-start gap-3"
              >
                {/* Icon nhóm danh mục */}
                <span className={`shrink-0 mt-0.5 w-6 h-6 rounded-lg ${ring} text-white flex items-center justify-center`}>
                  <Icon className="w-3.5 h-3.5" />
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-800 leading-snug">{item.title}</p>
                    {item.tag && (
                      <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${TAG_STYLE[item.tag] ?? 'bg-slate-100 text-slate-600'}`}>
                        {item.tag}
                      </span>
                    )}
                  </div>
                  {item.desc && (
                    <p className="text-xs text-slate-500 mt-0.5 leading-snug">{item.desc}</p>
                  )}

                  {/* Nút điều hướng tới trang liên quan */}
                  {item.link && (
                    <button
                      onClick={() => handleNavigate(item.link!.tab)}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:gap-1.5 transition-all"
                    >
                      {item.link.label}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Divider */}
        <div className="mx-6 h-px bg-slate-100" />

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          {/* Checkbox */}
          <button
            onClick={() => setChecked(v => !v)}
            className="flex items-center gap-2.5 group select-none"
          >
            <div
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-150 ${
                checked
                  ? 'bg-emerald-500 border-emerald-500'
                  : 'border-slate-300 group-hover:border-emerald-400'
              }`}
            >
              <AnimatePresence>
                {checked && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <span className={`text-xs font-semibold transition-colors ${checked ? 'text-emerald-600' : 'text-slate-500 group-hover:text-slate-700'}`}>
              Không hiển thị lại
            </span>
          </button>

          {/* Close button — mở hướng dẫn sử dụng rồi đóng */}
          <button
            onClick={handleClose}
            className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-bold text-sm transition-all duration-150 active:scale-[0.97] ${
              checked
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/25'
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/25'
            }`}
          >
            <FileText className="w-4 h-4" />
            {checked ? 'Đã hiểu, mở hướng dẫn' : 'Mở hướng dẫn & đóng'}
          </button>
        </div>

        <p className="text-center text-[10px] text-slate-400 pb-3 -mt-1 select-none">
          Nhấn nút bên trên để mở hướng dẫn sử dụng và đóng thông báo
        </p>
      </motion.div>
    </motion.div>
  );
}

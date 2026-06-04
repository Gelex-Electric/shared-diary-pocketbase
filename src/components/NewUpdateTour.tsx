import React, { useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface UpdateItem {
  badge?: string;
  title: string;
  desc?: string;
  tag?: string;
}

const UPDATES: UpdateItem[] = [
  {
    badge: '1',
    title: 'Sửa lại toàn bộ giao diện',
    desc: 'Giao diện được thiết kế lại hoàn toàn, rõ ràng và dễ sử dụng hơn',
    tag: 'Giao diện',
  },
  {
    badge: '2',
    title: 'Tối ưu hóa một số thao tác',
    desc: 'Các thao tác thường dùng được cải tiến để nhanh hơn và ít bước hơn',
    tag: 'Cải tiến',
  },
  {
    badge: '3',
    title: 'Gộp bảng công tơ & bảng khách hàng',
    desc: 'Hai bảng nay được hiển thị trong cùng một trang, dễ tra cứu và quản lý hơn',
    tag: 'Mới',
  },
  {
    badge: '4',
    title: 'Bỏ trường email khi thêm khách hàng',
    desc: 'Không còn yêu cầu nhập email khi thêm khách hàng qua HES hoặc nhập tay',
    tag: 'Sửa lỗi',
  },
];

const TAG_STYLE: Record<string, string> = {
  'Mới':     'bg-blue-100 text-blue-700',
  'Đổi tên': 'bg-violet-100 text-violet-700',
  'Giao diện':'bg-indigo-100 text-indigo-700',
  'Cải tiến':'bg-emerald-100 text-emerald-700',
  'Sửa lỗi': 'bg-rose-100 text-rose-700',
};

interface Props {
  onDismiss: () => void;
  onClose: () => void;
}

export default function NewUpdateTour({ onDismiss, onClose }: Props) {
  const [checked, setChecked] = useState(false);

  const handleClose = () => {
    if (checked) onDismiss();
    else onClose();
  };

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <motion.div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]" />

      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="relative z-10 bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={handleCardClick}
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
        </div>

        {/* Update list */}
        <div className="px-6 py-4 space-y-3 max-h-[55vh] overflow-y-auto">
          {UPDATES.map((item, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 + 0.1 }}
              className="flex items-start gap-3"
            >
              {/* Number badge or dot */}
              {item.badge ? (
                <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-black flex items-center justify-center">
                  {item.badge}
                </span>
              ) : (
                <span className="shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-slate-300" />
              )}

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
              </div>
            </motion.div>
          ))}
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

          {/* Close button */}
          <button
            onClick={handleClose}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all duration-150 active:scale-[0.97] ${
              checked
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/25'
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/25'
            }`}
          >
            {checked ? 'Đã hiểu, đóng' : 'Đóng'}
          </button>
        </div>

        <p className="text-center text-[10px] text-slate-400 pb-3 -mt-1 select-none">
          Nhấn ra ngoài hoặc nhấn đóng để thoát
        </p>
      </motion.div>
    </motion.div>
  );
}

import React, { useState } from 'react';
import {
  Check, Sparkles, X, ArrowRight, FileText,
  Palette, Zap, Wrench, Tag, Layers, CloudDownload,
  BarChart3,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from '../lib/toast';

/** Tab đích để điều hướng khi nhấn "Xem ngay" — khớp với type Tab trong Dashboard */
export type UpdateTab = 'summary' | 'journal' | 'operating' | 'hes' | 'outage' | 'opchart' | 'loss' | 'sld' | 'billconfirm' | 'debt' | 'later';

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
const VERSION      = '1.7';
const RELEASE_DATE = '14/07/2026';

const UPDATES: UpdateItem[] = [
  {
    title: 'Biên bản xác nhận chỉ số — xem & tải ngay bên Vận hành',
    desc: 'Nhóm Vận hành xem được biên bản xác nhận chỉ số của khách hàng thuộc khu công nghiệp mình phụ trách và tải file Word (từng biên bản hoặc hàng loạt). Dữ liệu chỉ xem, không chỉnh sửa được.',
    tag: 'Mới',
    link: { tab: 'billconfirm', label: 'Mở Biên bản xác nhận chỉ số' },
  },
  {
    title: 'Công nợ khách hàng — theo dõi thanh toán bên Vận hành',
    desc: 'Xem tổng hợp sản lượng, doanh thu và trạng thái thanh toán từng kỳ của khách hàng trong khu công nghiệp phụ trách. Chỉ xem — việc cập nhật ngày thanh toán vẫn do khối Kinh doanh thực hiện.',
    tag: 'Mới',
    link: { tab: 'debt', label: 'Mở Công nợ khách hàng' },
  },
  {
    title: 'Sổ nhật ký vận hành — bố cục thẻ mới, gọn hơn',
    desc: 'Bỏ bộ chọn Khu vực (dữ liệu tự giới hạn theo tài khoản). Bộ chọn tháng và nút Tạo lịch trực gom vào thẻ tiêu đề; Mở/Thu tất cả, Chọn hết/Bỏ chọn và Tải PDF hàng loạt gom vào thanh công cụ — đồng bộ giao diện với trang Biên bản xác nhận chỉ số.',
    tag: 'Giao diện',
    link: { tab: 'journal', label: 'Mở Sổ nhật ký vận hành' },
  },
  {
    title: 'Tab Tổn thất tính toán — bộ chọn ngày/tháng đồng bộ',
    desc: 'Đổi tên "Theo trạm (Ngày)" thành "Theo ngày"; tab Biểu đồ hiển thị cả bộ chọn ngày và tháng đồng bộ hai chiều, với 2 cụm × 3 biểu đồ (trong ngày / theo tháng / theo năm).',
    tag: 'Cải tiến',
    link: { tab: 'loss', label: 'Xem Tổn thất tính toán' },
  },
  {
    title: 'Bổ sung dữ liệu tổn thất 6 tháng đầu năm 2026',
    desc: 'Nạp lại toàn bộ dữ liệu tổn thất máy biến áp từ tháng 01 đến 06/2026 — báo cáo tháng và KPI tổn thất năm giờ đủ trọn 7 tháng.',
    tag: 'Cải tiến',
  },
  {
    title: 'Cập nhật mẫu Word thông báo ngừng cấp điện',
    desc: 'Làm mới mẫu thông báo ngừng cấp điện của cả 4 khu công nghiệp (KCN Số 3, Tiền Hải, Thuận Thành I, Yên Mỹ): bỏ cột Phụ lục riêng, mở rộng cột Phạm vi.',
    tag: 'Cải tiến',
    link: { tab: 'outage', label: 'Mở Thông báo ngừng cấp điện' },
  },
];

/** Tông màu (theo token design system) cho từng nhóm danh mục */
const TAG_TONE: Record<string, { soft: string; color: string; Icon: React.ElementType }> = {
  'Mới':       { soft: 'var(--accent-soft)',  color: 'var(--accent)',  Icon: Sparkles },
  'Giao diện': { soft: 'var(--info-soft)',    color: 'var(--info)',    Icon: Palette },
  'Cải tiến':  { soft: 'var(--success-soft)', color: 'var(--success)', Icon: Zap },
  'Sửa lỗi':   { soft: 'var(--danger-soft)',  color: 'var(--danger)',  Icon: Wrench },
  'Đổi tên':   { soft: 'var(--warning-soft)', color: 'var(--warning)', Icon: Tag },
};
const DEFAULT_TONE = { soft: 'var(--surface-3)', color: 'var(--text-3)', Icon: Layers };

const toneOf = (tag?: string) => (tag && TAG_TONE[tag]) || DEFAULT_TONE;

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
    if (checked) {
      onDismiss();
      toast.info('Đã ẩn thông báo cập nhật', 'Bạn có thể xem lại trong tài liệu hướng dẫn.');
    } else {
      onClose();
    }
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
        className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl bg-surface"
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        {/* Header */}
        <div
          className="px-6 pt-6 pb-5"
          style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent-hover))' }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/20">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-base font-black leading-tight text-white">Cập nhật mới</h2>
                <p className="mt-0.5 text-xs text-white/75">Những thay đổi trong phiên bản này</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              aria-label="Đóng"
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/15 transition-colors hover:bg-white/25"
            >
              <X className="h-4 w-4 text-white" />
            </button>
          </div>

          {/* Hàng phiên bản + ngày phát hành */}
          <div className="mt-4 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-lg bg-white/20 px-2 py-1 text-[11px] font-bold text-white">
              <CloudDownload className="h-3 w-3" />
              Phiên bản {VERSION}
            </span>
            <span className="text-[11px] font-medium text-white/80">
              Phát hành {RELEASE_DATE}
            </span>
            {newCount > 0 && (
              <span className="ml-auto rounded-lg bg-surface px-2 py-1 text-[10px] font-bold text-accent">
                {newCount} tính năng mới
              </span>
            )}
          </div>
        </div>

        {/* Update list */}
        <div className="max-h-[55vh] space-y-3 overflow-y-auto px-6 py-4">
          {UPDATES.map((item, idx) => {
            const tone = toneOf(item.tag);
            const Icon = tone.Icon;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 + 0.1 }}
                className="flex items-start gap-3"
              >
                {/* Icon nhóm danh mục */}
                <span
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: tone.color, color: '#fff' }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold leading-snug text-ink">{item.title}</p>
                    {item.tag && (
                      <span
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                        style={{ background: tone.soft, color: tone.color }}
                      >
                        {item.tag}
                      </span>
                    )}
                  </div>
                  {item.desc && (
                    <p className="mt-0.5 text-xs leading-snug text-soft">{item.desc}</p>
                  )}

                  {/* Nút điều hướng tới trang liên quan */}
                  {item.link && (
                    <button
                      onClick={() => handleNavigate(item.link!.tab)}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-accent transition-all hover:gap-1.5 hover:opacity-80"
                    >
                      {item.link.label}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Gợi ý nhanh hai tính năng nổi bật */}
        <div className="mx-6 mb-1 grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2">
            <FileText className="h-4 w-4 text-accent" />
            <span className="text-[11px] font-semibold text-dim">Biên bản xác nhận chỉ số</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2">
            <BarChart3 className="h-4 w-4 text-accent" />
            <span className="text-[11px] font-semibold text-dim">Công nợ khách hàng</span>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-6 my-1 h-px bg-[var(--border)]" />

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          {/* Checkbox */}
          <button
            onClick={() => setChecked(v => !v)}
            className="group flex select-none items-center gap-2.5"
          >
            <div
              className="flex h-5 w-5 items-center justify-center rounded-md border-2 transition-all duration-150"
              style={
                checked
                  ? { background: 'var(--success)', borderColor: 'var(--success)' }
                  : { borderColor: 'var(--border-strong)' }
              }
            >
              <AnimatePresence>
                {checked && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <span className={`text-xs font-semibold transition-colors ${checked ? 'text-ok' : 'text-soft group-hover:text-dim'}`}>
              Không hiển thị lại
            </span>
          </button>

          {/* Close button — mở hướng dẫn sử dụng rồi đóng */}
          <button
            onClick={handleClose}
            className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-bold text-[var(--on-accent)] transition-all duration-150 hover:opacity-90 active:scale-[0.97]"
            style={{ background: checked ? 'var(--success)' : 'var(--accent)' }}
          >
            <FileText className="h-4 w-4" />
            {checked ? 'Đã hiểu, mở hướng dẫn' : 'Mở hướng dẫn & đóng'}
          </button>
        </div>

        <p className="-mt-1 select-none pb-3 text-center text-[10px] text-faint">
          Nhấn nút bên trên để mở hướng dẫn sử dụng và đóng thông báo
        </p>
      </motion.div>
    </motion.div>
  );
}

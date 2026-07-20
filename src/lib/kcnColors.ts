// ===================================================================
// Bảng màu cho 5 Khu công nghiệp (KCN) — dùng ở khối Văn phòng để phân
// biệt trực quan các KCN (badge, tiêu đề section, tab ngang...).
// Khoá trùng danh sách AREAS trong src/lib/pocketbase.ts.
// Chỉ dùng mã màu Tailwind tĩnh (không phụ thuộc biến CSS theo theme
// để màu KCN luôn nhất quán ở cả light/dark).
// ===================================================================

export interface KcnColor {
  /** Nền badge/section nhạt */
  bg: string;
  /** Chữ đậm màu KCN */
  text: string;
  /** Viền màu KCN */
  border: string;
  /** Chấm tròn / dải màu đặc */
  dot: string;
  /** Mã hex tiêu biểu (dùng khi cần inline) */
  hex: string;
}

/** Ánh xạ tên KCN (area) → bộ class màu. */
export const KCN_COLOR: Record<string, KcnColor> = {
  'KCN Tiền Hải': {
    bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-300 dark:border-blue-500/40', dot: 'bg-blue-500', hex: '#3b82f6',
  },
  'KCN Phong Điền': {
    bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-300 dark:border-emerald-500/40', dot: 'bg-emerald-500', hex: '#10b981',
  },
  'KCN Thuận Thành I': {
    bg: 'bg-orange-50 dark:bg-orange-500/10', text: 'text-orange-700 dark:text-orange-300',
    border: 'border-orange-300 dark:border-orange-500/40', dot: 'bg-orange-500', hex: '#f97316',
  },
  'KCN Yên Mỹ': {
    bg: 'bg-violet-50 dark:bg-violet-500/10', text: 'text-violet-700 dark:text-violet-300',
    border: 'border-violet-300 dark:border-violet-500/40', dot: 'bg-violet-500', hex: '#8b5cf6',
  },
  'KCN Số 3': {
    bg: 'bg-rose-50 dark:bg-rose-500/10', text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-300 dark:border-rose-500/40', dot: 'bg-rose-500', hex: '#f43f5e',
  },
};

const FALLBACK: KcnColor = {
  bg: 'bg-slate-50 dark:bg-slate-500/10', text: 'text-slate-600 dark:text-slate-300',
  border: 'border-slate-300 dark:border-slate-500/40', dot: 'bg-slate-400', hex: '#64748b',
};

export function kcnColorOf(area?: string): KcnColor {
  return (area && KCN_COLOR[area]) || FALLBACK;
}

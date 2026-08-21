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

/**
 * Mã KCN (tiền tố của mã khách hàng) → tên KCN chuẩn.
 *
 * Mã khách hàng trong hóa đơn có dạng `<mã KCN>-<số thứ tự>`: `KCNTH-001`,
 * `KCNYM-014`… nên tiền tố chính là mã KCN. Bảng này để đồng bộ khách hàng từ
 * hóa đơn biết gắn vào KCN nào, và để tạo KCN còn thiếu với ĐÚNG tên đang dùng
 * ở các màn khác (khoá của `KCN_COLOR` bên trên và của `AREAS` trong
 * `lib/pocketbase.ts`) — sai một chữ là mất màu và lệch bộ lọc.
 */
export const KCN_CODE_TO_NAME: Record<string, string> = {
  KCNTH: 'KCN Tiền Hải',
  KCNPĐ: 'KCN Phong Điền',
  KCNTTI: 'KCN Thuận Thành I',
  KCNYM: 'KCN Yên Mỹ',
  KCN03: 'KCN Số 3',
};

/**
 * Bảng màu theo **MÃ KCN** (KCNTH, KCNPĐ…) dùng cho các bảng danh sách phẳng:
 * viền trái thẻ, badge mã khách, chấm màu. Dùng mã hex + inline style vì class
 * Tailwind động sẽ bị purge lúc build.
 *
 * Đây chính là bảng màu của màn "Biên bản xác nhận chỉ số" — gom ra đây để các
 * màn khác dùng lại đúng một bộ màu, thay vì mỗi nơi khai một bản.
 */
export const ZONE_HEX: Record<string, string> = {
  KCNTH:  '#0ea5e9', // sky
  'KCNPĐ': '#10b981', // emerald
  KCNTTI: '#8b5cf6', // violet
  KCNYM:  '#f59e0b', // amber
  KCN03:  '#f43f5e', // rose
};

export function zoneHexOf(code?: string): string {
  return (code && ZONE_HEX[code]) || '#94a3b8';
}

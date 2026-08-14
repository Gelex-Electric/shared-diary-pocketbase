/**
 * Quy tắc đặt tên của danh mục — module THUẦN, không import PocketBase/React
 * để chạy được bằng `tsx` khi cần kiểm thử.
 *
 * Hai quy tắc user chốt 14/08/2026:
 *
 * 1. TÊN TẮT KHÁCH HÀNG: viết liền, không dấu, không ký tự đặc biệt;
 *    ngoại lệ duy nhất là dấu gạch ngang '-'.
 *
 * 2. MÃ TRẠM do hệ thống sinh, KHÔNG gõ tay:
 *       <2 ký tự hậu tố KCN>.<tên tắt KH>.<định danh>.<công suất>kVA
 *    ví dụ: KCNTH + RICO + T1 + 2500  ->  TH.RICO.T1.2500kVA
 */

/** Bỏ dấu tiếng Việt: tách tổ hợp Unicode rồi xoá dấu phụ; đ/Đ xử lý riêng. */
function stripDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Chuẩn hoá chuỗi người dùng gõ thành tên tắt hợp lệ.
 * Bỏ dấu → viết hoa → khoảng trắng thành '-' → bỏ mọi ký tự ngoài [A-Z0-9-]
 * → gộp gạch ngang liên tiếp. Dùng ngay khi gõ nên dữ liệu luôn đúng dạng.
 */
export function normalizeShortName(input: string): string {
  return stripDiacritics(input)
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-');
}

/** Tên tắt hợp lệ: ít nhất 1 ký tự, chỉ gồm chữ/số không dấu và '-'. */
export const SHORT_NAME_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export function isValidShortName(s: string): boolean {
  return SHORT_NAME_RE.test(s);
}

export const SHORT_NAME_HINT =
  'Viết liền, không dấu, không ký tự đặc biệt (chỉ được dùng dấu gạch ngang).';

/**
 * Hậu tố KCN: bỏ tiền tố "KCN" rồi lấy 2 ký tự đầu.
 * `KCNTH` → `TH`. Mã không có tiền tố "KCN" thì lấy luôn 2 ký tự đầu.
 */
export function zoneSuffix(zoneCode: string): string {
  const rest = zoneCode.trim().toUpperCase().replace(/^KCN/, '');
  return (rest || zoneCode.trim().toUpperCase()).slice(0, 2);
}

/** Công suất ghi kèm đơn vị: 2500 → `2500kVA`. */
export function powerPart(sdmKva?: number | null): string {
  return sdmKva == null || !Number.isFinite(sdmKva) ? '' : `${sdmKva}kVA`;
}

export interface StationCodeParts {
  zoneCode: string;
  customerShortName: string;
  /** Định danh trạm: T1, T2, NX1… */
  ident: string;
  sdmKva?: number | null;
}

/**
 * Ghép mã trạm. Phần nào chưa có thì bỏ trống chỗ đó nhưng GIỮ dấu chấm, để
 * người dùng nhìn thấy ngay mã còn thiếu mảnh nào khi đang khai dở.
 */
export function buildStationCode(p: StationCodeParts): string {
  return [
    zoneSuffix(p.zoneCode),
    normalizeShortName(p.customerShortName),
    p.ident.trim().toUpperCase(),
    powerPart(p.sdmKva),
  ].join('.');
}

/** Đủ 4 mảnh mới cho lưu. Trả về danh sách phần còn thiếu. */
export function missingStationCodeParts(p: StationCodeParts): string[] {
  const miss: string[] = [];
  if (!zoneSuffix(p.zoneCode)) miss.push('khu công nghiệp');
  if (!normalizeShortName(p.customerShortName)) miss.push('tên tắt khách hàng');
  if (!p.ident.trim()) miss.push('định danh trạm');
  if (!powerPart(p.sdmKva)) miss.push('công suất trạm');
  return miss;
}

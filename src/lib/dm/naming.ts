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

/* ==================================================================
   MÃ ĐIỂM ĐO
   ================================================================== */

/**
 * Định danh điểm đo hiện trong ngoặc ở cuối mã (vd `(0,4)`).
 * Người dùng gõ `0,4` hay `(0,4)` đều ra một kết quả — bỏ ngoặc thừa rồi bọc lại.
 */
export function pointIdentPart(ident?: string | null): string {
  const s = (ident ?? '').trim().replace(/^\(+|\)+$/g, '').trim();
  return s ? `(${s})` : '';
}

export interface PointCodeParts extends StationCodeParts {
  /** `true` = điểm đo phụ → nối thêm một đoạn đuôi sau công suất. */
  isSub: boolean;
  /**
   * Đoạn đuôi của điểm đo phụ, đứng ngay sau công suất trạm. Là **tên tắt KH
   * phụ** khi khác khách hàng với điểm chính, hoặc **nhãn mục đích** (CSCC,
   * BCC…) khi trùng khách hàng — lúc đó lấy tên tắt sẽ trùng phần đầu mã.
   */
  subLabel?: string;
  /** Định danh điểm đo, phần trong ngoặc ở cuối. Có thể bỏ trống. */
  pointIdent?: string;
}

/**
 * Ghép mã điểm đo.
 *   chính : TH.BQL-TH.T1.180kVA(0,4)
 *   phụ   : TH.BQL-TH.T1.180kVA.RICO(0,4)
 *           TH.BQL-TH.T1.180kVA.CSCC(0,4)   (trùng KH với điểm chính)
 *
 * Phần đầu luôn trùng đúng mã trạm. Điểm đo chính chỉ là mã trạm cộng định
 * danh trong ngoặc; điểm đo phụ nối thêm đoạn đuôi sau công suất, rồi mới tới
 * ngoặc định danh.
 */
export function buildPointCode(p: PointCodeParts): string {
  const segments = [
    zoneSuffix(p.zoneCode),
    normalizeShortName(p.customerShortName),
    p.ident.trim().toUpperCase(),
    powerPart(p.sdmKva),
    ...(p.isSub ? [normalizeShortName(p.subLabel ?? '')] : []),
  ];
  return segments.join('.') + pointIdentPart(p.pointIdent);
}

/** Phần còn thiếu để ghép được mã điểm đo (định danh điểm đo KHÔNG bắt buộc). */
export function missingPointCodeParts(p: PointCodeParts): string[] {
  const miss = missingStationCodeParts(p);
  if (p.isSub && !normalizeShortName(p.subLabel ?? '')) {
    miss.push('tên tắt khách hàng phụ hoặc nhãn mục đích');
  }
  return miss;
}

/**
 * Nhãn mục đích dùng khi điểm đo phụ TRÙNG khách hàng với điểm đo chính.
 * Viết tắt ngắn để mã không dài; ngoài danh sách này còn cho tự nhập.
 */
export const SUB_PURPOSES: { code: string; label: string }[] = [
  { code: 'CSCC', label: 'Chiếu sáng công cộng' },
  { code: 'PCCC', label: 'Phòng cháy chữa cháy' },
  { code: 'BCC', label: 'Bơm chuyển cốt' },
  { code: 'TRAM-BOM', label: 'Trạm bơm' },
  { code: 'VP', label: 'Văn phòng' },
  { code: 'NX', label: 'Nhà xưởng' },
  { code: 'DP', label: 'Dự phòng' },
];

/** Tên đầy đủ của một nhãn đuôi; nhãn tự nhập thì trả lại chính nó. */
export function purposeLabelOf(code?: string): string {
  if (!code) return '';
  return SUB_PURPOSES.find(x => x.code === code)?.label ?? code;
}

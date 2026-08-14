/**
 * Suy hệ số nhân (HSN) từ tỷ số biến dòng / biến áp — module THUẦN.
 *
 *   HSN = (TI sơ cấp / TI thứ cấp) × (TU sơ cấp / TU thứ cấp)
 *
 * - Đấu **trực tiếp**: công tơ đo thẳng, không có TI → HSN = 1.
 * - Đấu **gián tiếp** hạ áp: chỉ có TI, bỏ trống TU → phần TU coi bằng 1.
 *   Ví dụ TI 200/5 → HSN = 40.
 * - Đấu **gián tiếp** trung áp: có cả TU. Ví dụ TI 200/5 và TU 22000/100
 *   → HSN = 40 × 220 = 8800.
 *
 * HSN dùng để nhân chỉ số đọc từ HES (xem `document/API_HES.md`), nên sai một
 * ly là sai toàn bộ sản lượng — vì thế tính ở một chỗ duy nhất.
 */
import type { Connection } from './types';

export interface RatioInput {
  primary?: number | null;
  secondary?: number | null;
}

/** Tỷ số của một cặp sơ cấp/thứ cấp. Thiếu hoặc chia 0 → `null`. */
export function ratioOf(r: RatioInput): number | null {
  const p = r.primary;
  const s = r.secondary;
  if (p == null || s == null || !Number.isFinite(p) || !Number.isFinite(s)) return null;
  if (s === 0) return null;
  return p / s;
}

/**
 * Tách chuỗi tỷ số người dùng gõ dạng `200/5` thành cặp sơ cấp/thứ cấp.
 * Chấp nhận khoảng trắng thừa và dấu phẩy thập phân (`22,5/5`).
 * Không có dấu `/` thì coi cả chuỗi là sơ cấp, thứ cấp bỏ trống.
 */
export function parseRatio(text: string): RatioInput {
  const [a, b] = (text ?? '').split('/');
  const num = (s?: string) => {
    const v = parseFloat((s ?? '').trim().replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  };
  return { primary: num(a), secondary: num(b) };
}

/** Dựng lại chuỗi `200/5` từ cặp số đã lưu, để đổ ngược lên form khi sửa. */
export function formatRatio(primary?: number | null, secondary?: number | null): string {
  if (primary == null && secondary == null) return '';
  // Thiếu một vế thì không kèm dấu '/' lửng, tránh mở sửa ra chuỗi "400/".
  if (secondary == null) return `${primary}`;
  if (primary == null) return `/${secondary}`;
  return `${primary}/${secondary}`;
}

export interface HsnInput {
  connection: Connection;
  ti: RatioInput;
  /** Bỏ trống với điểm đo hạ áp — khi đó phần TU bằng 1. */
  tu?: RatioInput;
}

/**
 * HSN suy ra, hoặc `null` khi chưa đủ dữ liệu (gián tiếp mà chưa nhập tỷ số TI).
 * Làm tròn 6 chữ số thập phân để tránh rác dấu phẩy động (vd 39.99999999).
 */
export function deriveHsn({ connection, ti, tu }: HsnInput): number | null {
  if (connection === 'truc_tiep') return 1;

  const tiRatio = ratioOf(ti);
  if (tiRatio == null) return null;

  const tuRatio = tu && (tu.primary != null || tu.secondary != null) ? ratioOf(tu) : 1;
  if (tuRatio == null) return null;

  return Math.round(tiRatio * tuRatio * 1e6) / 1e6;
}

/** Mô tả công thức đang áp dụng, hiện dưới ô HSN cho người dùng đối chiếu. */
export function hsnFormula({ connection, ti, tu }: HsnInput): string {
  if (connection === 'truc_tiep') return 'Đấu trực tiếp → HSN = 1';
  const tiRatio = ratioOf(ti);
  if (tiRatio == null) return 'Nhập tỷ số TI để suy HSN';
  const tuRatio = tu && (tu.primary != null || tu.secondary != null) ? ratioOf(tu) : null;
  const tiText = `${ti.primary}/${ti.secondary} = ${tiRatio}`;
  return tuRatio == null || tuRatio === 1
    ? `TI ${tiText} → HSN = ${tiRatio}`
    : `TI ${tiText} × TU ${tu?.primary}/${tu?.secondary} = ${tuRatio} → HSN = ${Math.round(tiRatio * tuRatio * 1e6) / 1e6}`;
}

/**
 * Hệ số nhân (HSN) SUY RA từ TI/TU đang treo trên điểm đo.
 *
 *      HSN = Π tỷ_số(TI đang treo) × Π tỷ_số(TU đang treo)
 *
 * GP-03 và SIM là thiết bị truyền dữ liệu, KHÔNG tham gia (user chốt 03/08).
 * Công tơ cũng không tham gia: nó đo, không biến đổi.
 *
 * Vì sao suy ra thay vì cho gõ tay (user chốt 05/08): HSN gõ sai là hóa đơn
 * sai và tổn thất sai, mà sai kiểu này rất khó phát hiện — con số vẫn "trông
 * hợp lý". Suy từ vật tư thì HSN luôn khớp với thứ đang thực sự lắp ngoài hiện
 * trường, và mỗi lần thay TI là HSN tự đổi theo.
 *
 * Không import PocketBase để chạy được ngoài Vite khi kiểm thử.
 */
import type { Asset, AssetType, CatalogData } from './catalog';
import { hasRatio, RATIO_TYPES } from './catalog';

export interface HsnResult {
  /** null = chưa suy ra được (chưa có TI/TU nào treo). */
  value: number | null;
  /** Các TI/TU đã tham gia phép nhân — để giải thích con số cho người dùng. */
  parts: Asset[];
  /** TI/TU đang treo nhưng THIẾU tỷ số ⇒ con số suy ra không đáng tin. */
  missingRatio: Asset[];
  /** Loại có NHIỀU tỷ số khác nhau cùng treo ⇒ lắp sai hoặc khai sai. */
  conflicts: AssetType[];
}

/** TI/TU đang treo tại điểm đo, kèm HSN nhân được. */
export function hsnOfPoint(data: CatalogData, pointId: string): HsnResult {
  const parts: Asset[] = [];
  const missingRatio: Asset[] = [];

  for (const inst of data.installs) {
    if (inst.point !== pointId || !inst.is_current) continue;
    const a = data.assets.find(x => x.id === inst.asset);
    if (!a || !hasRatio(a.type)) continue;
    if (!a.ratio || !Number.isFinite(a.ratio) || a.ratio <= 0) missingRatio.push(a);
    else parts.push(a);
  }

  if (parts.length === 0) return { value: null, parts, missingRatio, conflicts: [] };

  // MỘT BỘ BA PHA CHỈ TÍNH MỘT LẦN. Điểm đo hạ thế thường có 3 TI giống hệt
  // nhau, mỗi pha một cái — đó là MỘT lần biến đổi, không phải ba. Nhân cả ba
  // sẽ ra 500 × 500 × 500 = 125.000.000 thay vì 500.
  // (Lỗi này lộ ra khi user gửi ảnh thật 3 TI 2500/5 ngày 05/08.)
  const conflicts: AssetType[] = [];
  let raw = 1;
  for (const t of RATIO_TYPES) {
    const rs = [...new Set(parts.filter(a => a.type === t).map(a => a.ratio as number))];
    if (rs.length === 0) continue;
    // Nhiều tỷ số KHÁC NHAU cùng loại ⇒ dữ liệu sai hoặc lắp sai, không đoán bừa.
    if (rs.length > 1) conflicts.push(t);
    raw *= rs[0];
  }

  // Làm tròn 6 chữ số: tỷ số là phép chia nên tích hay ra đuôi nhị phân
  // (VD 2000/5 × 22000/100 = 88000.00000000001).
  return { value: Math.round(raw * 1e6) / 1e6, parts, missingRatio, conflicts };
}

/** Chênh giữa HSN suy ra và HSN theo hóa đơn. null = chưa đủ dữ liệu để so. */
export function hsnMismatch(calc: number | null, invoice?: number): boolean | null {
  if (calc == null || invoice == null || invoice === 0) return null;
  // Sai số tương đối 0,1%: tỷ số là số hữu tỷ nên chênh thật luôn lớn hơn nhiều.
  return Math.abs(calc - invoice) / invoice > 0.001;
}

/** Diễn giải phép nhân để hiện trong tooltip: "2000/5 × 22000/100 = 88000". */
export function hsnExplain(r: HsnResult): string {
  if (r.value == null) return 'Chưa treo TI/TU nào — không suy ra được hệ số nhân.';
  // Gộp theo loại: 3 TI cùng bộ chỉ hiện MỘT số hạng, kèm số lượng.
  const terms = RATIO_TYPES.flatMap(t => {
    const g = r.parts.filter(a => a.type === t);
    if (!g.length) return [];
    const n = g.length;
    return [`${t} ${g[0].ratio_primary}/${g[0].ratio_secondary}${n > 1 ? ` (bộ ${n} cái)` : ''}`];
  });
  const s = `${terms.join(' × ')} = ${r.value}`;
  const warn = [
    r.missingRatio.length ? `${r.missingRatio.map(a => a.serial).join(', ')} chưa khai tỷ số.` : '',
    r.conflicts.length ? `${r.conflicts.join(', ')} có nhiều tỷ số khác nhau cùng treo — kiểm tra lại.` : '',
  ].filter(Boolean);
  return warn.length ? `${s}\n⚠ ${warn.join(' ')}` : s;
}

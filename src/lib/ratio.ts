/**
 * Tỷ số biến đổi của TI/TU nhập bằng MỘT ô dạng "2000/5" (user chốt 03/08).
 *
 * Tách khỏi catalogCrud.ts để module này thuần logic, không kéo theo
 * PocketBase — nhờ vậy chạy kiểm thử trực tiếp được bằng `tsx`.
 */

export interface Ratio {
  ratio_primary: number | null;
  ratio_secondary: number | null;
  ratio: number | null;
}

/** "2000/5" → {2000, 5, 400}. Rỗng → tất cả null. Sai định dạng → null. */
export function parseRatioText(text: string): Ratio | null {
  const t = (text || '').trim();
  if (!t) return { ratio_primary: null, ratio_secondary: null, ratio: null };
  const m = t.match(/^([\d.,]+)\s*[/:]\s*([\d.,]+)$/);
  if (!m) return null;
  const p = Number(m[1].replace(',', '.'));
  const q = Number(m[2].replace(',', '.'));
  if (!Number.isFinite(p) || !Number.isFinite(q) || q === 0 || p <= 0) return null;
  return { ratio_primary: p, ratio_secondary: q, ratio: p / q };
}

/** Ngược lại: dựng "2000/5" từ bản ghi để hiện trong ô. */
export function ratioText(rec: { ratio_primary?: number | null; ratio_secondary?: number | null }): string {
  if (rec.ratio_primary == null || rec.ratio_secondary == null) return '';
  return `${rec.ratio_primary}/${rec.ratio_secondary}`;
}

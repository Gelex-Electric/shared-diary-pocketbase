/**
 * Tìm kiếm văn bản cho các bảng danh mục — module THUẦN, không mạng, không JSX.
 *
 * Hai điều bắt buộc với dữ liệu ở đây:
 *
 * 1. **BỎ DẤU.** Tên khách hàng trong PB có dấu đầy đủ ("Nhựa Việt Long"), còn
 *    người dùng gõ vội thì thường không dấu ("nhua viet long"). So khớp theo
 *    chuỗi thô là gõ đúng tên vẫn không ra gì.
 * 2. **RỜI TỪ KHÓA.** Gõ "titan nx5" phải ra `TTI.TITAN.NX5.1000kVA.P1` dù hai
 *    mẩu đó cách nhau bởi dấu chấm. Vì vậy tách theo khoảng trắng và bắt buộc
 *    MỌI từ khóa đều xuất hiện (AND), không phải cụm liền nhau.
 */

/**
 * Chuẩn hóa để so khớp: thường hóa, bỏ dấu tiếng Việt, `đ` → `d`.
 *
 * `normalize('NFD')` tách nguyên âm khỏi dấu thanh rồi xóa dải dấu
 * U+0300–U+036F; riêng `đ/Đ` không phải nguyên âm có dấu nên phải thay tay.
 */
export function normalizeSearch(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

/** Tách ô tìm kiếm thành danh sách từ khóa đã chuẩn hóa. Rỗng = không lọc. */
export function buildTerms(query: string): string[] {
  return normalizeSearch(query).split(/\s+/).filter(Boolean);
}

/**
 * Một bản ghi có khớp không: ghép mọi mẩu chữ của nó thành một chuỗi rồi đòi
 * MỌI từ khóa đều nằm trong đó.
 *
 * Nhận cả `number`/`null` để chỗ gọi cứ đưa thẳng field vào, khỏi ép kiểu —
 * HSN, Sdm, P0/Pk đều là số mà vẫn cần tìm được.
 */
export function matchesTerms(
  parts: (string | number | null | undefined)[], terms: string[],
): boolean {
  if (!terms.length) return true;
  const hay = normalizeSearch(parts.filter(p => p != null && p !== '').join(' '));
  return terms.every(t => hay.includes(t));
}

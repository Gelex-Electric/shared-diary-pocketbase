/**
 * Tên khách hàng viết thường (`dm_customer.low_name`) — sinh và SOÁT.
 *
 * Vì sao có cột này: `name` được nhập viết HOA theo hóa đơn ("CÔNG TY TNHH …"),
 * còn văn bản gửi khách thì cần dạng đọc được. Cột này giữ bản đọc được đó, và
 * cũng dùng để lọc/tìm phía server (PocketBase không có `lower()` trong filter).
 *
 * ⚠️ `low_name` KHÔNG phải `name.toLowerCase()`. Người dùng soạn tay, danh từ
 * riêng giữ hoa:
 *     name     : CÔNG TY CỔ PHẦN NHỰA SENDAI VIỆT NAM
 *     low_name : Công ty cổ phần nhựa Sendai Việt Nam
 * Giả định "chữ thường tuốt" của bản đầu đã bị bác bằng dữ liệu thật ngày
 * 15/09/2026: 88/101 bản ghi soạn theo kiểu trên, ép `toLowerCase()` là phá hết.
 *
 * LUẬT SOÁT (user chốt 21/09/2026): **chỉ so số ký tự và ký tự, KHÔNG phân biệt
 * hoa/thường**. Viết hoa khác nhau là chuyện của người soạn, không phải lỗi.
 * Thứ đáng báo là thiếu chữ, thừa chữ, sai chữ, sai dấu, lệch khoảng trắng.
 *
 * File thuần logic, KHÔNG import React và KHÔNG gọi PocketBase — để còn dùng
 * lại được từ script Node lẫn từ component.
 */
import type { Customer } from './types';

/**
 * Bản viết thường dùng làm GỢI Ý KHỞI TẠO khi chưa có gì.
 *
 * Chỉ dùng để mồi ô trống, KHÔNG dùng để so sánh và KHÔNG được ghi đè lên bản
 * người dùng đã soạn — nó hợp lệ theo luật soát (đúng chữ, chỉ khác hoa/thường)
 * nhưng xấu hơn bản soạn tay.
 */
export const toLowName = (name: string): string => (name ?? '').toLowerCase();

/**
 * Dựng lại `low_name` từ `name` mà GIỮ kiểu hoa/thường người dùng đã soạn.
 *
 * `name` tải từ hóa đơn nên luôn đúng về CHỮ (user chốt 21/09/2026); `low_name`
 * là nơi duy nhất có thông tin viết hoa thế nào. Nên: lấy ký tự của `name`, lấy
 * kiểu hoa/thường của `low_name`.
 *
 * Khớp theo TOKEN (mỗi token là một cụm khoảng trắng hoặc một từ), bằng LCS
 * trên bản hạ hoa. Token khớp → giữ nguyên token của `low_name` (nhờ vậy
 * "Viglacera", "Bắc Ninh" còn nguyên). Token lệch → lấy từ của `name` rồi khoác
 * KIỂU HOA của từ mà nó thay thế.
 *
 * Vì sao theo token chứ không theo ký tự: bản ký tự khớp lẻ từng chữ nên với
 * cặp đảo chữ ("UPM" trong danh mục vs "UMP" trên hóa đơn) nó đẻ ra "UmP".
 * Theo token thì cả từ được thay một lần, giữ đúng kiểu ALLCAPS → "UMP".
 *
 * Token khoảng trắng luôn lấy nguyên của `name`, nên dấu cách đôi bên hóa đơn
 * được giữ lại thay vì bị nuốt.
 *
 * Kết quả luôn thoả `result.toLowerCase() === name.toLowerCase()`.
 */
const TOKENS = /\s+|\S+/g;
const tokenize = (s: string): string[] => (s ?? '').match(TOKENS) ?? [];

/** Khoác kiểu hoa của `pat` lên `word`: ALLCAPS, Hoa-đầu, hay thường. */
function applyCase(word: string, pat: string | undefined): string {
  if (!pat) return word.toLowerCase();
  const letters = pat.replace(/[^\p{L}]/gu, '');
  if (letters && letters === letters.toUpperCase()) return word.toUpperCase();
  // Bỏ qua ký tự không phải chữ ở đầu, kẻo "(Việt" bị coi là chữ thường.
  const first = pat.match(/\p{L}/u);
  if (first && first[0] === first[0].toUpperCase()) {
    return word.toLowerCase().replace(/\p{L}/u, ch => ch.toUpperCase());
  }
  return word.toLowerCase();
}

export function recaseFromName(name: string, low: string): string {
  const A = tokenize(name);
  const B = tokenize(low);
  const a = A.map(t => t.toLowerCase());
  const b = B.map(t => t.toLowerCase());
  const n = a.length;
  const m = b.length;

  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && a[i] === b[j]) { out.push(B[j]); i++; j++; continue; }

    // Gom trọn cụm lệch của hai bên rồi ghép 1:1; thừa thì mượn mẫu của từ cuối.
    const gapA: string[] = [];
    const gapB: string[] = [];
    while (i < n && !(j < m && a[i] === b[j])) {
      if (j < m && dp[i + 1][j] >= dp[i][j + 1]) { gapA.push(A[i]); i++; }
      else if (j < m) { gapB.push(B[j]); j++; }
      else { gapA.push(A[i]); i++; }
    }
    gapA.forEach((w, k) => out.push(
      /^\s+$/.test(w) ? w : applyCase(w, gapB[k] ?? gapB[gapB.length - 1])));
  }
  return out.join('');
}

/** Lý do một bản ghi bị coi là lệch. `ok` = cùng chữ (bỏ qua hoa/thường). */
export type LowNameIssue = 'ok' | 'missing' | 'chars' | 'space';

export const ISSUE_LABEL: Record<LowNameIssue, string> = {
  ok:      'Khớp',
  missing: 'Chưa có tên viết thường',
  chars:   'Khác ký tự',
  space:   'Khác khoảng trắng',
};

export interface LowNameCheck {
  issue: LowNameIssue;
  /** Giá trị đang lưu (rỗng nếu chưa có). */
  current: string;
  /**
   * Giá trị đề nghị ghi đè — luôn cùng chữ với `name`. Ô trống thì là bản hạ
   * hoa; ô đã có thì giữ kiểu hoa/thường cũ (xem `recaseFromName`).
   */
  expected: string;
  /** Mô tả chi tiết cho người đọc — vd "23 ký tự so với 25 ký tự". */
  detail: string;
}

/** Bỏ mọi khoảng trắng, để tách "chỉ khác space" ra khỏi "khác chữ". */
const squeeze = (s: string) => s.replace(/\s+/g, '');

/**
 * Soát một khách hàng — so `low_name` với `name`, BỎ QUA hoa/thường.
 *
 * Thứ tự phân loại từ nặng đến nhẹ, mỗi bản ghi chỉ mang MỘT nhãn:
 * chưa có → khác chữ → khác khoảng trắng.
 */
export function checkLowName(c: Pick<Customer, 'name' | 'low_name'>): LowNameCheck {
  const name = c.name ?? '';
  const current = c.low_name ?? '';

  if (!current.trim()) {
    const seed = toLowName(name);
    return { issue: 'missing', current, expected: seed, detail: `Điền được tự động: "${seed}"` };
  }

  // Hạ hoa CẢ HAI vế rồi mới so — đây là toàn bộ luật.
  const a = current.toLowerCase();
  const b = name.toLowerCase();

  if (squeeze(a) !== squeeze(b)) {
    const n1 = squeeze(a).length;
    const n2 = squeeze(b).length;
    const detail = n1 === n2
      ? `Sai chữ hoặc sai dấu (cùng ${n1} ký tự)`
      : `${n1} ký tự so với ${n2} ký tự ở tên gốc (${n1 > n2 ? 'thừa' : 'thiếu'} ${Math.abs(n1 - n2)})`;
    return { issue: 'chars', current, expected: recaseFromName(name, current), detail };
  }
  if (a !== b) {
    return {
      issue: 'space', current, expected: recaseFromName(name, current),
      detail: 'Cùng chữ, chỉ lệch khoảng trắng',
    };
  }
  return { issue: 'ok', current, expected: '', detail: '' };
}

export interface LowNameRow extends LowNameCheck {
  id: string;
  mkh: string;
  name: string;
}

/** Soát cả danh sách, trả về CHỈ các bản ghi lệch, nặng trước nhẹ sau. */
export function planLowNameFix(customers: Customer[]): LowNameRow[] {
  const order: LowNameIssue[] = ['chars', 'missing', 'space', 'ok'];
  return customers
    .map(c => ({ id: c.id, mkh: c.mkh, name: c.name ?? '', ...checkLowName(c) }))
    .filter(r => r.issue !== 'ok')
    .sort((a, b) => order.indexOf(a.issue) - order.indexOf(b.issue) || a.mkh.localeCompare(b.mkh));
}

/** Các dòng sửa được tự động (hiện là tất cả — `expected` luôn dựng được). */
export const autoFillable = (rows: LowNameRow[]): LowNameRow[] =>
  rows.filter(r => r.expected !== '' && r.expected !== r.current);

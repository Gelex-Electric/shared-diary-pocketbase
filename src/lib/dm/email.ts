/**
 * Email nhận thư của khách hàng (`dm_customer.email`, user chốt 01/10/2026).
 *
 * Một ô chứa MỘT HOẶC NHIỀU địa chỉ ngăn bằng `;` — người nhập hay gõ cả `,` hoặc
 * xuống dòng nên cũng nhận. Lưu dạng chuẩn `a@x.vn; b@y.vn` (chữ thường, bỏ trùng)
 * để nơi gửi thư chỉ việc tách theo `;`.
 */

/* Đủ để bắt lỗi gõ (thiếu @, thiếu tên miền, có khoảng trắng); không cố khớp RFC 5322. */
const EMAIL_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]{2,}$/;

export const EMAIL_HINT = 'Nhiều địa chỉ ngăn bằng dấu ; — vd ketoan@congty.vn; kythuat@congty.vn';

/** Tách ô email thành danh sách địa chỉ đúng/sai định dạng (đã bỏ trùng, chữ thường). */
export function parseEmails(raw: string | undefined | null): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of (raw ?? '').split(/[;,\n]/)) {
    const e = part.trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    (EMAIL_RE.test(e) ? valid : invalid).push(e);
  }
  return { valid, invalid };
}

/** Dạng lưu chuẩn: `a@x.vn; b@y.vn`. Chỉ gọi khi `parseEmails(raw).invalid` rỗng. */
export const joinEmails = (list: string[]) => list.join('; ');

/**
 * Tiện ích định dạng nhỏ dùng chung — trước 17/11/2026 mỗi màn tự chép một bản
 * (rà soát định kỳ: `pad2`/`p2` 14 bản, `dateOnly` 7, `today` 6, `money` 5).
 *
 * CHỈ gom những bản GIỐNG HỆT nhau. Các hàm cùng tên nhưng khác hành vi
 * (`fmtDate`, `num`, `fmt`, `ymd`…) vẫn để tại chỗ: gộp chúng là đổi kết quả hiển thị.
 */

/** `7` → `"07"`. */
export const pad2 = (n: number) => String(n).padStart(2, '0');

/** `"2026-02-07 00:00:00.000Z"` / `"2026-02-07T…"` → `"2026-02-07"`; rỗng → `""`. */
export const dateOnly = (s?: string) => (s || '').split('T')[0].split(' ')[0];

/**
 * Ngày hôm nay dạng `YYYY-MM-DD` — ⚠️ theo giờ **UTC** (`toISOString`), nên trước
 * 07:00 giờ Việt Nam trả về NGÀY HÔM TRƯỚC. Giữ nguyên hành vi các bản cũ; muốn
 * ngày theo giờ VN thì dùng `todayStr()` của `lib/qlvhRules`.
 */
export const today = () => new Date().toISOString().slice(0, 10);

/** Số tiền làm tròn, phân cách hàng nghìn kiểu Việt Nam: `1234567.6` → `"1.234.568"`. */
export const money = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0));

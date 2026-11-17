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
 * Ngày hôm nay dạng `YYYY-MM-DD` theo GIỜ MÁY (giờ Việt Nam ở máy người dùng).
 *
 * KHÔNG dùng `new Date().toISOString().slice(0, 10)`: đó là ngày UTC, trước 07:00
 * giờ VN ra NGÀY HÔM TRƯỚC — các bản chép cũ đã ghi sai ngày mặc định (ngày nhập
 * kho, ngày treo, ngày mượn) và lệch "quá hạn" khi thao tác sáng sớm (sửa 17/11/2026).
 */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Số tiền làm tròn, phân cách hàng nghìn kiểu Việt Nam: `1234567.6` → `"1.234.568"`. */
export const money = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0));

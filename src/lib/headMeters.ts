/* ============================================================
   ĐIỂM ĐO ĐẦU NGUỒN — đo TỔNG toàn bộ các điểm đo khác của một KCN.

   Nó KHÔNG đại diện cho khách hàng nào (user nhắc lại 23/09/2026): công tơ
   2246006313 đứng tên `GETC` chỉ vì hợp đồng mua bán điện đầu nguồn, không
   phải một phụ tải. Để lẫn vào danh sách khách hàng thì:
     - luôn chiếm hạng 1 mọi bảng xếp hạng (nó là tổng của tất cả),
     - làm sai giá trị trung bình,
     - lọt vào danh sách nhận thông báo ngừng cấp điện dù không có ai để gửi.

   Nhận diện theo LINE_NAME, KHÔNG theo `ROLE=phu` — nhiều công tơ phụ khác
   vẫn là phụ tải thật của khách hàng, lấy ROLE làm điều kiện sẽ loại nhầm.

   Hiện chỉ KCN Thuận Thành I có điểm đo kiểu này. Thêm KCN khác thì thêm
   LINE_NAME vào đây, mọi màn dùng chung sẽ tự áp dụng.
   ============================================================ */

/** LINE_NAME của các điểm đo đầu nguồn (viết HOA để so khớp). */
export const HEAD_LINES = new Set(['TTI.DIEMDOPHU']);

/** Công tơ này có phải điểm đo đầu nguồn không? Nhận `LINE_NAME`. */
export const isHeadLine = (line: string): boolean =>
  HEAD_LINES.has((line || '').trim().toUpperCase());

/** Nhãn hiển thị khi tách riêng ra khỏi danh sách khách hàng. */
export const HEAD_LABEL = 'Điểm đo đầu nguồn';

/** Mô tả ngắn dùng cho tooltip / dòng chú thích dưới nhãn. */
export const HEAD_HINT = 'Đo tổng toàn KCN — không phải phụ tải của một khách hàng';

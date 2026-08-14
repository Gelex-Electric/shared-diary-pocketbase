/**
 * Khối nghiệp vụ đang xem một màn hình.
 *  - 'doi'      : khối Vận hành (Đội) — dữ liệu lọc theo KCN của user, bố cục phẳng.
 *  - 'vanphong' : khối Văn phòng     — toàn bộ KCN, bố cục chia section theo KCN.
 *
 * Quy ước: MỘT màn hình = MỘT component nhận prop `scope`.
 * KHÔNG tạo file `Office*` chép tay bên cạnh bản gốc.
 */
export type Scope = 'doi' | 'vanphong';

/**
 * Gửi cảnh báo vào collection `notifications` của PocketBase (chuông thông báo
 * dùng chung, xem `src/components/ui/NotificationBell.tsx`).
 *
 * PHẠM VI GHI — cố ý hẹp: module này CHỈ tạo bản ghi mới trong `notifications`.
 * Không sửa, không xóa, không chạm bất kỳ collection nào khác. Staging dùng
 * chung dữ liệu với production nên mọi lời gọi ở đây là ghi vào dữ liệu thật.
 *
 * Chống trùng: trước khi tạo, tìm bản ghi cùng `message` + `area`. Có rồi thì
 * bỏ qua — pipeline chạy hằng ngày, cùng một sai lệch tồn tại cả tuần mà mỗi
 * ngày đẩy một thông báo thì chuông thành vô dụng.
 *
 * Quy ước `area` (theo NotificationBell): '' = khối Kinh doanh; tên KCN = khối
 * Vận hành của KCN đó.
 */
import { PB_URL } from './pb_meters.mjs';

/** Collection DUY NHẤT module này được phép ghi. */
const COLLECTION = 'notifications';

/**
 * Tạo một thông báo nếu chưa có cái nào trùng `message` + `area`.
 * Trả `true` nếu đã tạo mới, `false` nếu bỏ qua vì trùng.
 *
 * `kind` là NHÓM nghiệp vụ, quyết định thông báo vào sub-side nào ở màn Thông
 * báo: `thanhtoan` · `hsn` · `tram` · `congto` · `lui`. Khác `type` — `type`
 * chỉ quyết định màu và biểu tượng, và ba loại cảnh báo khác hẳn nhau đều mang
 * `type = 'info'` nên không chia nhóm được bằng nó.
 *
 * LƯU Ý: PocketBase BỎ QUA trường lạ khi tạo bản ghi, KHÔNG báo lỗi. Trước khi
 * cột `kind` được thêm vào collection, giá trị truyền vào đây rơi vào hư không mà
 * mọi thứ vẫn báo thành công — đã gặp khi thử ngày 16/09/2026.
 */
export async function notifyOnce(token, { title, message, type = 'info', kind = '', mkh = '', area = '' }) {
  const api = `${PB_URL}/api/collections/${COLLECTION}/records`;
  const headers = { Authorization: token, 'Content-Type': 'application/json' };

  const dupUrl = `${api}?perPage=1&filter=`
    + encodeURIComponent(`message=${JSON.stringify(message)} && area=${JSON.stringify(area)}`);
  const dup = await fetch(dupUrl, { headers });
  if (dup.ok && ((await dup.json()).totalItems ?? 0) > 0) return false;

  const r = await fetch(api, {
    method: 'POST', headers,
    body: JSON.stringify({ title, message, type, kind, mkh, area }),
  });
  if (!r.ok) {
    console.log(`[WARN] Gửi thông báo thất bại (${r.status}): ${(await r.text()).slice(0, 200)}`);
    return false;
  }
  return true;
}

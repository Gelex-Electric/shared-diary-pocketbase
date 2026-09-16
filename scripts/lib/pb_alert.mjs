/**
 * Ghi CẢNH BÁO KỸ THUẬT vào collection `alerts` của PocketBase.
 *
 * Khác `notifications` (thanh toán, hằng ngày, tự dọn còn 10 bản/KCN, hiện ở
 * chuông): `alerts` là sự cố kỹ thuật, hiếm, GIỮ VĨNH VIỄN, hiện ở màn Cảnh báo.
 * Xong việc thì đặt `resolved = true` chứ không xoá — `deleteRule = null`.
 *
 * MỘT CẢNH BÁO = MỘT BẢN GHI. Không nhân bản theo KCN như `notifyOnce` phải làm:
 * chuông lọc `area` khớp tuyệt đối nên buộc phải gửi mỗi khu một bản, còn màn
 * Cảnh báo ai đăng nhập cũng xem được và `zone` chỉ để LỌC. Nhân đôi rồi đánh
 * dấu đã xử lý một bản là lệch ngay: cùng một sự cố, chỗ báo xong chỗ báo chưa.
 *
 * PHẠM VI GHI — cố ý hẹp: module này CHỈ tạo bản ghi mới trong `alerts`. Không
 * sửa, không xoá, không chạm collection nào khác. Staging dùng chung dữ liệu với
 * production nên mọi lời gọi ở đây là ghi vào dữ liệu thật.
 *
 * LƯU Ý: PocketBase BỎ QUA trường lạ khi tạo bản ghi và vẫn trả 200, KHÔNG báo
 * lỗi — đã gặp ngày 16/09/2026 khi `kind` chưa có cột. Thêm trường mới ở đây thì
 * phải thêm cột trong `alerts_schema.mjs` trước.
 */
import { PB_URL } from './pb_meters.mjs';

/** Collection DUY NHẤT module này được phép ghi. */
const COLLECTION = 'alerts';

/**
 * Các nhóm cảnh báo hợp lệ — phải khớp `ALERT_KINDS` ở `alerts_schema.mjs` và
 * `src/lib/alerts.ts`. KHÔNG có `hsn`: HSN lấy theo `dm_point` tại thời điểm
 * hiện tại, không đối chiếu HES nữa nên lệch không còn là sự cố (user chốt
 * 16/09/2026). Cũng không có `thanhtoan` — thanh toán không phải cảnh báo.
 *
 * `lamtron` TÁCH khỏi `lui`: sai số làm tròn của HES sinh ~80 ca mỗi ngày, gộp
 * chung thì ca lùi thật lẫn vào giữa và không ai nhìn ra.
 *
 * KHÔNG còn `tram` (16/09/2026): chưa cần tới, nơi sinh đã ngừng ghi.
 */
export const ALERT_KINDS = ['lui', 'lamtron', 'congto'];

/**
 * Tạo một cảnh báo nếu chưa có cái nào trùng `kind` + `day` + `message`.
 * Trả `true` nếu đã tạo mới, `false` nếu bỏ qua vì trùng hoặc lỗi.
 *
 * Chống trùng CÓ `day` (khác `notifyOnce` chỉ theo `message`): pipeline chạy
 * hằng ngày, một sự cố kéo dài cả tuần thì mỗi ngày là một bản ghi riêng — cần
 * biết nó đã kéo dài bao lâu. Trong cùng một ngày, chạy lại bao nhiêu lần cũng
 * chỉ một bản.
 *
 * @param {string}   token   token PocketBase
 * @param {object}   a
 * @param {string}   a.kind     một trong `ALERT_KINDS`
 * @param {string}   a.title    tiêu đề ngắn
 * @param {string}   a.message  mô tả đầy đủ
 * @param {string}  [a.zone]    KCN liên quan; rỗng = trải nhiều KCN hoặc không thuộc KCN nào
 * @param {string[]}[a.meters]  danh sách số công tơ — để tra lại sau
 * @param {object[]}[a.details] chi tiết TỪNG công tơ để dựng bảng trên màn Cảnh
 *   báo: `{ meter, customer, zone, note, value }`. `meters` chỉ đủ để đếm; bảng
 *   cần biết công tơ nào của ai và bất thường bao nhiêu.
 * @param {string}  [a.day]     ngày phát hiện `YYYY-MM-DD`, mặc định hôm nay
 */
export async function raiseAlert(token, { kind, title, message, zone = '', meters = [], details = [], day }) {
  if (!ALERT_KINDS.includes(kind)) {
    console.log(`[WARN] Bỏ qua cảnh báo với kind lạ: ${JSON.stringify(kind)}`);
    return false;
  }
  const d = day || new Date().toISOString().slice(0, 10);
  const api = `${PB_URL}/api/collections/${COLLECTION}/records`;
  const headers = { Authorization: token, 'Content-Type': 'application/json' };

  const dupUrl = `${api}?perPage=1&filter=` + encodeURIComponent(
    `kind=${JSON.stringify(kind)} && day=${JSON.stringify(d)} && message=${JSON.stringify(message)}`);
  const dup = await fetch(dupUrl, { headers });
  if (dup.ok && ((await dup.json()).totalItems ?? 0) > 0) return false;

  const r = await fetch(api, {
    method: 'POST', headers,
    body: JSON.stringify({
      kind, title, message, zone,
      meters: meters.join(', '),
      details,
      day: d,
      resolved: false,
    }),
  });
  if (!r.ok) {
    console.log(`[WARN] Ghi cảnh báo thất bại (${r.status}): ${(await r.text()).slice(0, 200)}`);
    return false;
  }
  return true;
}

/**
 * KCN cho một cảnh báo gộp: đúng MỘT khu thì ghi khu đó, TRẢI NHIỀU khu thì để
 * rỗng. Chọn bừa một khu khi cảnh báo trải nhiều khu là gán sai — đã gặp với
 * cảnh báo nằm ở cả KCN Số 3 lẫn KCN Tiền Hải.
 */
export function zoneOf(zones) {
  const uniq = [...new Set(zones.filter(Boolean))];
  return uniq.length === 1 ? uniq[0] : '';
}

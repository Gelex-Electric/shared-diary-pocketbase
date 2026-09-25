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
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PB_URL } from './pb_meters.mjs';

/*
  Cùng lý do với `pb_meters.mjs`: chạy TAY ở máy công ty thì `fetch` hỏng cert
  (gặp 24/09/2026 khi ghi cảnh báo phát ngược). Thử fetch trước, hỏng thì curl.
  Trả { ok, status, json }.
*/
let useCurl = false;
async function request(method, url, headers, body) {
  if (!useCurl) {
    try {
      const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      return { ok: r.ok, status: r.status, json: text ? JSON.parse(text) : {}, text };
    } catch (e) {
      useCurl = true;
      console.error(`[pb_alert] fetch hỏng (${e?.message ?? e}) → chuyển sang curl.`);
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'pba-'));
  try {
    const args = ['-s', '-m', '60', '-X', method, url, '-w', '\n%{http_code}',
      ...Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`])];
    if (body !== undefined) {
      const f = join(dir, 'body.json');
      writeFileSync(f, JSON.stringify(body));
      args.push('--data-binary', `@${f}`);
    }
    const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const i = out.lastIndexOf('\n');
    const status = Number(out.slice(i + 1));
    const text = out.slice(0, i);
    let json = {}; try { json = text ? JSON.parse(text) : {}; } catch { /* thân không phải JSON */ }
    return { ok: status >= 200 && status < 300, status, json, text };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
 * `phatnguoc` (24/09/2026): thanh ghi hữu công CHIỀU NHẬN tăng — khách phát ngược lên
 * lưới. `dubu`: vô công chiều nhận ≥ 10% vô công giao cùng ngày (ngưỡng > 0 bắt
 * 96/124 công tơ nên đo theo tỷ lệ).
 *
 * KHÔNG còn `tram` (16/09/2026): chưa cần tới, nơi sinh đã ngừng ghi.
 */
export const ALERT_KINDS = ['lui', 'lamtron', 'congto', 'phatnguoc', 'dubu', 'daunguon'];

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
  const dup = await request('GET', dupUrl, headers);
  /* Không kiểm được trùng thì KHÔNG ghi — ghi mù là nhân đôi cảnh báo mỗi lần chạy lại. */
  if (!dup.ok) {
    console.log(`[WARN] Không kiểm được trùng (${dup.status}) — bỏ qua, không ghi.`);
    return false;
  }
  if ((dup.json.totalItems ?? 0) > 0) return false;

  const r = await request('POST', api, headers, {
    kind, title, message, zone,
    meters: meters.join(', '),
    details,
    day: d,
    resolved: false,
  });
  if (!r.ok) {
    console.log(`[WARN] Ghi cảnh báo thất bại (${r.status}): ${String(r.text).slice(0, 200)}`);
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

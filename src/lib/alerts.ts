/**
 * Đọc và đếm CẢNH BÁO KỸ THUẬT từ collection `alerts` trên PocketBase.
 *
 * Khác chuông thông báo (`components/ui/NotificationBell.tsx`, đọc
 * `notifications`) ở ba điểm, và cả ba đều là cố ý:
 *
 *   1. KHÔNG lọc theo khu vực. Chuông lọc `area` khớp tuyệt đối vì thông báo
 *      thanh toán là việc riêng của từng khối. Cảnh báo kỹ thuật thì ai đăng
 *      nhập cũng xem được — lệch chỉ số ở KCN nào cả bộ phận kỹ thuật nên biết.
 *      `zone` ở đây chỉ để LỌC trên màn hình, không phải phân quyền.
 *
 *   2. "Chưa xử lý" thay cho "chưa đọc". Mốc đọc localStorage chỉ nói "tôi đã
 *      liếc qua", mà liếc qua không làm chỉ số hết chạy lùi. Số chỉ về 0 khi có
 *      người thật sự xử lý — và giống nhau trên mọi máy vì trạng thái nằm ở
 *      server chứ không ở trình duyệt.
 *
 *   3. KHÔNG có hàm xoá. `deleteRule = null` trên collection; xong việc thì đặt
 *      `resolved = true`, bản ghi vẫn còn để truy vết.
 */
import { pb } from './pocketbase';

/**
 * Một dòng trong bảng chi tiết của cảnh báo.
 *
 * Với nhóm `lui`, một dòng = MỘT CA lùi (một biểu, một khoảng thời gian), không
 * phải một công tơ: cùng một công tơ có thể lùi ở nhiều biểu và nhiều giờ khác
 * nhau, gộp lại thì mất hết "lùi từ bao nhiêu về bao nhiêu, lúc mấy giờ".
 */
export interface AlertDetail {
  meter: string;
  /** Tên tắt khách hàng; rỗng khi Danh mục chưa khai công tơ này. */
  customer?: string;
  /** Trạm / điểm đo — hiện dưới tên khách trong cùng một ô. */
  station?: string;
  zone?: string;
  /** Khoảng bất thường, `HH:mm`. */
  fromTime?: string;
  toTime?: string;
  /** Biểu (thanh ghi) bị lùi, vd "Hữu công giao – tổng". */
  register?: string;
  /** Chỉ số trước → sau, tức "lùi từ bao nhiêu về bao nhiêu". */
  fromIndex?: number;
  toIndex?: number;
  /** Mô tả ngắn cho các nhóm không phải `lui` (mã điểm đo/trạm). */
  note?: string;
  /**
   * Lượng bất thường đã ×HSN. `null` = KHÔNG ĐO ĐƯỢC, khác hẳn 0 nghĩa là "đo
   * được và bằng không" — bảng phải hiện hai trường hợp này khác nhau.
   */
  value?: number | null;
  unit?: string;
}

/**
 * Gom chi tiết theo KCN, giữ nguyên thứ tự đã sắp sẵn từ script.
 *
 * Cảnh báo thường trải nhiều KCN; trộn lẫn thì người vận hành một khu phải tự
 * lọc bằng mắt. KCN rỗng gom vào cuối dưới tên "Chưa rõ KCN".
 */
export function groupByZone(rows: AlertDetail[]): { zone: string; rows: AlertDetail[] }[] {
  const map = new Map<string, AlertDetail[]>();
  for (const r of rows) {
    const z = r.zone || '';
    if (!map.has(z)) map.set(z, []);
    map.get(z)!.push(r);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || a[0].localeCompare(b[0]))
    .map(([zone, rows]) => ({ zone, rows }));
}

/** Tổng lượng bất thường; bỏ qua dòng không đo được. */
export const sumValue = (rows: AlertDetail[]): number =>
  rows.reduce((t, r) => t + (typeof r.value === 'number' ? r.value : 0), 0);

export interface AlertRecord {
  id: string;
  /** NHÓM cảnh báo, quyết định sub-side. */
  kind: string;
  title: string;
  message: string;
  /** KCN liên quan; rỗng = trải nhiều KCN hoặc không thuộc KCN nào. */
  zone: string;
  /** Danh sách số công tơ, cách nhau dấu phẩy. Đủ để đếm, không đủ dựng bảng. */
  meters: string;
  /**
   * Chi tiết từng công tơ để dựng bảng. Bản ghi cũ không có trường này — nơi
   * đọc phải chịu được mảng rỗng và lùi về `meters`.
   */
  details?: AlertDetail[];
  /** Ngày phát hiện, `YYYY-MM-DD`. */
  day: string;
  resolved: boolean;
  created: string;
}

/**
 * Các nhóm hiện trên màn Cảnh báo, theo thứ tự này.
 *
 * KHÔNG có `thanhtoan`: thanh toán là việc thường xuyên hằng ngày, không phải
 * cảnh báo — nó ở chuông, đọc từ `notifications` (user chốt 16/09/2026).
 *
 * KHÔNG có `hsn`: HSN lấy theo `dm_point` tại thời điểm hiện tại, không đối
 * chiếu HES nữa nên lệch với HES không còn là sự cố (cùng ngày).
 *
 * LUÔN hiện đủ mọi nhóm kể cả nhóm đang rỗng: người dùng cần biết hệ thống có
 * theo dõi loại sự cố đó mà hiện chưa có gì, thay vì tưởng nó không tồn tại.
 */
export const ALERT_KINDS = [
  /* Mã `lui` giữ nguyên trong dữ liệu — đổi mã là mọi bản ghi cũ rơi ra ngoài
     nhóm. Chỉ đổi NHÃN: "bất thường" rộng hơn "chạy lùi", để sau này thêm được
     các kiểu sai khác của chỉ số mà không phải đặt lại tên mục. */
  { kind: 'lui', label: 'Chỉ số bất thường', desc: 'Chỉ số công tơ giảm giữa hai mốc' },
  /*
    TÁCH khỏi `lui` (user chốt 16/09/2026). HES làm tròn chữ số cuối sinh ~80 ca
    mỗi ngày, toàn bộ lùi đúng 0,001 và dồn vào vài mốc giờ — vô hại, nhưng cần
    nhìn thấy để biết HES đang làm gì. Để chung với lùi thật thì ca lùi thật lẫn
    vào giữa 80 dòng vô hại và không ai nhìn ra.
  */
  { kind: 'lamtron', label: 'Sai số làm tròn', desc: 'HES làm tròn chữ số cuối, chỉ số giảm đúng 0,001' },
  { kind: 'tram', label: 'Dữ liệu trạm', desc: 'Mã trạm không khớp tên trạm bên HES' },
  { kind: 'congto', label: 'Đối chiếu công tơ', desc: 'Công tơ lệch giữa HES và Danh mục' },
] as const;

export type AlertKind = typeof ALERT_KINDS[number]['kind'];

/** Nhãn của một nhóm; nhóm lạ thì trả về chính mã đó để không hiện ô trống. */
export const labelOfKind = (kind: string): string =>
  ALERT_KINDS.find(k => k.kind === kind)?.label ?? kind;

/**
 * Toàn bộ cảnh báo, mới nhất trước.
 *
 * Tải MỘT lần rồi chia nhóm tại client: cảnh báo là sự cố hiếm nên dữ liệu nhỏ,
 * mà người dùng chuyển qua lại giữa các sub-side liên tục — gọi mạng mỗi lần
 * đổi mục là chậm mà chẳng được gì.
 */
export async function fetchAlerts(limit = 500): Promise<AlertRecord[]> {
  try {
    const res = await pb.collection('alerts').getList<AlertRecord>(1, limit, {
      sort: '-created',
      requestKey: null,
    });
    return res.items;
  } catch {
    /* Chưa có quyền hoặc mất mạng → coi như rỗng, không làm vỡ giao diện. */
    return [];
  }
}

/** Đếm cảnh báo CHƯA XỬ LÝ theo từng nhóm. Nhóm rỗng vẫn có khoá, giá trị 0. */
export function countByKind(items: AlertRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of ALERT_KINDS) out[k.kind] = 0;
  for (const r of items) {
    if (!r.resolved && r.kind in out) out[r.kind]++;
  }
  return out;
}

/** Tổng số cảnh báo chưa xử lý — con số trên sidebar. */
export const unresolvedCount = (items: AlertRecord[]): number =>
  items.filter(r => !r.resolved).length;

/**
 * Các KCN đang có cảnh báo, để đổ vào bộ lọc.
 *
 * Bỏ bản `zone` rỗng: đó là cảnh báo trải nhiều KCN, không phải một KCN tên rỗng.
 */
export const zonesOf = (items: AlertRecord[]): string[] =>
  [...new Set(items.map(r => r.zone).filter(Boolean))].sort();

/**
 * Lọc theo nhóm + KCN.
 *
 * Cảnh báo `zone` rỗng LUÔN hiện dù đang lọc KCN nào: nó trải nhiều khu nên khu
 * đang xem cũng nằm trong đó — giấu đi là giấu mất sự cố đang ảnh hưởng tới họ.
 */
export function filterAlerts(items: AlertRecord[], kind: string, zone: string): AlertRecord[] {
  return items.filter(r => r.kind === kind && (!zone || !r.zone || r.zone === zone));
}

/**
 * Đánh dấu đã xử lý / mở lại.
 *
 * Trả `true` nếu ghi được. Không xoá bản ghi trong mọi trường hợp — đây là chỗ
 * duy nhất màn Cảnh báo được phép ghi.
 */
/**
 * Chi tiết của một cảnh báo, luôn trả về mảng dùng được.
 *
 * Bản ghi cũ chỉ có `meters` (chuỗi phẩy) — dựng tạm một dòng mỗi công tơ để
 * bảng vẫn hiện được, thay vì để trống và làm người đọc tưởng mất dữ liệu.
 */
export function detailsOf(r: AlertRecord): AlertDetail[] {
  if (Array.isArray(r.details) && r.details.length) return r.details;
  return (r.meters || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(meter => ({ meter }));
}

export async function setResolved(id: string, resolved: boolean): Promise<boolean> {
  try {
    await pb.collection('alerts').update(id, { resolved });
    return true;
  } catch {
    return false;
  }
}

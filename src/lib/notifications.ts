/**
 * Đọc và đếm thông báo từ collection `notifications` trên PocketBase.
 *
 * Tách khỏi `components/ui/NotificationBell.tsx` (nơi logic này vốn nằm nhờ) để
 * cả chuông lẫn màn Thông báo dùng chung một nguồn — hai chỗ đếm khác nhau thì
 * chuông báo một đằng, màn hình hiện một nẻo.
 *
 * PHẠM VI THEO KHU VỰC: bản ghi mang `area` = '' cho khối Kinh doanh, hoặc tên
 * KCN cho khối Vận hành của KCN đó. Tài khoản chỉ thấy ĐÚNG khu vực của mình —
 * giữ nguyên luật của chuông, không nới rộng.
 */
import { pb } from './pocketbase';

export interface NotificationRecord {
  id: string;
  title: string;
  message: string;
  /** Quyết định màu và biểu tượng: 'payment' | 'info' | 'warning' | … */
  type?: string;
  /** NHÓM nghiệp vụ, quyết định sub-side. Rỗng = chưa phân nhóm. */
  kind?: string;
  mkh?: string;
  area?: string;
  created: string;
}

/**
 * Các nhóm hiện trên màn Thông báo, theo thứ tự này.
 *
 * LUÔN hiện đủ mọi nhóm kể cả nhóm đang rỗng: người dùng cần biết hệ thống có
 * theo dõi loại cảnh báo đó và hiện chưa có gì, thay vì tưởng nó không tồn tại.
 */
export const NOTIF_KINDS = [
  { kind: 'thanhtoan', label: 'Thanh toán', desc: 'Khách hàng đã trả tiền điện' },
  { kind: 'lui', label: 'Chỉ số chạy lùi', desc: 'Chỉ số công tơ giảm giữa hai mốc' },
  { kind: 'hsn', label: 'Hệ số nhân', desc: 'HSN bất thường hoặc lệch giữa HES và Danh mục' },
  { kind: 'tram', label: 'Dữ liệu trạm', desc: 'Mã trạm không khớp tên trạm bên HES' },
  { kind: 'congto', label: 'Đối chiếu công tơ', desc: 'Công tơ lệch giữa HES và Danh mục' },
  { kind: '', label: 'Khác', desc: 'Chưa phân nhóm' },
] as const;

export type NotifKind = typeof NOTIF_KINDS[number]['kind'];

/** Nhóm của một bản ghi; giá trị lạ hoặc rỗng đều rơi về mục "Khác". */
export function kindOf(r: NotificationRecord): NotifKind {
  const k = (r.kind ?? '').trim();
  return (NOTIF_KINDS.some(x => x.kind === k) ? k : '') as NotifKind;
}

/** Khu vực của tài khoản đang đăng nhập: '' = Kinh doanh, tên KCN = Vận hành. */
export const myArea = (): string => (pb.authStore.model?.area as string) || '';

/**
 * Toàn bộ thông báo của khu vực hiện tại, mới nhất trước.
 *
 * Tải MỘT lần rồi chia nhóm tại client: dữ liệu nhỏ (hiện 44 bản ghi) và người
 * dùng chuyển qua lại giữa các sub-side liên tục, gọi mạng mỗi lần đổi tab là
 * chậm mà chẳng được gì.
 */
export async function fetchNotifications(limit = 500): Promise<NotificationRecord[]> {
  try {
    const res = await pb.collection('notifications').getList<NotificationRecord>(1, limit, {
      filter: pb.filter('area = {:area}', { area: myArea() }),
      sort: '-created',
      requestKey: null,
    });
    return res.items;
  } catch {
    /* Chưa có quyền hoặc mất mạng → coi như rỗng, không làm vỡ giao diện. */
    return [];
  }
}

/** Đếm theo từng nhóm. Nhóm rỗng vẫn có khoá, giá trị 0. */
export function countByKind(items: NotificationRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of NOTIF_KINDS) out[k.kind] = 0;
  for (const r of items) out[kindOf(r)]++;
  return out;
}

/* ----------------------------- Đã đọc / chưa đọc ----------------------------- */
/**
 * Mốc đọc gần nhất, lưu ở máy người dùng.
 *
 * Kế thừa nguyên cơ chế của chuông — không cần thêm cột per-user nào trên
 * server. Đổi máy hoặc xoá dữ liệu trình duyệt thì số chưa đọc hiện lại; đó là
 * đánh đổi có sẵn, không phải điều mới.
 */
export const LAST_READ_KEY = 'getc_notif_last_read';

export const getLastRead = (): string => {
  try { return localStorage.getItem(LAST_READ_KEY) || ''; } catch { return ''; }
};

/*
  Ai đang hiện số chưa đọc thì đăng ký ở đây, để mốc đọc vừa đổi là số cập nhật
  ngay — không phải chờ tải lại trang. Cùng cách `NotificationBell` làm với danh
  sách thông báo cục bộ.
*/
const readListeners = new Set<() => void>();
export function onReadChange(fn: () => void): () => void {
  readListeners.add(fn);
  return () => { readListeners.delete(fn); };
}

/** Ghi mốc đọc = bây giờ. Gọi khi người dùng mở màn Thông báo. */
export function markAllRead(): string {
  const now = new Date().toISOString().replace('T', ' ');
  try { localStorage.setItem(LAST_READ_KEY, now); } catch { /* chế độ ẩn danh */ }
  readListeners.forEach(fn => fn());
  return now;
}

export const isUnread = (r: NotificationRecord, lastRead: string): boolean =>
  !lastRead || r.created > lastRead;

export const unreadCount = (items: NotificationRecord[], lastRead: string): number =>
  items.filter(r => isUnread(r, lastRead)).length;

/**
 * Tóm tắt cho chuông: mỗi nhóm một dòng, đếm phần CHƯA ĐỌC.
 *
 * Riêng nhóm `thanhtoan` tách thêm theo KCN vì đó là cách người dùng đọc nó
 * ("khách hàng KCN nào đã trả"). `area` của bản ghi là khu vực NHẬN thông báo,
 * nên KCN lấy từ mã khách hàng `mkh` — cùng cách các màn Kinh doanh đang làm.
 */
export interface NotifSummaryLine {
  kind: NotifKind;
  /** Nhãn hiện ra, đã ghép số. */
  text: string;
  count: number;
}

export function summarize(
  items: NotificationRecord[],
  lastRead: string,
  zoneOfMkh: (mkh: string) => string,
): NotifSummaryLine[] {
  const unread = items.filter(r => isUnread(r, lastRead));
  const out: NotifSummaryLine[] = [];

  for (const { kind, label } of NOTIF_KINDS) {
    const list = unread.filter(r => kindOf(r) === kind);
    if (!list.length) continue;

    if (kind === 'thanhtoan') {
      const byZone = new Map<string, number>();
      for (const r of list) {
        const z = zoneOfMkh(r.mkh ?? '') || 'chưa rõ KCN';
        byZone.set(z, (byZone.get(z) ?? 0) + 1);
      }
      for (const [zone, n] of [...byZone].sort((a, b) => b[1] - a[1])) {
        out.push({ kind, count: n, text: `${n} khách hàng ${zone} đã thanh toán` });
      }
    } else {
      out.push({ kind, count: list.length, text: `${list.length} ${label.toLowerCase()}` });
    }
  }
  return out;
}

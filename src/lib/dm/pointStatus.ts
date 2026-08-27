/**
 * Suy trạng thái vận hành của điểm đo — module THUẦN.
 *
 * Trạng thái KHÔNG còn chọn tay (user chốt 20/08/2026): nó là hệ quả của vật tư
 * đang gắn và của việc đã phát sinh hóa đơn hay chưa, nên để người dùng tự chọn
 * chỉ tạo ra dữ liệu mâu thuẫn.
 *
 *   chưa gắn công tơ / chưa khai ngày treo → Dự kiến
 *   đã treo, chưa có hóa đơn gần đây       → Chưa vận hành
 *   đã treo, có hóa đơn trong 40 ngày      → Đang vận hành
 *   mọi vật tư đều đã ngưng hoạt động      → Đã tháo gỡ
 *
 * MỐC "DỰ KIẾN" LÀ NGÀY TREO (user chốt 22/08/2026). Trước đó mốc là "đủ bộ 3
 * TI", nhưng số lượng TI chỉ nói lên vật tư đã khai tới đâu trong hồ sơ, không
 * nói lên vật tư đã ra hiện trường hay chưa. Điểm đo chỉ thôi là dự kiến khi
 * công tơ đang hoạt động đã có ngày treo — treo lên cột mới là mốc có thật.
 * Luật "đo gián tiếp phải đủ 3 TI" vẫn còn, nhưng chỉ là CẢNH BÁO trên form
 * chứ không còn quyết định trạng thái.
 */
import type { PointStatus } from './types';

export interface PointStatusInput {
  /** Tổng số công tơ đã khai ở điểm đo, kể cả cái đã tháo. */
  meters: number;
  /** Số công tơ đang hoạt động. */
  activeMeters: number;
  /** Tổng số TI đã khai, kể cả đã tháo — dùng để biết điểm đo có đo gián tiếp không. */
  tis: number;
  /** Số TI đang hoạt động. */
  activeTis: number;
  /**
   * Số công tơ ĐANG hoạt động mà CHƯA khai ngày treo. Còn cái nào chưa khai thì
   * điểm đo vẫn chỉ là dự kiến — ngày treo là mốc duy nhất chứng minh vật tư đã
   * thực sự lắp ra hiện trường.
   */
  metersWithoutDateOn: number;
  /**
   * Công tơ đang hoạt động có hóa đơn GẦN ĐÂY cho đúng khách của điểm đo không
   * (`RECENT_DAYS` = 40 ngày, xem `lifecycle.ts`).
   *
   * Phải là "gần đây" chứ không phải "từng có": điểm đo ngừng phát sinh tiền
   * điện cả năm nay mà vẫn còn công tơ treo thì không thể coi là đang vận hành.
   */
  hasRecentInvoice: boolean;
}

/** Bộ TI của một điểm đo gián tiếp: 3 cái chạy song song trên 3 pha. */
export const TI_PER_SET = 3;

export function derivePointStatus(i: PointStatusInput): PointStatus {
  // Chưa có công tơ nào ⇒ mới chỉ là dự kiến, chưa lắp đặt.
  if (i.meters === 0) return 'du_kien';

  // Có công tơ nhưng không cái nào còn chạy ⇒ đã tháo gỡ. Xét trước ngày treo
  // vì điểm đo đã tháo thì không còn công tơ hoạt động nào để xét.
  if (i.activeMeters === 0) return 'thao_go';

  // Còn công tơ chưa khai ngày treo ⇒ chưa chứng minh được đã lắp, vẫn dự kiến.
  if (i.metersWithoutDateOn > 0) return 'du_kien';

  return i.hasRecentInvoice ? 'active' : 'chua_van_hanh';
}

/**
 * Đếm vật tư theo loại — gom ở đây để form và script dùng chung một cách đếm.
 *
 * Ngày treo đọc được ở CẢ HAI dạng: `dateOn` (dòng đang gõ trên form) và
 * `date_on` (bản ghi `dm_asset` mà script đọc thẳng từ PocketBase).
 */
export interface AssetCountRow {
  type: string;
  active?: boolean;
  dateOn?: string | null;
  date_on?: string | null;
}

const hasDateOn = (r: AssetCountRow): boolean => !!(r.dateOn ?? r.date_on ?? '').trim();

export function countAssets<T extends AssetCountRow>(rows: T[]) {
  const of = (t: string) => rows.filter(r => r.type === t);
  const meters = of('CONGTO');
  return {
    meters: meters.length,
    activeMeters: meters.filter(r => r.active).length,
    tis: of('TI').length,
    activeTis: of('TI').filter(r => r.active).length,
    metersWithoutDateOn: meters.filter(r => r.active && !hasDateOn(r)).length,
  };
}

/**
 * Bộ đo xa của một điểm đo: modem GP-03 và SIM lắp trong nó.
 *
 * Hai thứ này đi thành cặp — GP-03 không có SIM thì không đẩy được số liệu về
 * HES, mà SIM không có modem thì cũng chẳng để làm gì. Điểm đo ĐANG VẬN HÀNH mà
 * thiếu một trong hai là mất đo xa, phải đọc chỉ số bằng tay (user chốt
 * 25/08/2026).
 */
export const REMOTE_TYPES = ['GP03', 'SIM'] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

export const REMOTE_LABEL: Record<RemoteType, string> = {
  GP03: 'đo xa GP-03',
  SIM: 'SIM',
};

/**
 * Thiếu những gì trong bộ đo xa. Chỉ tính vật tư ĐÃ TREO và đang hoạt động —
 * cái đã tháo không còn đo, cái chưa có ngày treo mới chỉ là dự kiến.
 */
export function missingRemote<T extends AssetCountRow>(rows: T[]): RemoteType[] {
  const live = (t: RemoteType) => rows.some(r => r.type === t && r.active && hasDateOn(r));
  return REMOTE_TYPES.filter(t => !live(t));
}

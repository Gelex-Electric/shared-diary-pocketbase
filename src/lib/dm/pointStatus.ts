/**
 * Suy trạng thái vận hành của điểm đo — module THUẦN.
 *
 * Trạng thái KHÔNG còn chọn tay (user chốt 20/08/2026): nó là hệ quả của vật tư
 * đang gắn và của việc đã phát sinh hóa đơn hay chưa, nên để người dùng tự chọn
 * chỉ tạo ra dữ liệu mâu thuẫn.
 *
 *   chưa gắn công tơ                      → Dự kiến
 *   gắn đầy đủ, chưa có hóa đơn           → Chưa vận hành
 *   gắn đầy đủ, đã có hóa đơn             → Đang vận hành
 *   mọi vật tư đều đã ngưng hoạt động     → Đã tháo gỡ
 *
 * "Đầy đủ" = có công tơ đang hoạt động, và nếu đo gián tiếp thì phải đủ 3 TI
 * đang hoạt động (user chốt). Đo gián tiếp nhận biết bằng việc điểm đo CÓ dòng
 * TI trong bảng vật tư — trường `connection` không còn dùng để hỏi người dùng.
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
  /** Công tơ đang hoạt động đã phát sinh hóa đơn cho đúng khách của điểm đo chưa. */
  hasInvoice: boolean;
}

/** Bộ TI của một điểm đo gián tiếp: 3 cái chạy song song trên 3 pha. */
export const TI_PER_SET = 3;

export function derivePointStatus(i: PointStatusInput): PointStatus {
  // Chưa có công tơ nào ⇒ mới chỉ là dự kiến, chưa lắp đặt.
  if (i.meters === 0) return 'du_kien';

  // Có công tơ nhưng không cái nào còn chạy ⇒ đã tháo gỡ. Xét trước "đầy đủ"
  // vì điểm đo đã tháo thì đương nhiên không đủ TI đang hoạt động.
  if (i.activeMeters === 0) return 'thao_go';

  // Đo gián tiếp mà chưa đủ bộ 3 TI ⇒ lắp dở, chưa thể vận hành.
  const indirect = i.tis > 0;
  if (indirect && i.activeTis < TI_PER_SET) return 'du_kien';

  return i.hasInvoice ? 'active' : 'chua_van_hanh';
}

/** Đếm vật tư theo loại — gom ở đây để form và script dùng chung một cách đếm. */
export function countAssets<T extends { type: string; active?: boolean }>(rows: T[]) {
  const of = (t: string) => rows.filter(r => r.type === t);
  return {
    meters: of('CONGTO').length,
    activeMeters: of('CONGTO').filter(r => r.active).length,
    tis: of('TI').length,
    activeTis: of('TI').filter(r => r.active).length,
  };
}
